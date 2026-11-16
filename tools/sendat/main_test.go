package main

import "testing"

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
