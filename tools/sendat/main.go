// sendat: send one AT command to the modem and print the reply.
//
// Drop-in for the UFI-TOOLS binary as MatchiTOOL calls it:
//
//	sendat -n <0|1> -c '<AT command>'
//
// Source is in this repository, stdlib only, built by .github/workflows/build-sendat.yml.
//
// The modem device is NOT guessed silently. Order of lookup for a slot:
//  1. -d /dev/xxx
//  2. env SENDAT_DEV0 / SENDAT_DEV1
//  3. /data/local/matchitool/sendat.conf  (lines like "0=/dev/stty_lte0")
//  4. first existing path of defaultDevices (a guess list, see README)
//
// Run `sendat -probe` as root on the device to see which port answers "AT".
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	usage    = "Usage: ./sendat -c <command> -n <0|1>"
	confPath = "/data/local/matchitool/sendat.conf"
)

// Guess list, per SIM slot. Verify with -probe on the real device, then pin the answer in sendat.conf.
// Slot 0 starts with /dev/stty_nr6 on purpose: on the F50 stty_nr0..5 belong to urild (the RIL, see knownHeld), nr6 is free, so a plain
// "sendat -n 0 -c AT" works without a sendat.conf and without touching a port the RIL reads. The held nr0 stays last, only as a fallback
// for a device that has no nr6. Slot 1 is unchanged: its free port on the F50 is not known yet (run -probe and send the output).
var defaultDevices = map[int][]string{
	0: {"/dev/stty_nr6", "/dev/stty_lte0", "/dev/smd11", "/dev/smd7", "/dev/ttyUSB2", "/dev/stty_nr0"},
	1: {"/dev/stty_lte1", "/dev/smd8", "/dev/ttyUSB3", "/dev/stty_nr1"},
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, out, errw *os.File) int {
	fs := flag.NewFlagSet("sendat", flag.ContinueOnError)
	fs.SetOutput(errw)
	cmd := fs.String("c", "", "AT command")
	slotS := fs.String("n", "0", "SIM slot, 0 or 1")
	dev := fs.String("d", "", "modem device path (overrides lookup)")
	secs := fs.Int("t", 8, "seconds to wait for the final result code")
	probe := fs.Bool("probe", false, "try \"AT\" on the likely modem ports and report which answer (skips ports other processes hold)")
	all := fs.Bool("all", false, "with -probe: also try ports other processes hold (can disturb the RIL and drop mobile data)")
	if err := fs.Parse(args); err != nil {
		return 1
	}
	if *probe {
		return runProbe(out, *all)
	}
	slot, err := strconv.Atoi(strings.TrimSpace(*slotS))
	if err != nil || (slot != 0 && slot != 1) {
		fmt.Fprintln(errw, "invalid slot")
		fmt.Fprintln(errw, usage)
		return 1
	}
	c := strings.TrimSpace(*cmd)
	if c == "" || strings.ContainsAny(c, "\r\n\x00") {
		fmt.Fprintln(errw, usage)
		return 1
	}
	path, err := resolve(slot, *dev)
	if err != nil {
		fmt.Fprintln(errw, "Shell error:", err)
		return 1
	}
	raw, status, err := sendOn(path, c, time.Duration(*secs)*time.Second)
	if err != nil {
		fmt.Fprintln(errw, "Shell error:", err)
		return 1
	}
	fmt.Fprintln(out, clean(raw, c))
	switch status {
	case statusOK:
		return 0
	case statusError:
		return 1
	default:
		fmt.Fprintln(errw, "timeout waiting for modem reply")
		return 3
	}
}

// ---------- device lookup ----------

func readConf() map[int]string {
	m := map[int]string{}
	b, err := os.ReadFile(confPath)
	if err != nil {
		return m
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
		n, err := strconv.Atoi(strings.TrimSpace(k))
		if err == nil && (n == 0 || n == 1) {
			m[n] = strings.TrimSpace(v)
		}
	}
	return m
}

func resolve(slot int, override string) (string, error) {
	if override != "" {
		return override, nil
	}
	if v := os.Getenv("SENDAT_DEV" + strconv.Itoa(slot)); v != "" {
		return v, nil
	}
	if v, ok := readConf()[slot]; ok && v != "" {
		return v, nil
	}
	for _, p := range defaultDevices[slot] {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("no modem AT device found for slot %d (run: sendat -probe, then set %s)", slot, confPath)
}

// Ports that other processes own on the F50 (read from /proc on the device, 16 Nov 2026): urild (the RIL) holds stty_nr0..5,
// cplog_svc holds stty_nr28 and engpc holds stty_nr31. Writing "AT" to a port the RIL is reading can confuse it; after a probe
// plus a radio restart the F50 lost mobile data (sipa_eth0 stayed down). The probe therefore skips them unless -all is given.
// This fixed list is only the fallback: findHolders asks /proc who really has a port open right now.
func knownHeld() map[string]string {
	m := map[string]string{"/dev/stty_nr28": "cplog_svc", "/dev/stty_nr31": "engpc"}
	for i := 0; i <= 5; i++ {
		m["/dev/stty_nr"+strconv.Itoa(i)] = "urild"
	}
	return m
}

// findHolders maps a /dev path to "name (pid N)" for every other process that has it open. It reads procDir/<pid>/fd, which needs
// root for other users' processes; without it the map is just smaller and knownHeld still applies. self is skipped, and so is
// another sendat (our own tool, which takes the flock on the port, is not a reason to leave a port alone).
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

// skipReason says why a port must not be probed; "" means it is fine to probe.
func skipReason(path string, holders, known map[string]string) string {
	if h, ok := holders[path]; ok {
		return "held by " + h
	}
	if n, ok := known[path]; ok {
		return "normally held by " + n
	}
	return ""
}

type sendFn func(path, cmd string, timeout time.Duration) (string, status, error)

// probeList tries "AT" on every existing port in paths that is not held by another process (all=true tries those too).
// It returns how many answered OK and how many were skipped.
func probeList(out io.Writer, paths []string, holders, known map[string]string, all bool, send sendFn) (found, skipped int) {
	for _, p := range paths {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if why := skipReason(p, holders, known); why != "" && !all {
			skipped++
			fmt.Fprintf(out, "%-18s skipped, %s\n", p, why)
			continue
		}
		raw, st, err := send(p, "AT", 2*time.Second)
		switch {
		case err != nil:
			fmt.Fprintf(out, "%-18s %v\n", p, err)
		case st == statusOK:
			found++
			fmt.Fprintf(out, "%-18s ANSWERS (OK)\n", p)
		default:
			fmt.Fprintf(out, "%-18s no OK (%q)\n", p, clean(raw, "AT"))
		}
	}
	return found, skipped
}

func runProbe(out io.Writer, all bool) int {
	seen := map[string]bool{}
	var paths []string
	add := func(p string) {
		if !seen[p] {
			seen[p] = true
			paths = append(paths, p)
		}
	}
	// Only likely AT ports are touched: writing to unrelated smd ports (diag, gps...) is not something to do blindly.
	g, _ := filepath.Glob("/dev/stty_*")
	sort.Strings(g)
	for _, p := range g {
		add(p)
	}
	for _, s := range []int{0, 1} {
		for _, p := range defaultDevices[s] {
			add(p)
		}
	}
	found, skipped := probeList(out, paths, findHolders("/proc", os.Getpid()), knownHeld(), all, sendOn)
	if skipped > 0 {
		fmt.Fprintf(out, "%d port(s) skipped because another process holds them (urild is the RIL). -probe -all tries them too, but can drop mobile data.\n", skipped)
	}
	if found == 0 {
		fmt.Fprintln(out, "no port answered. Run as root; check `ls /dev | grep -E 'stty|smd|ttyUSB'`.")
		return 1
	}
	fmt.Fprintf(out, "Pin the right ports in %s, e.g.\n0=/dev/stty_lte0\n1=/dev/stty_lte1\n", confPath)
	return 0
}

// ---------- AT exchange ----------

// stageErr says which step of the exchange failed, so "open", "write" and "read" are no longer one message.
type stageErr struct {
	stage string
	err   error
}

func (e *stageErr) Error() string { return e.stage + " failed: " + e.err.Error() }
func (e *stageErr) Unwrap() error { return e.err }

// wouldBlock: a non-blocking read with nothing to read. Unisoc sipc ports (/dev/stty_nr*) report this as ENODATA
// instead of EAGAIN; treating it as a fatal error made every port look dead on the F50 (probe, 16 Nov 2026).
func wouldBlock(err error) bool {
	return err == syscall.EAGAIN || err == syscall.EINTR || err == syscall.ENODATA
}

type status int

const (
	statusTimeout status = iota
	statusOK
	statusError
)

// finalLine reports whether a trimmed line ends an AT reply, and how.
func finalLine(t string) (bool, status) {
	switch {
	case t == "OK":
		return true, statusOK
	case t == ">": // prompt of AT+CMGS and friends: the caller sends the body next
		return true, statusOK
	case t == "ERROR", t == "NO CARRIER", t == "NO DIALTONE", t == "BUSY", t == "NO ANSWER", t == "ABORTED",
		strings.HasPrefix(t, "+CME ERROR"), strings.HasPrefix(t, "+CMS ERROR"):
		return true, statusError
	}
	return false, statusTimeout
}

// complete scans a reply received so far for a final result code.
func complete(resp string) (bool, status) {
	resp = strings.ReplaceAll(resp, "\r", "\n")
	for _, l := range strings.Split(resp, "\n") {
		if done, st := finalLine(strings.TrimSpace(l)); done {
			return true, st
		}
	}
	// the ">" prompt arrives without a line ending
	if strings.HasSuffix(strings.TrimRight(resp, " \r\n"), ">") && strings.HasSuffix(resp, "> ") {
		return true, statusOK
	}
	return false, statusTimeout
}

// clean drops the echoed command and blank lines and normalises line endings to \n.
func clean(resp, cmd string) string {
	resp = strings.ReplaceAll(resp, "\r\n", "\n")
	resp = strings.ReplaceAll(resp, "\r", "\n")
	var keep []string
	echoed := false
	for _, l := range strings.Split(resp, "\n") {
		t := strings.TrimSpace(l)
		if t == "" {
			continue
		}
		if !echoed && strings.EqualFold(t, cmd) {
			echoed = true
			continue
		}
		keep = append(keep, t)
	}
	return strings.Join(keep, "\n")
}

func setRaw(fd int) {
	var t syscall.Termios
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), uintptr(syscall.TCGETS), uintptr(unsafe.Pointer(&t))); e != 0 {
		return // not a tty (smd and some stty nodes): nothing to configure
	}
	t.Iflag &^= syscall.IGNBRK | syscall.BRKINT | syscall.PARMRK | syscall.ISTRIP | syscall.INLCR | syscall.IGNCR | syscall.ICRNL | syscall.IXON
	t.Oflag &^= syscall.OPOST
	t.Lflag &^= syscall.ECHO | syscall.ECHONL | syscall.ICANON | syscall.ISIG | syscall.IEXTEN
	t.Cflag &^= syscall.CSIZE | syscall.PARENB
	t.Cflag |= syscall.CS8 | syscall.CLOCAL | syscall.CREAD
	t.Cc[syscall.VMIN] = 0
	t.Cc[syscall.VTIME] = 0
	syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), uintptr(syscall.TCSETS), uintptr(unsafe.Pointer(&t)))
}

// sendOn writes cmd+CR to path and reads until a final result code or the timeout. It holds an exclusive flock so two
// sendat processes (live signal poller, a plugin, the IMEI keeper) do not interleave on the same port.
func sendOn(path, cmd string, timeout time.Duration) (string, status, error) {
	fd, err := syscall.Open(path, syscall.O_RDWR|syscall.O_NOCTTY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "", statusTimeout, &stageErr{"open", err}
	}
	defer syscall.Close(fd)
	setRaw(fd)

	deadline := time.Now().Add(timeout)
	for {
		err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			break
		}
		if err != syscall.EWOULDBLOCK && err != syscall.EAGAIN {
			break // flock unsupported on this node: carry on unlocked
		}
		if time.Now().After(deadline) {
			return "", statusTimeout, fmt.Errorf("port %s is busy", path)
		}
		time.Sleep(50 * time.Millisecond)
	}
	defer syscall.Flock(fd, syscall.LOCK_UN)

	buf := make([]byte, 4096)
	for { // drop stale bytes (unsolicited codes) so they are not mistaken for this reply
		n, err := syscall.Read(fd, buf)
		if n <= 0 || err != nil {
			break
		}
	}

	line := []byte(cmd + "\r")
	for off := 0; off < len(line); {
		n, err := syscall.Write(fd, line[off:])
		if err == syscall.EAGAIN || err == syscall.EINTR {
			if time.Now().After(deadline) {
				return "", statusTimeout, &stageErr{"write", fmt.Errorf("%s timed out", path)}
			}
			time.Sleep(10 * time.Millisecond)
			continue
		}
		if err != nil {
			return "", statusTimeout, &stageErr{"write", err}
		}
		off += n
	}

	var resp strings.Builder
	for time.Now().Before(deadline) {
		n, err := syscall.Read(fd, buf)
		if n > 0 {
			resp.Write(buf[:n])
			if done, st := complete(resp.String()); done {
				return resp.String(), st, nil
			}
			continue
		}
		if err != nil && !wouldBlock(err) {
			return resp.String(), statusTimeout, &stageErr{"read", err}
		}
		time.Sleep(15 * time.Millisecond)
	}
	return resp.String(), statusTimeout, nil
}
