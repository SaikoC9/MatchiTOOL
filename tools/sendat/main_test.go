package main

import (
	"errors"
	"strings"
	"syscall"
	"testing"
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
