package main

import (
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

// openPty returns a master fd and the slave path of a new pseudo-terminal.
func openPty(t *testing.T) (int, string) {
	t.Helper()
	m, err := syscall.Open("/dev/ptmx", syscall.O_RDWR|syscall.O_NOCTTY, 0)
	if err != nil {
		t.Skipf("no /dev/ptmx: %v", err)
	}
	var unlock int32
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(m), syscall.TIOCSPTLCK, uintptr(unsafe.Pointer(&unlock))); e != 0 {
		t.Skipf("TIOCSPTLCK: %v", e)
	}
	var n uint32
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(m), syscall.TIOCGPTN, uintptr(unsafe.Pointer(&n))); e != 0 {
		t.Skipf("TIOCGPTN: %v", e)
	}
	return m, "/dev/pts/" + itoa(int(n))
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for ; n > 0; n /= 10 {
		s = string(rune('0'+n%10)) + s
	}
	return s
}

// fakeModem answers every line it receives with the canned reply (echo on, like ATE1).
func fakeModem(m int, reply string, stop chan struct{}) {
	buf := make([]byte, 256)
	var got []byte
	for {
		select {
		case <-stop:
			return
		default:
		}
		n, _ := syscall.Read(m, buf)
		if n > 0 {
			got = append(got, buf[:n]...)
			if strings.Contains(string(got), "\r") {
				cmd := strings.TrimSpace(string(got))
				got = nil
				syscall.Write(m, []byte(cmd+"\r\r\n"+reply))
			}
			continue
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestSendOnPty(t *testing.T) {
	cases := []struct {
		name, reply string
		want        status
		contains    string
	}{
		{"ok", "\r\n860000000000000\r\n\r\nOK\r\n", statusOK, "860000000000000\nOK"},
		{"cme", "\r\n+CME ERROR: 10\r\n", statusError, "+CME ERROR: 10"},
		{"split", "\r\n+CESQ: 99,99,255,255,20,50\r\n\r\nOK\r\n", statusOK, "+CESQ: 99,99,255,255,20,50\nOK"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m, slave := openPty(t)
			defer syscall.Close(m)
			stop := make(chan struct{})
			defer close(stop)
			go fakeModem(m, c.reply, stop)
			raw, st, err := sendOn(slave, "AT+X", 3*time.Second)
			if err != nil || st != c.want {
				t.Fatalf("st=%v err=%v raw=%q", st, err, raw)
			}
			if got := clean(raw, "AT+X"); got != c.contains {
				t.Errorf("clean = %q want %q", got, c.contains)
			}
		})
	}
}

func TestSendOnTimeout(t *testing.T) {
	m, slave := openPty(t)
	defer syscall.Close(m)
	start := time.Now()
	_, st, err := sendOn(slave, "AT", 500*time.Millisecond) // nobody answers
	if err != nil || st != statusTimeout {
		t.Fatalf("st=%v err=%v", st, err)
	}
	if time.Since(start) > 2*time.Second {
		t.Errorf("took %v", time.Since(start))
	}
}
