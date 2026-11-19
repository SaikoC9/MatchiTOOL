package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// doctor holds the settings and what one check hands to the next (the CA pool for the TLS check).
type doctor struct {
	cfg  config
	pool *x509.CertPool
}

// p puts the test prefix in front of a device path. On the device the prefix is empty.
func (d *doctor) p(path string) string { return d.cfg.root + path }

func errText(err error) string { return strings.TrimSpace(err.Error()) }

// ---------- root, SELinux ----------

func (d *doctor) checkRoot() Check {
	c := Check{ID: "root", Title: "Root", Data: map[string]interface{}{"uid": d.cfg.uid}}
	if d.cfg.uid == 0 {
		c.Status, c.Detail = statusOK, "running as uid 0"
		return c
	}
	c.Status, c.Detail = statusFail, fmt.Sprintf("running as uid %d, not root", d.cfg.uid)
	c.Hint = "Start matchi-doctor through su, and allow MatchiTOOL in your root manager."
	return c
}

func (d *doctor) checkSELinux() Check {
	c := Check{ID: "selinux", Title: "SELinux"}
	b, err := os.ReadFile(d.p("/sys/fs/selinux/enforce"))
	if err != nil {
		if _, e2 := os.Stat(d.p("/sys/fs/selinux")); e2 != nil {
			c.Status, c.Detail = statusSkip, "SELinux is not enabled in this kernel"
			return c
		}
		c.Status, c.Detail = statusWarn, "could not read the SELinux mode: "+errText(err)
		return c
	}
	switch strings.TrimSpace(string(b)) {
	case "0":
		c.Status, c.Detail = statusOK, "Permissive (nothing blocks a root program; this can change after a firmware update)"
		c.Data = map[string]interface{}{"mode": "permissive"}
	case "1":
		c.Status, c.Detail = statusOK, "Enforcing"
		c.Hint = "With SELinux enforcing a root program can be denied; watch the log for avc lines."
		c.Data = map[string]interface{}{"mode": "enforcing"}
	default:
		c.Status, c.Detail = statusWarn, fmt.Sprintf("unexpected value %q in /sys/fs/selinux/enforce", strings.TrimSpace(string(b)))
	}
	return c
}

// ---------- memory, storage ----------

// meminfoKB returns the number behind key ("MemTotal") in the text of /proc/meminfo, in kB.
func meminfoKB(text, key string) (int64, bool) {
	for _, line := range strings.Split(text, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(k) != key {
			continue
		}
		f := strings.Fields(v)
		if len(f) == 0 {
			return 0, false
		}
		n, err := strconv.ParseInt(f[0], 10, 64)
		return n, err == nil
	}
	return 0, false
}

func (d *doctor) checkMemory() Check {
	c := Check{ID: "memory", Title: "Memory"}
	b, err := os.ReadFile(d.p("/proc/meminfo"))
	if err != nil {
		c.Status, c.Detail = statusWarn, "could not read /proc/meminfo: "+errText(err)
		return c
	}
	total, ok1 := meminfoKB(string(b), "MemTotal")
	avail, ok2 := meminfoKB(string(b), "MemAvailable")
	if !ok1 || !ok2 || total <= 0 {
		c.Status, c.Detail = statusWarn, "MemTotal or MemAvailable is missing from /proc/meminfo"
		return c
	}
	pct := float64(avail) * 100 / float64(total)
	c.Data = map[string]interface{}{"total_kb": total, "available_kb": avail, "free_percent": int(pct + 0.5)}
	c.Detail = fmt.Sprintf("free memory %.0f%% (%d MB of %d MB)", pct, avail/1024, total/1024)
	switch {
	case pct < 5:
		c.Status = statusFail
		c.Detail += " - memory exhausted"
		c.Hint = "Stop unused tools and reboot; the kernel will kill apps."
	case pct < 10:
		c.Status = statusWarn
		c.Detail += " - system under pressure"
		c.Hint = "Close extra tools and plugins."
	default:
		c.Status = statusOK
	}
	return c
}

// pctUsed is what df prints: used / (used + available), rounded up.
func pctUsed(used, avail uint64) int {
	total := used + avail
	if total == 0 {
		return 0
	}
	return int((used*100 + total - 1) / total)
}

// sub is a-b, or 0 when b is bigger (a file system that reports no inode count).
func sub(a, b uint64) uint64 {
	if b > a {
		return 0
	}
	return a - b
}

// dataMountOptions returns the mount options of /data from the text of /proc/mounts ("" when there is no such line).
func dataMountOptions(mounts string) string {
	for _, line := range strings.Split(mounts, "\n") {
		f := strings.Fields(line)
		if len(f) >= 4 && f[1] == "/data" {
			return f[3]
		}
	}
	return ""
}

func (d *doctor) checkStorage() Check {
	c := Check{ID: "storage", Title: "Storage (/data)"}
	var st syscall.Statfs_t
	if err := syscall.Statfs(d.p("/data"), &st); err != nil {
		c.Status, c.Detail = statusWarn, "could not read /data: "+errText(err)
		return c
	}
	bs := uint64(st.Bsize)
	space := pctUsed(sub(uint64(st.Blocks), uint64(st.Bfree)), uint64(st.Bavail))
	inodes := pctUsed(sub(uint64(st.Files), uint64(st.Ffree)), uint64(st.Ffree))
	freeMB := uint64(st.Bavail) * bs / (1024 * 1024)
	opts := ""
	if m, err := os.ReadFile(d.p("/proc/mounts")); err == nil {
		opts = dataMountOptions(string(m))
	}
	readOnly := false
	for _, o := range strings.Split(opts, ",") {
		if o == "ro" {
			readOnly = true
		}
	}
	shown := opts
	if shown == "" {
		shown = "?"
	}
	c.Data = map[string]interface{}{"space_used_percent": space, "inodes_used_percent": inodes, "free_mb": freeMB, "read_only": readOnly}
	c.Detail = fmt.Sprintf("/data options %s; space %d%% used (%d MB free); inodes %d%% used", shown, space, freeMB, inodes)
	switch {
	case readOnly:
		c.Status = statusFail
		c.Detail += " - /data is READ-ONLY"
		c.Hint = "A filesystem error remounted /data read-only: reboot. Settings, plugins and boot.sh cannot be saved until it is writable."
	case space >= 95 || inodes >= 95:
		c.Status = statusWarn
		c.Detail += " - almost full"
		c.Hint = "Free space (logs, old files); a full /data breaks settings and root."
	default:
		c.Status = statusOK
	}
	return c
}

// ---------- CA certificates, TLS ----------

// minCerts is the size below which the store looks cut down. The F50 has 125.
const minCerts = 20

func (d *doctor) checkCA() Check {
	c := Check{ID: "ca", Title: "CA certificates"}
	var dir string
	var names []string
	for _, cand := range []string{"/apex/com.android.conscrypt/cacerts", "/system/etc/security/cacerts"} {
		ents, err := os.ReadDir(d.p(cand))
		if err != nil {
			continue
		}
		var files []string
		for _, e := range ents {
			if !e.IsDir() {
				files = append(files, e.Name())
			}
		}
		if len(files) > 0 {
			dir, names = cand, files
			break
		}
	}
	if dir == "" {
		c.Status, c.Detail = statusFail, "no CA certificate folder found (/apex/com.android.conscrypt/cacerts or /system/etc/security/cacerts)"
		c.Hint = "Without a CA store, https from curl and from programs run by plugins fails with an unknown-CA error."
		return c
	}
	pool := x509.NewCertPool()
	good, bad := 0, 0
	for _, n := range names {
		b, err := os.ReadFile(filepath.Join(d.p(dir), n))
		if err != nil {
			bad++
			continue
		}
		if pool.AppendCertsFromPEM(b) {
			good++
		} else if cert, err := x509.ParseCertificate(b); err == nil {
			pool.AddCert(cert)
			good++
		} else {
			bad++
		}
	}
	bundle := "curl bundle not built yet (the app makes it at the first root script)"
	bundleCerts := 0
	if b, err := os.ReadFile(d.p("/data/local/matchitool/bin/cacert.pem")); err == nil {
		bundleCerts = bytes.Count(b, []byte("BEGIN CERTIFICATE"))
		bundle = fmt.Sprintf("curl bundle has %d certificates", bundleCerts)
	}
	c.Data = map[string]interface{}{"dir": dir, "read": good, "unreadable": bad, "bundle_certs": bundleCerts}
	c.Detail = fmt.Sprintf("%d certificates read from %s", good, dir)
	if bad > 0 {
		c.Detail += fmt.Sprintf(" (%d files could not be read)", bad)
	}
	c.Detail += "; " + bundle
	switch {
	case good == 0:
		c.Status = statusFail
		c.Hint = "The folder exists but no certificate in it could be read."
	case good < minCerts:
		c.Status = statusWarn
		c.Hint = fmt.Sprintf("Only %d certificates: the store looks cut down, and https to some sites will fail.", good)
		d.pool = pool
	default:
		c.Status = statusOK
		d.pool = pool
	}
	return c
}

// verifyFailure is true when the handshake got as far as checking the certificate and rejected it (as opposed to no connection).
func verifyFailure(err error) bool {
	var ua x509.UnknownAuthorityError
	var inv x509.CertificateInvalidError
	var host x509.HostnameError
	return errors.As(err, &ua) || errors.As(err, &inv) || errors.As(err, &host)
}

func (d *doctor) checkTLS() Check {
	c := Check{ID: "tls", Title: "TLS handshake"}
	if d.pool == nil {
		c.Status, c.Detail = statusSkip, "no CA store was read, so there is nothing to test with"
		return c
	}
	host, _, err := net.SplitHostPort(d.cfg.tlsAddr)
	if err != nil {
		c.Status, c.Detail = statusWarn, "bad -tls address "+d.cfg.tlsAddr+": "+errText(err)
		return c
	}
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: d.cfg.netTimeout}, "tcp", d.cfg.tlsAddr,
		&tls.Config{RootCAs: d.pool, ServerName: host, MinVersion: tls.VersionTLS12})
	if err != nil {
		if verifyFailure(err) {
			c.Status, c.Detail = statusFail, "the server certificate was not accepted by the device's CA store: "+errText(err)
			c.Hint = "An unknown-authority error here is the one curl showed before the CA bundle fix. An expired-certificate error means the device clock is wrong."
			var inv x509.CertificateInvalidError
			if errors.As(err, &inv) && inv.Reason == x509.Expired {
				c.Hint = "The certificate is outside its dates. Set the correct date and time on the device."
			}
		} else {
			c.Status, c.Detail = statusWarn, "could not connect to "+d.cfg.tlsAddr+": "+errText(err)
			c.Hint = "No route, no DNS or no mobile data. Not a CA problem."
		}
		return c
	}
	defer conn.Close()
	st := conn.ConnectionState()
	c.Status = statusOK
	c.Detail = fmt.Sprintf("%s handshake with %s verified against the device's CA store", tls.VersionName(st.Version), d.cfg.tlsAddr)
	c.Data = map[string]interface{}{"version": tls.VersionName(st.Version), "addr": d.cfg.tlsAddr}
	return c
}

// ---------- router ----------

var errNoHTTP = errors.New("the port is open but did not answer with HTTP")

// httpStatus connects, asks for "/" and returns the status code of the first line of the answer.
func httpStatus(addr, host string, timeout time.Duration) (int, error) {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if _, err := fmt.Fprintf(conn, "GET / HTTP/1.0\r\nHost: %s\r\nConnection: close\r\n\r\n", host); err != nil {
		return 0, err
	}
	line, err := bufio.NewReader(io.LimitReader(conn, 512)).ReadString('\n')
	if err != nil && line == "" {
		return 0, errNoHTTP
	}
	f := strings.Fields(line)
	if len(f) < 2 || !strings.HasPrefix(f[0], "HTTP/") {
		return 0, errNoHTTP
	}
	code, err := strconv.Atoi(f[1])
	if err != nil {
		return 0, errNoHTTP
	}
	return code, nil
}

func (d *doctor) checkRouter() Check {
	c := Check{ID: "router", Title: "Router web server"}
	primary := d.cfg.routerPorts[0]
	openNoHTTP := ""
	for _, port := range d.cfg.routerPorts {
		addr := net.JoinHostPort(d.cfg.router, strconv.Itoa(port))
		code, err := httpStatus(addr, d.cfg.router, d.cfg.netTimeout)
		if err == nil {
			c.Status = statusOK
			c.Detail = fmt.Sprintf("the router answers HTTP on %s (status %d)", addr, code)
			if port != primary {
				c.Detail += fmt.Sprintf(" - not on %d; the app tries the other usual ports too", primary)
			}
			c.Data = map[string]interface{}{"host": d.cfg.router, "port": port, "http_status": code}
			return c
		}
		if errors.Is(err, errNoHTTP) && openNoHTTP == "" {
			openNoHTTP = addr
		}
	}
	c.Status = statusWarn
	if openNoHTTP != "" {
		c.Detail = openNoHTTP + " is open but did not answer with HTTP"
	} else {
		ports := make([]string, len(d.cfg.routerPorts))
		for i, p := range d.cfg.routerPorts {
			ports[i] = strconv.Itoa(p)
		}
		c.Detail = fmt.Sprintf("no web server answered on %s ports %s", d.cfg.router, strings.Join(ports, ", "))
	}
	c.Hint = "Check the router address; if the router page uses another port, give the gateway as host:port in the app."
	return c
}

// ---------- modem AT port ----------

// readPin returns the port pinned for a slot in sendat.conf ("0=/dev/stty_nr6"), "" when there is none. Same format as tools/sendat.
func readPin(confPath string, slot int) string {
	b, err := os.ReadFile(confPath)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if n, err := strconv.Atoi(strings.TrimSpace(k)); err == nil && n == slot {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// knownHeld, findHolders and skipReason are the rules of tools/sendat (copied on purpose: two small programs, merged in Phase 8):
// on the F50 urild (the RIL) holds stty_nr0..5, engpc holds stty_nr31 and one more process holds stty_nr28. Writing "AT" to a port the
// RIL reads can drop mobile data, so a port someone else holds is reported and left alone.
func knownHeld() map[string]string {
	m := map[string]string{"/dev/stty_nr28": "cplog_svc", "/dev/stty_nr31": "engpc"}
	for i := 0; i <= 5; i++ {
		m["/dev/stty_nr"+strconv.Itoa(i)] = "urild"
	}
	return m
}

// findHolders maps a /dev path to "name (pid N)" for every other process that has it open. Needs root to see other users' processes.
func findHolders(procDir string, self int) map[string]string {
	m := map[string]string{}
	ents, err := os.ReadDir(procDir)
	if err != nil {
		return m
	}
	for _, e := range ents {
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid == self {
			continue
		}
		b, _ := os.ReadFile(filepath.Join(procDir, e.Name(), "comm"))
		name := strings.TrimSpace(string(b))
		if name == "sendat" {
			continue
		}
		if name == "" {
			name = "?"
		}
		fds, err := os.ReadDir(filepath.Join(procDir, e.Name(), "fd"))
		if err != nil {
			continue
		}
		for _, f := range fds {
			target, err := os.Readlink(filepath.Join(procDir, e.Name(), "fd", f.Name()))
			if err != nil || !strings.HasPrefix(target, "/dev/") {
				continue
			}
			if _, seen := m[target]; !seen {
				m[target] = fmt.Sprintf("%s (pid %d)", name, pid)
			}
		}
	}
	return m
}

func skipReason(path string, holders, known map[string]string) string {
	if h, ok := holders[path]; ok {
		return "held by " + h
	}
	if n, ok := known[path]; ok {
		return "normally held by " + n
	}
	return ""
}

// execSendat runs sendat and returns what it printed, its exit code, and an error only when it could not be run or did not finish.
func execSendat(path string, args []string, timeout time.Duration) (string, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout+2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, args...).CombinedOutput()
	if len(out) > 512 {
		out = out[:512]
	}
	if ctx.Err() != nil {
		return strings.TrimSpace(string(out)), -1, fmt.Errorf("sendat did not finish within %d s", int(timeout/time.Second)+2)
	}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return strings.TrimSpace(string(out)), ee.ExitCode(), nil
		}
		return strings.TrimSpace(string(out)), -1, err
	}
	return strings.TrimSpace(string(out)), 0, nil
}

// finalOK is true when the last non-empty line of an AT answer is OK.
func finalOK(out string) bool {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	return strings.TrimSpace(lines[len(lines)-1]) == "OK"
}

func (d *doctor) checkAT() Check {
	c := Check{ID: "at", Title: "Modem AT, slot 0"}
	c.Data = map[string]interface{}{"slot1": "not tested: the F50 has one SIM slot, and a write to slot 1 reaches the RIL"}
	if fi, err := os.Stat(d.cfg.sendat); d.cfg.sendat == "" || err != nil || fi.IsDir() || fi.Mode()&0o111 == 0 {
		c.Status, c.Detail = statusFail, "sendat is missing or not executable ("+d.cfg.sendat+")"
		c.Hint = "Restart the MatchiTOOL host so the app copies sendat again."
		return c
	}
	secs := strconv.Itoa(int(d.cfg.atTimeout / time.Second))
	args := []string{"-n", "0", "-c", "AT", "-t", secs}
	port := "the default port for slot 0"
	if pin := readPin(d.cfg.conf, 0); pin != "" {
		if _, err := os.Stat(d.p(pin)); err != nil {
			c.Status, c.Detail = statusFail, "the pinned port "+pin+" does not exist"
			c.Hint = "Run sendat -probe on the device and pin a port that answers (sendat.conf: 0=/dev/...)."
			return c
		}
		if why := skipReason(pin, findHolders(d.p("/proc"), os.Getpid()), knownHeld()); why != "" {
			c.Status, c.Detail = statusWarn, "the pinned port "+pin+" is "+why+"; not touched"
			c.Hint = "Pin a free port that answers AT (sendat -probe); writing to a port the RIL reads can drop mobile data."
			c.Data["port"] = pin
			return c
		}
		args = []string{"-d", pin, "-c", "AT", "-t", secs}
		port = pin
		c.Data["port"] = pin
	}
	start := time.Now()
	out, code, err := d.cfg.runSendat(d.cfg.sendat, args, d.cfg.atTimeout)
	ms := time.Since(start).Milliseconds()
	c.Data["ms"] = ms
	switch {
	case err != nil:
		c.Status, c.Detail = statusFail, "could not run sendat: "+errText(err)
	case code == 0 && finalOK(out):
		c.Status, c.Detail = statusOK, fmt.Sprintf("the modem answered OK on %s (%d ms)", port, ms)
	case code == 3:
		c.Status, c.Detail = statusFail, fmt.Sprintf("no answer from the modem on %s within %s s", port, secs)
		c.Hint = "Check that the port answers AT (sendat -probe) and that no other program is reading it."
	default:
		text := strings.Join(strings.Fields(out), " ")
		if text == "" {
			text = "no output"
		}
		c.Status, c.Detail = statusFail, fmt.Sprintf("no OK from the modem on %s (exit %d): %s", port, code, text)
	}
	return c
}

// ---------- bundled binaries ----------

// elfKind says what the first bytes of a file are: an arm64 ELF, another ELF, or not an ELF file.
func elfKind(head []byte) string {
	if len(head) < 20 || !bytes.Equal(head[:4], []byte{0x7f, 'E', 'L', 'F'}) {
		return "not an ELF file"
	}
	if head[4] == 2 && head[18] == 0xB7 && head[19] == 0x00 {
		return "arm64 ELF"
	}
	return "an ELF file for another CPU"
}

func allZero(b []byte) bool {
	for _, x := range b {
		if x != 0 {
			return false
		}
	}
	return len(b) > 0
}

func (d *doctor) checkBinaries() Check {
	c := Check{ID: "binaries", Title: "Bundled binaries"}
	if d.cfg.filesDir == "" || len(d.cfg.hashes) == 0 {
		c.Status, c.Detail = statusSkip, "no -files folder or no -hash given"
		return c
	}
	var parts []string
	states := map[string]interface{}{}
	bad := 0
	for _, h := range d.cfg.hashes {
		b, err := os.ReadFile(filepath.Join(d.cfg.filesDir, h.name))
		switch {
		case err != nil:
			bad++
			states[h.name] = "missing"
			parts = append(parts, h.name+": missing")
		case allZero(b):
			bad++
			states[h.name] = "zero"
			parts = append(parts, h.name+": every byte is zero (a copy lost at a reboot)")
		default:
			sum := sha256.Sum256(b)
			if hex.EncodeToString(sum[:]) == h.sum {
				states[h.name] = "ok"
				parts = append(parts, h.name+": ok")
			} else {
				bad++
				states[h.name] = "mismatch"
				parts = append(parts, fmt.Sprintf("%s: does not match the build (%s, %d bytes)", h.name, elfKind(b), len(b)))
			}
		}
	}
	c.Data = map[string]interface{}{"files": states}
	c.Detail = strings.Join(parts, "; ")
	if bad > 0 {
		c.Status = statusFail
		c.Hint = "Restart the MatchiTOOL host: the app copies a file that does not match the build again."
	} else {
		c.Status = statusOK
		c.Detail = fmt.Sprintf("%d files, all match the hash from the build", len(d.cfg.hashes))
	}
	return c
}
