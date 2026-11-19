// matchi-doctor: one read-only command that checks what "Full diagnose" needs from the device and prints the result as JSON.
//
//	matchi-doctor [-files DIR -hash name=sha256 ...] [-router 192.168.0.1] [-tls host:443] [-skip at,router] [-pretty]
//
// It looks at: root, the SELinux mode, free memory, /data space and inodes, the CA certificates the device trusts, an optional
// TLS handshake against them, the router's web server, the modem AT port, and the SHA-256 of the bundled binaries.
//
// It changes nothing. It writes no file, sends no AT command except a plain "AT" through sendat, and never touches a port that
// another process (the RIL) holds. Exit code: 0 when the report was written (failures are in the report, not in the exit code),
// 2 for a usage error, 1 when the report could not be written. Stdlib only; source is in this repository and is built by
// .github/workflows/build-doctor.yml.
//
// Every line of the report has a status the page already knows: ok, warn, fail, skip. The thresholds are the ones the checks in
// the page use (memory: fail under 5 % free, warn under 10 %; /data: warn from 95 % used; /data mounted read-only: fail), so the
// two can be compared side by side on the F50.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const version = "matchi-doctor 1.0 (MatchiTOOL)"

const (
	statusOK   = "ok"
	statusWarn = "warn"
	statusFail = "fail"
	statusSkip = "skip"
)

const defaultRouterPorts = "8080,80,9090,9999"

// checkIDs is every check, in the order they run and are printed.
var checkIDs = []string{"root", "selinux", "memory", "storage", "ca", "tls", "router", "at", "binaries"}

// Check is one line of the report. Detail is the sentence the page shows; Data holds the same facts as values.
type Check struct {
	ID     string                 `json:"id"`
	Title  string                 `json:"title"`
	Status string                 `json:"status"`
	Detail string                 `json:"detail"`
	Hint   string                 `json:"hint,omitempty"`
	Data   map[string]interface{} `json:"data,omitempty"`
}

// Report is what is printed: one JSON object on one line (-pretty indents it).
type Report struct {
	Tool      string         `json:"tool"`
	Arch      string         `json:"arch"`
	Generated int64          `json:"generated"`
	Summary   map[string]int `json:"summary"`
	Checks    []Check        `json:"checks"`
}

type nameHash struct{ name, sum string }

// hashList is the repeatable -hash flag: name=<64 hex digits>.
type hashList []nameHash

func (h *hashList) String() string { return strconv.Itoa(len(*h)) }

func (h *hashList) Set(v string) error {
	name, sum, ok := strings.Cut(v, "=")
	name, sum = strings.TrimSpace(name), strings.ToLower(strings.TrimSpace(sum))
	if !ok || name == "" || strings.ContainsAny(name, "/\\") || !isSHA256(sum) {
		return fmt.Errorf("want name=<64 hex digits>, got %q", v)
	}
	*h = append(*h, nameHash{name, sum})
	return nil
}

func isSHA256(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, r := range s {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f') {
			return false
		}
	}
	return true
}

// config is everything the checks read. runSendat is a field so tests can answer without a modem.
type config struct {
	root        string // prefix for /proc, /sys, /data, /apex, /system and /dev; empty on the device, a temp folder in tests
	filesDir    string
	hashes      hashList
	conf        string
	sendat      string
	router      string
	routerPorts []int
	tlsAddr     string
	atTimeout   time.Duration
	netTimeout  time.Duration
	skip        map[string]bool
	uid         int
	runSendat   func(path string, args []string, timeout time.Duration) (string, int, error)
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, out, errw io.Writer) int {
	fs := flag.NewFlagSet("matchi-doctor", flag.ContinueOnError)
	fs.SetOutput(errw)
	var hashes hashList
	root := fs.String("root", "", "prefix for /proc, /sys, /data, /apex, /system and /dev (tests only)")
	files := fs.String("files", "", "folder that holds the bundled binaries (with -hash they are checked)")
	fs.Var(&hashes, "hash", "name=sha256 of a file in -files; repeat for each file")
	conf := fs.String("conf", "", "sendat.conf (default <root>/data/local/matchitool/sendat.conf)")
	sendat := fs.String("sendat", "", "the sendat program (default <files>/sendat)")
	routerHost := fs.String("router", "192.168.0.1", "router address")
	routerPorts := fs.String("router-ports", defaultRouterPorts, "ports to try on the router, in order")
	tlsAddr := fs.String("tls", "", "host:port for a TLS handshake against the device's CA store (left out when empty)")
	atSecs := fs.Int("at-timeout", 4, "seconds to wait for the modem")
	netSecs := fs.Int("net-timeout", 2, "seconds for each network connect")
	skip := fs.String("skip", "", "checks to leave out, comma separated: "+strings.Join(checkIDs, ","))
	pretty := fs.Bool("pretty", false, "indent the JSON")
	ver := fs.Bool("version", false, "print the version and exit")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}
	if *ver {
		fmt.Fprintln(out, version)
		return 0
	}
	if fs.NArg() > 0 {
		fmt.Fprintln(errw, "matchi-doctor: unexpected argument", fs.Arg(0))
		return 2
	}
	ports, err := parsePorts(*routerPorts)
	if err != nil {
		fmt.Fprintln(errw, "matchi-doctor:", err)
		return 2
	}
	skipped, err := parseSkip(*skip)
	if err != nil {
		fmt.Fprintln(errw, "matchi-doctor:", err)
		return 2
	}
	if *atSecs < 1 || *atSecs > 60 || *netSecs < 1 || *netSecs > 30 {
		fmt.Fprintln(errw, "matchi-doctor: -at-timeout must be 1-60 and -net-timeout 1-30 seconds")
		return 2
	}
	cfg := config{
		root: *root, filesDir: *files, hashes: hashes, conf: *conf, sendat: *sendat,
		router: *routerHost, routerPorts: ports, tlsAddr: *tlsAddr,
		atTimeout: time.Duration(*atSecs) * time.Second, netTimeout: time.Duration(*netSecs) * time.Second,
		skip: skipped, uid: os.Geteuid(), runSendat: execSendat,
	}
	if cfg.conf == "" {
		cfg.conf = cfg.root + "/data/local/matchitool/sendat.conf"
	}
	if cfg.sendat == "" && cfg.filesDir != "" {
		cfg.sendat = cfg.filesDir + "/sendat"
	}
	rep := collect(cfg, time.Now())
	var b []byte
	if *pretty {
		b, err = json.MarshalIndent(rep, "", "  ")
	} else {
		b, err = json.Marshal(rep)
	}
	if err != nil {
		fmt.Fprintln(errw, "matchi-doctor:", err)
		return 1
	}
	if _, err := out.Write(append(b, '\n')); err != nil {
		return 1 // the reader went away; nothing else to do
	}
	return 0
}

func parsePorts(s string) ([]int, error) {
	var ports []int
	for _, f := range strings.Split(s, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(f))
		if err != nil || n < 1 || n > 65535 {
			return nil, fmt.Errorf("bad router port %q", f)
		}
		ports = append(ports, n)
	}
	return ports, nil
}

func parseSkip(s string) (map[string]bool, error) {
	m := map[string]bool{}
	if strings.TrimSpace(s) == "" {
		return m, nil
	}
	for _, f := range strings.Split(s, ",") {
		f = strings.TrimSpace(f)
		known := false
		for _, id := range checkIDs {
			if id == f {
				known = true
			}
		}
		if !known {
			return nil, fmt.Errorf("unknown check %q in -skip (known: %s)", f, strings.Join(checkIDs, ", "))
		}
		m[f] = true
	}
	return m, nil
}

// collect runs the checks in order. The TLS check runs only when a host was given, and it needs the pool the CA check reads.
func collect(cfg config, now time.Time) Report {
	d := &doctor{cfg: cfg}
	steps := map[string]func() Check{
		"root": d.checkRoot, "selinux": d.checkSELinux, "memory": d.checkMemory, "storage": d.checkStorage,
		"ca": d.checkCA, "tls": d.checkTLS, "router": d.checkRouter, "at": d.checkAT, "binaries": d.checkBinaries,
	}
	rep := Report{
		Tool: version, Arch: runtime.GOARCH, Generated: now.Unix(),
		Summary: map[string]int{statusOK: 0, statusWarn: 0, statusFail: 0, statusSkip: 0},
		Checks:  []Check{},
	}
	for _, id := range checkIDs {
		if cfg.skip[id] || (id == "tls" && cfg.tlsAddr == "") {
			continue
		}
		c := steps[id]()
		rep.Summary[c.Status]++
		rep.Checks = append(rep.Checks, c)
	}
	return rep
}
