package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestComplete(t *testing.T) {
	cases := []struct {
		in   string
		done bool
		st   status
	}{
		{"AT+CGSN\r\r\n860000000000000\r\n\r\nOK\r\n", true, statusOK},
		{"\r\n+CME ERROR: 10\r\n", true, statusError},
		{"\r\nERROR\r\n", true, statusError},
		{"\r\n+CESQ: 99,99,255,255,20,50\r\n", false, statusTimeout},
		{"\r\n> ", true, statusOK},
	}
	for _, c := range cases {
		d, s := complete(c.in)
		if d != c.done || (d && s != c.st) {
			t.Errorf("complete(%q) = %v,%v want %v,%v", c.in, d, s, c.done, c.st)
		}
	}
}

func TestClean(t *testing.T) {
	got := clean("AT+CESQ\r\r\n+CESQ: 99,99\r\n\r\nOK\r\n", "AT+CESQ")
	if got != "+CESQ: 99,99\nOK" {
		t.Errorf("got %q", got)
	}
}

func TestWouldBlockAndStage(t *testing.T) {
	for _, e := range []error{syscall.EAGAIN, syscall.EINTR, syscall.ENODATA} {
		if !wouldBlock(e) {
			t.Errorf("%v must count as \"nothing to read yet\"", e)
		}
	}
	if wouldBlock(syscall.EIO) || wouldBlock(syscall.EACCES) {
		t.Error("real errors must not be swallowed")
	}
	se := &stageErr{"read", syscall.EIO}
	if !strings.HasPrefix(se.Error(), "read failed:") || !errors.Is(se, syscall.EIO) {
		t.Errorf("stage error text/unwrap wrong: %v", se)
	}
}

func TestKnownHeld(t *testing.T) {
	k := knownHeld()
	for _, p := range []string{"/dev/stty_nr0", "/dev/stty_nr1", "/dev/stty_nr5", "/dev/stty_nr28", "/dev/stty_nr31"} {
		if k[p] == "" {
			t.Errorf("%s must be listed as held", p)
		}
	}
	for _, p := range []string{"/dev/stty_nr6", "/dev/stty_nr7", "/dev/stty_nr27"} {
		if k[p] != "" {
			t.Errorf("%s is not held by another process on the F50", p)
		}
	}
}

func TestFindHolders(t *testing.T) {
	proc := t.TempDir()
	mk := func(pid, comm string, targets ...string) {
		if err := os.MkdirAll(filepath.Join(proc, pid, "fd"), 0o755); err != nil {
			t.Fatal(err)
		}
		os.WriteFile(filepath.Join(proc, pid, "comm"), []byte(comm+"\n"), 0o644)
		for i, tg := range targets {
			if err := os.Symlink(tg, filepath.Join(proc, pid, "fd", string(rune('3'+i)))); err != nil {
				t.Skipf("no symlinks here: %v", err)
			}
		}
	}
	mk("100", "urild", "/dev/stty_nr0", "/tmp/not-a-device")
	mk("200", "sendat", "/dev/stty_nr9") // another sendat does not count
	mk("300", "me", "/dev/stty_nr12")    // self is skipped
	mk("400", "", "/dev/stty_nr13")      // no name: still reported
	os.MkdirAll(filepath.Join(proc, "self"), 0o755) // not a pid
	h := findHolders(proc, 300)
	if h["/dev/stty_nr0"] != "urild (pid 100)" {
		t.Errorf("stty_nr0: %q", h["/dev/stty_nr0"])
	}
	if _, ok := h["/tmp/not-a-device"]; ok {
		t.Error("only /dev paths are reported")
	}
	if _, ok := h["/dev/stty_nr9"]; ok {
		t.Error("another sendat must not block a port")
	}
	if _, ok := h["/dev/stty_nr12"]; ok {
		t.Error("our own pid must be skipped")
	}
	if h["/dev/stty_nr13"] != "? (pid 400)" {
		t.Errorf("stty_nr13: %q", h["/dev/stty_nr13"])
	}
	if len(findHolders(filepath.Join(proc, "missing"), 1)) != 0 {
		t.Error("an unreadable proc dir gives an empty map, not a crash")
	}
}

func TestProbeListSkipsHeldPorts(t *testing.T) {
	dir := t.TempDir()
	mkPort := func(n string) string {
		p := filepath.Join(dir, n)
		os.WriteFile(p, nil, 0o644)
		return p
	}
	held, known, free, bad := mkPort("held"), mkPort("known"), mkPort("free"), mkPort("bad")
	missing := filepath.Join(dir, "missing")
	paths := []string{held, known, free, bad, missing}
	holders := map[string]string{held: "urild (pid 7)"}
	knownMap := map[string]string{known: "engpc"}
	var sent []string
	send := func(p, cmd string, d time.Duration) (string, status, error) {
		sent = append(sent, filepath.Base(p))
		if p == bad {
			return "", statusTimeout, &stageErr{"write", syscall.EIO}
		}
		return "AT\r\r\nOK\r\n", statusOK, nil
	}
	var out bytes.Buffer
	found, skipped := probeList(&out, paths, holders, knownMap, false, send)
	if found != 1 || skipped != 2 {
		t.Errorf("found=%d skipped=%d want 1 and 2\n%s", found, skipped, out.String())
	}
	if strings.Join(sent, ",") != "free,bad" {
		t.Errorf("AT was sent to %v; held and known ports must not be touched, a missing one is not tried", sent)
	}
	o := out.String()
	for _, want := range []string{"skipped, held by urild (pid 7)", "skipped, normally held by engpc", "ANSWERS (OK)", "write failed:"} {
		if !strings.Contains(o, want) {
			t.Errorf("output lacks %q:\n%s", want, o)
		}
	}
	// -all tries every existing port
	sent = nil
	out.Reset()
	found, skipped = probeList(&out, paths, holders, knownMap, true, send)
	if skipped != 0 || found != 3 || strings.Join(sent, ",") != "held,known,free,bad" {
		t.Errorf("-all: found=%d skipped=%d sent=%v", found, skipped, sent)
	}
}

func TestDefaultSlot0StartsWithFreePort(t *testing.T) {
	d := defaultDevices[0]
	if len(d) == 0 || d[0] != "/dev/stty_nr6" {
		t.Fatalf("slot 0 must start with /dev/stty_nr6, got %v", d)
	}
	if h := knownHeld()[d[0]]; h != "" {
		t.Errorf("the first slot 0 guess must not be a port held by %s", h)
	}
	seen := map[string]bool{}
	for _, p := range d {
		if seen[p] {
			t.Errorf("%s is listed twice", p)
		}
		seen[p] = true
	}
}
