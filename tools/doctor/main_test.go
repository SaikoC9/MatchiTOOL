package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Values below were read on a ZTE F50 (MU300, Android 13) on 19 Nov 2026: 1.5 GB of RAM with about 680 MB free, f2fs on /data,
// SELinux permissive, 125 CA certificates, urild holding /dev/stty_nr0..5, the pinned port /dev/stty_nr6.
const f50Meminfo = "MemTotal:        1503044 kB\nMemFree:          301236 kB\nMemAvailable:     680000 kB\nBuffers:           20112 kB\nCached:           420980 kB\n"

const f50Mounts = "/dev/block/by-name/userdata /data f2fs rw,lazytime,seclabel,nosuid,nodev,noatime,fsync_mode=nobarrier 0 0\n" +
	"/dev/block/by-name/userdata /data/media f2fs rw,seclabel 0 0\n"

func put(t *testing.T, root, rel, content string) string {
	t.Helper()
	p := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func newDoctor(root string) *doctor {
	return &doctor{cfg: config{
		root: root, uid: 0, router: "127.0.0.1", routerPorts: []int{8080},
		atTimeout: 2 * time.Second, netTimeout: time.Second, skip: map[string]bool{},
		conf: root + "/data/local/matchitool/sendat.conf",
	}}
}

// tlsServer starts a TLS server and returns it with its certificate as PEM.
func tlsServer(t *testing.T) (*httptest.Server, []byte) {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Config.ErrorLog = log.New(io.Discard, "", 0)
	t.Cleanup(srv.Close)
	return srv, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
}

// closedAddr is a loopback address nothing listens on.
func closedAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	return addr
}

func portOf(t *testing.T, addr string) int {
	t.Helper()
	_, p, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	n, err := strconv.Atoi(p)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func sumHex(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

// ---------- root, SELinux ----------

func TestRoot(t *testing.T) {
	d := newDoctor(t.TempDir())
	if c := d.checkRoot(); c.Status != statusOK || !strings.Contains(c.Detail, "uid 0") {
		t.Fatalf("uid 0: %+v", c)
	}
	d.cfg.uid = 2000
	if c := d.checkRoot(); c.Status != statusFail || !strings.Contains(c.Detail, "uid 2000") || c.Hint == "" {
		t.Fatalf("uid 2000: %+v", c)
	}
}

func TestSELinux(t *testing.T) {
	root := t.TempDir()
	d := newDoctor(root)
	if c := d.checkSELinux(); c.Status != statusSkip {
		t.Fatalf("no SELinux folder should be skip: %+v", c)
	}
	put(t, root, "sys/fs/selinux/enforce", "0\n")
	if c := d.checkSELinux(); c.Status != statusOK || !strings.HasPrefix(c.Detail, "Permissive") || c.Data["mode"] != "permissive" {
		t.Fatalf("permissive: %+v", c)
	}
	put(t, root, "sys/fs/selinux/enforce", "1")
	if c := d.checkSELinux(); c.Status != statusOK || c.Detail != "Enforcing" || c.Hint == "" {
		t.Fatalf("enforcing: %+v", c)
	}
	put(t, root, "sys/fs/selinux/enforce", "x")
	if c := d.checkSELinux(); c.Status != statusWarn {
		t.Fatalf("odd value: %+v", c)
	}
}

// ---------- memory, storage ----------

func TestMeminfoKB(t *testing.T) {
	if n, ok := meminfoKB(f50Meminfo, "MemTotal"); !ok || n != 1503044 {
		t.Fatalf("MemTotal: %d %v", n, ok)
	}
	if _, ok := meminfoKB(f50Meminfo, "Nope"); ok {
		t.Fatal("a missing key must not be found")
	}
	if _, ok := meminfoKB("MemTotal: abc kB\n", "MemTotal"); ok {
		t.Fatal("a bad number must not be accepted")
	}
}

func TestMemoryLevels(t *testing.T) {
	root := t.TempDir()
	d := newDoctor(root)
	cases := []struct {
		avail  string
		status string
		shown  string
	}{
		{"680000", statusOK, "free memory 45%"},
		{"120000", statusWarn, "free memory 8%"},
		{"50000", statusFail, "free memory 3%"},
	}
	for _, tc := range cases {
		put(t, root, "proc/meminfo", "MemTotal: 1503044 kB\nMemAvailable: "+tc.avail+" kB\n")
		c := d.checkMemory()
		if c.Status != tc.status || !strings.Contains(c.Detail, tc.shown) {
			t.Errorf("avail %s: want %s %q, got %+v", tc.avail, tc.status, tc.shown, c)
		}
	}
	put(t, root, "proc/meminfo", "MemTotal: 1503044 kB\n")
	if c := d.checkMemory(); c.Status != statusWarn {
		t.Errorf("no MemAvailable should warn: %+v", c)
	}
}

func TestPctUsed(t *testing.T) {
	for _, tc := range []struct {
		used, avail uint64
		want        int
	}{{0, 0, 0}, {1, 2, 34}, {95, 5, 95}, {100, 0, 100}, {0, 50, 0}} {
		if got := pctUsed(tc.used, tc.avail); got != tc.want {
			t.Errorf("pctUsed(%d,%d) = %d, want %d", tc.used, tc.avail, got, tc.want)
		}
	}
}

func TestDataMountOptions(t *testing.T) {
	if got := dataMountOptions(f50Mounts); !strings.HasPrefix(got, "rw,lazytime") {
		t.Fatalf("got %q", got)
	}
	if got := dataMountOptions("tmpfs /tmp tmpfs rw 0 0\n"); got != "" {
		t.Fatalf("no /data line must give an empty string, got %q", got)
	}
}

func TestStorage(t *testing.T) {
	root := t.TempDir()
	d := newDoctor(root)
	if c := d.checkStorage(); c.Status != statusWarn {
		t.Fatalf("no /data folder should warn: %+v", c)
	}
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	put(t, root, "proc/mounts", f50Mounts)
	c := d.checkStorage()
	if c.Status == statusFail || !strings.Contains(c.Detail, "/data options rw,lazytime") || c.Data["read_only"] != false {
		t.Fatalf("rw /data: %+v", c)
	}
	put(t, root, "proc/mounts", "/dev/block/by-name/userdata /data f2fs ro,seclabel 0 0\n")
	c = d.checkStorage()
	if c.Status != statusFail || !strings.Contains(c.Detail, "READ-ONLY") || c.Data["read_only"] != true {
		t.Fatalf("ro /data: %+v", c)
	}
}

// ---------- CA certificates, TLS ----------

func writeCerts(t *testing.T, root, dir string, n int, certPEM []byte) {
	t.Helper()
	for i := 0; i < n; i++ {
		put(t, root, dir+"/cert"+strconv.Itoa(i)+".0", string(certPEM))
	}
}

func TestCA(t *testing.T) {
	_, certPEM := tlsServer(t)

	t.Run("apex folder with enough certificates", func(t *testing.T) {
		root := t.TempDir()
		writeCerts(t, root, "apex/com.android.conscrypt/cacerts", 25, certPEM)
		d := newDoctor(root)
		c := d.checkCA()
		if c.Status != statusOK || !strings.Contains(c.Detail, "25 certificates read from /apex/com.android.conscrypt/cacerts") || d.pool == nil {
			t.Fatalf("%+v", c)
		}
		if !strings.Contains(c.Detail, "curl bundle not built yet") {
			t.Fatalf("no bundle yet should be said: %s", c.Detail)
		}
	})
	t.Run("falls back to the system folder, few certificates warn", func(t *testing.T) {
		root := t.TempDir()
		writeCerts(t, root, "system/etc/security/cacerts", 5, certPEM)
		d := newDoctor(root)
		c := d.checkCA()
		if c.Status != statusWarn || !strings.Contains(c.Detail, "/system/etc/security/cacerts") || d.pool == nil {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("a folder of junk fails and gives no pool", func(t *testing.T) {
		root := t.TempDir()
		put(t, root, "apex/com.android.conscrypt/cacerts/a.0", "not a certificate")
		d := newDoctor(root)
		c := d.checkCA()
		if c.Status != statusFail || d.pool != nil {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("no folder fails", func(t *testing.T) {
		d := newDoctor(t.TempDir())
		if c := d.checkCA(); c.Status != statusFail || !strings.Contains(c.Detail, "no CA certificate folder") {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("the curl bundle is counted", func(t *testing.T) {
		root := t.TempDir()
		writeCerts(t, root, "apex/com.android.conscrypt/cacerts", 25, certPEM)
		put(t, root, "data/local/matchitool/bin/cacert.pem", strings.Repeat(string(certPEM), 3))
		c := newDoctor(root).checkCA()
		if !strings.Contains(c.Detail, "curl bundle has 3 certificates") {
			t.Fatalf("%s", c.Detail)
		}
	})
}

func TestTLS(t *testing.T) {
	srv, _ := tlsServer(t)
	d := newDoctor(t.TempDir())
	d.cfg.tlsAddr = srv.Listener.Addr().String()

	if c := d.checkTLS(); c.Status != statusSkip {
		t.Fatalf("no pool should skip: %+v", c)
	}
	d.pool = x509.NewCertPool()
	d.pool.AddCert(srv.Certificate())
	if c := d.checkTLS(); c.Status != statusOK || !strings.Contains(c.Detail, "verified against the device's CA store") {
		t.Fatalf("trusted server: %+v", c)
	}
	d.pool = x509.NewCertPool()
	c := d.checkTLS()
	if c.Status != statusFail || !strings.Contains(c.Detail, "not accepted") {
		t.Fatalf("server the store does not trust: %+v", c)
	}
	d.pool.AddCert(srv.Certificate())
	d.cfg.tlsAddr = closedAddr(t)
	if c := d.checkTLS(); c.Status != statusWarn || !strings.Contains(c.Detail, "could not connect") {
		t.Fatalf("no server: %+v", c)
	}
	d.cfg.tlsAddr = "no-port"
	if c := d.checkTLS(); c.Status != statusWarn {
		t.Fatalf("bad address: %+v", c)
	}
}

// ---------- router ----------

func TestRouter(t *testing.T) {
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer web.Close()
	webPort := portOf(t, web.Listener.Addr().String())
	deadPort := portOf(t, closedAddr(t))
	d := newDoctor(t.TempDir())

	d.cfg.routerPorts = []int{webPort}
	c := d.checkRouter()
	if c.Status != statusOK || !strings.Contains(c.Detail, "status 401") || strings.Contains(c.Detail, "not on") {
		t.Fatalf("answer on the first port: %+v", c)
	}
	d.cfg.routerPorts = []int{deadPort, webPort}
	if c := d.checkRouter(); c.Status != statusOK || !strings.Contains(c.Detail, "not on "+strconv.Itoa(deadPort)) {
		t.Fatalf("answer on a later port: %+v", c)
	}
	d.cfg.routerPorts = []int{deadPort}
	if c := d.checkRouter(); c.Status != statusWarn || !strings.Contains(c.Detail, "no web server answered") {
		t.Fatalf("nothing listens: %+v", c)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			_, _ = bufio.NewReader(conn).ReadString('\n') // wait for the request line, then answer with something that is not HTTP
			_, _ = conn.Write([]byte("hello\n"))
			conn.Close()
		}
	}()
	d.cfg.routerPorts = []int{portOf(t, ln.Addr().String())}
	if c := d.checkRouter(); c.Status != statusWarn || !strings.Contains(c.Detail, "did not answer with HTTP") {
		t.Fatalf("open port that is not HTTP: %+v", c)
	}
}

// ---------- modem AT port ----------

type fakeSendat struct {
	calls  int
	args   []string
	out    string
	code   int
	err    error
	called bool
}

func (f *fakeSendat) run(path string, args []string, timeout time.Duration) (string, int, error) {
	f.calls++
	f.called = true
	f.args = args
	return f.out, f.code, f.err
}

func atSetup(t *testing.T, conf string) (*doctor, *fakeSendat, string) {
	t.Helper()
	root := t.TempDir()
	d := newDoctor(root)
	sendat := put(t, root, "files/sendat", "#!/bin/sh\n")
	if err := os.Chmod(sendat, 0o755); err != nil {
		t.Fatal(err)
	}
	d.cfg.sendat = sendat
	if conf != "" {
		put(t, root, "data/local/matchitool/sendat.conf", conf)
	}
	put(t, root, "dev/stty_nr6", "")
	put(t, root, "dev/stty_nr0", "")
	f := &fakeSendat{out: "AT\nOK", code: 0}
	d.cfg.runSendat = f.run
	return d, f, root
}

func TestATPinnedPortFree(t *testing.T) {
	d, f, _ := atSetup(t, "# the F50\n0=/dev/stty_nr6\n")
	c := d.checkAT()
	if c.Status != statusOK || !strings.Contains(c.Detail, "answered OK on /dev/stty_nr6") {
		t.Fatalf("%+v", c)
	}
	if got := strings.Join(f.args, " "); got != "-d /dev/stty_nr6 -c AT -t 2" {
		t.Fatalf("sendat was called with %q", got)
	}
}

func TestATUnpinned(t *testing.T) {
	d, f, _ := atSetup(t, "")
	c := d.checkAT()
	if c.Status != statusOK || !strings.Contains(c.Detail, "default port for slot 0") {
		t.Fatalf("%+v", c)
	}
	if got := strings.Join(f.args, " "); got != "-n 0 -c AT -t 2" {
		t.Fatalf("sendat was called with %q", got)
	}
}

func TestATPortHeldByAnotherProcess(t *testing.T) {
	d, f, root := atSetup(t, "0=/dev/stty_nr6\n")
	put(t, root, "proc/4242/comm", "urild\n")
	if err := os.MkdirAll(filepath.Join(root, "proc/4242/fd"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/dev/stty_nr6", filepath.Join(root, "proc/4242/fd/7")); err != nil {
		t.Skip("symlinks are not available here:", err)
	}
	c := d.checkAT()
	if c.Status != statusWarn || !strings.Contains(c.Detail, "held by urild (pid 4242)") || !strings.Contains(c.Detail, "not touched") {
		t.Fatalf("%+v", c)
	}
	if f.called {
		t.Fatal("sendat must not be started for a port another process holds")
	}
}

func TestATPortHeldBySendatDoesNotCount(t *testing.T) {
	d, f, root := atSetup(t, "0=/dev/stty_nr6\n")
	put(t, root, "proc/4243/comm", "sendat\n")
	if err := os.MkdirAll(filepath.Join(root, "proc/4243/fd"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/dev/stty_nr6", filepath.Join(root, "proc/4243/fd/3")); err != nil {
		t.Skip("symlinks are not available here:", err)
	}
	if c := d.checkAT(); c.Status != statusOK || !f.called {
		t.Fatalf("another sendat is not a reason to leave the port alone: %+v", c)
	}
}

func TestATKnownRILPortWithoutProc(t *testing.T) {
	d, f, _ := atSetup(t, "0=/dev/stty_nr0\n")
	c := d.checkAT()
	if c.Status != statusWarn || !strings.Contains(c.Detail, "normally held by urild") || f.called {
		t.Fatalf("%+v called=%v", c, f.called)
	}
}

func TestATFailures(t *testing.T) {
	t.Run("pinned port is gone", func(t *testing.T) {
		d, f, _ := atSetup(t, "0=/dev/stty_nr9\n")
		if c := d.checkAT(); c.Status != statusFail || !strings.Contains(c.Detail, "does not exist") || f.called {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("timeout", func(t *testing.T) {
		d, f, _ := atSetup(t, "0=/dev/stty_nr6\n")
		f.out, f.code = "", 3
		if c := d.checkAT(); c.Status != statusFail || !strings.Contains(c.Detail, "no answer from the modem") {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("ERROR answer", func(t *testing.T) {
		d, f, _ := atSetup(t, "0=/dev/stty_nr6\n")
		f.out, f.code = "ERROR", 1
		if c := d.checkAT(); c.Status != statusFail || !strings.Contains(c.Detail, "(exit 1): ERROR") {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("exit 0 without OK", func(t *testing.T) {
		d, f, _ := atSetup(t, "0=/dev/stty_nr6\n")
		f.out, f.code = "+CME ERROR: 10", 0
		if c := d.checkAT(); c.Status != statusFail {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("sendat cannot run", func(t *testing.T) {
		d, f, _ := atSetup(t, "0=/dev/stty_nr6\n")
		f.err = os.ErrPermission
		if c := d.checkAT(); c.Status != statusFail || !strings.Contains(c.Detail, "could not run sendat") {
			t.Fatalf("%+v", c)
		}
	})
	t.Run("sendat is missing", func(t *testing.T) {
		d, f, _ := atSetup(t, "0=/dev/stty_nr6\n")
		d.cfg.sendat = filepath.Join(t.TempDir(), "sendat")
		if c := d.checkAT(); c.Status != statusFail || !strings.Contains(c.Detail, "missing or not executable") || f.called {
			t.Fatalf("%+v", c)
		}
	})
}

func TestFinalOK(t *testing.T) {
	for out, want := range map[string]bool{"OK": true, "AT\nOK": true, "AT\nOK\n": true, "ERROR": false, "OK\nERROR": false, "": false} {
		if got := finalOK(out); got != want {
			t.Errorf("finalOK(%q) = %v, want %v", out, got, want)
		}
	}
}

func TestReadPin(t *testing.T) {
	root := t.TempDir()
	conf := put(t, root, "sendat.conf", "# comment\n\n 1 = /dev/stty_nr7 \n0=/dev/stty_nr6\nbad line\n")
	if got := readPin(conf, 0); got != "/dev/stty_nr6" {
		t.Errorf("slot 0: %q", got)
	}
	if got := readPin(conf, 1); got != "/dev/stty_nr7" {
		t.Errorf("slot 1: %q", got)
	}
	if got := readPin(filepath.Join(root, "missing.conf"), 0); got != "" {
		t.Errorf("missing file: %q", got)
	}
}

// ---------- bundled binaries ----------

func TestElfKind(t *testing.T) {
	arm := make([]byte, 24)
	copy(arm, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	arm[18], arm[19] = 0xB7, 0x00
	x86 := append([]byte(nil), arm...)
	x86[18] = 0x3E
	for _, tc := range []struct {
		head []byte
		want string
	}{{arm, "arm64 ELF"}, {x86, "an ELF file for another CPU"}, {[]byte("#!/bin/sh\n and some more text"), "not an ELF file"}, {nil, "not an ELF file"}} {
		if got := elfKind(tc.head); got != tc.want {
			t.Errorf("elfKind = %q, want %q", got, tc.want)
		}
	}
}

func TestBinaries(t *testing.T) {
	root := t.TempDir()
	alpha := bytes.Repeat([]byte("A"), 100)
	put(t, root, "alpha", string(alpha))
	put(t, root, "beta", "this is not what the build made")
	put(t, root, "zero", string(make([]byte, 64)))
	d := newDoctor(root)
	d.cfg.filesDir = root

	d.cfg.hashes = hashList{{"alpha", sumHex(alpha)}}
	if c := d.checkBinaries(); c.Status != statusOK || !strings.Contains(c.Detail, "1 files, all match") {
		t.Fatalf("one good file: %+v", c)
	}

	d.cfg.hashes = hashList{{"alpha", sumHex(alpha)}, {"beta", sumHex([]byte("something else"))}, {"gamma", sumHex(nil)}, {"zero", sumHex([]byte("x"))}}
	c := d.checkBinaries()
	if c.Status != statusFail {
		t.Fatalf("%+v", c)
	}
	for _, want := range []string{"alpha: ok", "beta: does not match the build (not an ELF file, 31 bytes)", "gamma: missing", "zero: every byte is zero"} {
		if !strings.Contains(c.Detail, want) {
			t.Errorf("detail lacks %q: %s", want, c.Detail)
		}
	}
	files := c.Data["files"].(map[string]interface{})
	if files["alpha"] != "ok" || files["beta"] != "mismatch" || files["gamma"] != "missing" || files["zero"] != "zero" {
		t.Errorf("states: %v", files)
	}

	d.cfg.hashes = nil
	if c := d.checkBinaries(); c.Status != statusSkip {
		t.Errorf("no hashes should skip: %+v", c)
	}
}

func TestHashFlag(t *testing.T) {
	var h hashList
	good := strings.Repeat("AB", 32)
	if err := h.Set("sendat=" + good); err != nil || len(h) != 1 || h[0].sum != strings.ToLower(good) {
		t.Fatalf("good value: %v %v", err, h)
	}
	for _, bad := range []string{"nothing", "=" + good, "a/b=" + good, "a=zz", "a=" + good[:60]} {
		if err := h.Set(bad); err == nil {
			t.Errorf("%q should be refused", bad)
		}
	}
}

// ---------- the whole report ----------

func TestCollectEverything(t *testing.T) {
	srv, certPEM := tlsServer(t)
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer web.Close()

	d, f, root := atSetup(t, "0=/dev/stty_nr6\n")
	put(t, root, "proc/meminfo", f50Meminfo)
	put(t, root, "proc/mounts", f50Mounts)
	put(t, root, "sys/fs/selinux/enforce", "0\n")
	if err := os.MkdirAll(filepath.Join(root, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeCerts(t, root, "apex/com.android.conscrypt/cacerts", 30, certPEM)
	sendatBytes := []byte("#!/bin/sh\n")
	cfg := d.cfg
	cfg.filesDir = filepath.Dir(cfg.sendat)
	cfg.hashes = hashList{{"sendat", sumHex(sendatBytes)}}
	cfg.tlsAddr = srv.Listener.Addr().String()
	cfg.routerPorts = []int{portOf(t, web.Listener.Addr().String())}

	rep := collect(cfg, time.Unix(1700000000, 0))
	var ids []string
	for _, c := range rep.Checks {
		ids = append(ids, c.ID)
		if c.Status == statusFail {
			t.Errorf("%s failed: %s", c.ID, c.Detail)
		}
	}
	if got := strings.Join(ids, ","); got != "root,selinux,memory,storage,ca,tls,router,at,binaries" {
		t.Fatalf("checks in the report: %s", got)
	}
	if rep.Generated != 1700000000 || rep.Tool != version || f.calls != 1 {
		t.Fatalf("report header: %+v, sendat calls %d", rep, f.calls)
	}
	if n := rep.Summary[statusOK] + rep.Summary[statusWarn] + rep.Summary[statusFail] + rep.Summary[statusSkip]; n != len(rep.Checks) {
		t.Fatalf("summary %v does not add up to %d checks", rep.Summary, len(rep.Checks))
	}

	cfg.skip = map[string]bool{"at": true, "router": true, "tls": true}
	rep = collect(cfg, time.Unix(1700000000, 0))
	for _, c := range rep.Checks {
		if c.ID == "at" || c.ID == "router" || c.ID == "tls" {
			t.Errorf("%s should have been left out", c.ID)
		}
	}
	cfg.tlsAddr = ""
	cfg.skip = map[string]bool{}
	for _, c := range collect(cfg, time.Now()).Checks {
		if c.ID == "tls" {
			t.Error("the TLS check must be left out when no host is given")
		}
	}
}

// ---------- the command line ----------

func TestRunUsage(t *testing.T) {
	for _, args := range [][]string{
		{"-skip", "bogus"}, {"-router-ports", "abc"}, {"-router-ports", "70000"}, {"-at-timeout", "0"}, {"-net-timeout", "99"},
		{"-hash", "nope"}, {"stray"}, {"-no-such-flag"},
	} {
		var out, errw bytes.Buffer
		if code := run(args, &out, &errw); code != 2 {
			t.Errorf("run(%v) = %d, want 2 (out %q, err %q)", args, code, out.String(), errw.String())
		}
		if out.Len() != 0 {
			t.Errorf("run(%v) printed to stdout: %q", args, out.String())
		}
	}
}

func TestRunVersion(t *testing.T) {
	var out, errw bytes.Buffer
	if code := run([]string{"-version"}, &out, &errw); code != 0 || strings.TrimSpace(out.String()) != "matchi-doctor 1.0 (MatchiTOOL)" {
		t.Fatalf("code %d, out %q", code, out.String())
	}
}

func TestRunWritesOneJSONLine(t *testing.T) {
	root := t.TempDir()
	put(t, root, "proc/meminfo", f50Meminfo)
	put(t, root, "sys/fs/selinux/enforce", "0\n")
	var out, errw bytes.Buffer
	code := run([]string{"-root", root, "-skip", "storage,ca,router,at,binaries"}, &out, &errw)
	if code != 0 {
		t.Fatalf("code %d, stderr %q", code, errw.String())
	}
	if strings.Count(out.String(), "\n") != 1 || !strings.HasSuffix(out.String(), "\n") {
		t.Fatalf("want exactly one line, got %q", out.String())
	}
	var rep Report
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, c := range rep.Checks {
		ids = append(ids, c.ID)
	}
	if got := strings.Join(ids, ","); got != "root,selinux,memory" || rep.Tool != version || rep.Arch == "" {
		t.Fatalf("report: %s", out.String())
	}

	out.Reset()
	if code := run([]string{"-root", root, "-skip", "storage,ca,router,at,binaries", "-pretty"}, &out, &errw); code != 0 || strings.Count(out.String(), "\n") < 5 {
		t.Fatalf("-pretty should indent: code %d, %q", code, out.String())
	}
}

// failingWriter stands for a reader that went away.
type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestRunExitsWhenTheReaderIsGone(t *testing.T) {
	root := t.TempDir()
	var errw bytes.Buffer
	if code := run([]string{"-root", root, "-skip", "storage,ca,router,at,binaries,memory,selinux"}, failingWriter{}, &errw); code != 1 {
		t.Fatalf("code %d, want 1", code)
	}
}
