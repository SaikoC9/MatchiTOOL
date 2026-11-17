package main

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// call runs zreq in-process and returns exit code, stdout and stderr.
func call(args ...string) (int, string, string) {
	var out, errw bytes.Buffer
	code := run(args, &out, &errw)
	return code, out.String(), errw.String()
}

// addr is the host:port of a test server, as -ip wants it.
func addr(s *httptest.Server) string { return strings.TrimPrefix(s.URL, "http://") }

type seen struct {
	mu    sync.Mutex
	hits  int
	query string
	ref   string
	org   string
}

func TestBaseURL(t *testing.T) {
	good := []string{"192.168.0.1", "10.0.0.1", "172.16.5.4", "127.0.0.1:8080", "169.254.1.1"}
	bad := []string{"8.8.8.8", "example.com", "::1", "192.168.0.1:0", "192.168.0.1:99999", "", "192.168.0.1:x"}
	for _, a := range good {
		if _, e := baseURL(a); e != nil {
			t.Errorf("baseURL(%q) refused: %s", a, e.msg)
		}
	}
	for _, a := range bad {
		if _, e := baseURL(a); e == nil || e.code != exitUsage {
			t.Errorf("baseURL(%q) should be a usage error", a)
		}
	}
}

func TestSafePath(t *testing.T) {
	for _, p := range []string{"/goform/goform_get_cmd_process", "/a/b.c-d_e"} {
		if _, ok := safePath(p); !ok {
			t.Errorf("safePath(%q) refused", p)
		}
	}
	for _, p := range []string{"", "goform", "//evil.com/x", "/a/../b", "http://x/", "/a b", "/a?x=1"} {
		if _, ok := safePath(p); ok {
			t.Errorf("safePath(%q) accepted", p)
		}
	}
}

func TestGetQuery(t *testing.T) {
	cases := map[string]string{
		"cmd=LD&multi_data=1":               "isTest=false&cmd=LD&multi_data=1",
		"?cmd=LD":                           "isTest=false&cmd=LD",
		"":                                  "isTest=false",
		"isTest=true&cmd=LD":                "isTest=true&cmd=LD",
		"cmd=wan_ipaddr%2Cmodem_main_state": "isTest=false&cmd=wan_ipaddr%2Cmodem_main_state",
	}
	for in, want := range cases {
		got, err := getQuery(in)
		if err != nil || got != want {
			t.Errorf("getQuery(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	if _, err := getQuery("a=%zz"); err == nil {
		t.Error("getQuery accepted a bad escape")
	}
}

func TestEncodePwd(t *testing.T) {
	if got, _ := encodePwd("b64", "admin"); got != "YWRtaW4=" {
		t.Errorf("b64 = %q", got)
	}
	if got, _ := encodePwd("raw", "x y"); got != "x y" {
		t.Errorf("raw = %q", got)
	}
	if _, err := encodePwd("md5", "x"); err == nil {
		t.Error("unknown enc accepted")
	}
}

func TestResolvePwd(t *testing.T) {
	env := func(k string) string {
		if k == "ZREQ_PWD" {
			return "fromenv"
		}
		return ""
	}
	if p, _ := resolvePwd("a", "", env); p != "a" {
		t.Errorf("flag first: %q", p)
	}
	f := filepath.Join(t.TempDir(), "pw")
	if err := os.WriteFile(f, []byte("fromfile\r\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if p, _ := resolvePwd("", f, env); p != "fromfile" {
		t.Errorf("file second: %q", p)
	}
	if p, _ := resolvePwd("", "", env); p != "fromenv" {
		t.Errorf("env last: %q", p)
	}
	if _, err := resolvePwd("", filepath.Join(t.TempDir(), "missing"), env); err == nil {
		t.Error("missing file not reported")
	}
}

func TestGetSendsIsTestAndHeaders(t *testing.T) {
	var s seen
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.hits++
		s.query = r.URL.RawQuery
		s.ref = r.Header.Get("Referer")
		s.org = r.Header.Get("Origin")
		if r.Method != http.MethodGet || r.URL.Path != getPath {
			http.Error(w, "wrong route", 400)
			return
		}
		w.Write([]byte(`{"LD":"abc"}`))
	}))
	defer srv.Close()
	code, out, _ := call("-ip", addr(srv), "-params", "cmd=LD&multi_data=1")
	if code != exitOK || out != `{"LD":"abc"}` {
		t.Fatalf("code=%d out=%q", code, out)
	}
	if s.query != "isTest=false&cmd=LD&multi_data=1" {
		t.Errorf("query = %q", s.query)
	}
	if s.ref != srv.URL+"/index.html" || s.org != srv.URL {
		t.Errorf("referer=%q origin=%q", s.ref, s.org)
	}
}

func TestPostLoginThenSet(t *testing.T) {
	logins := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != setPath {
			http.Error(w, "wrong route", 400)
			return
		}
		r.ParseForm()
		switch r.PostForm.Get("goformId") {
		case "LOGIN":
			logins++
			if r.PostForm.Get("password") != base64.StdEncoding.EncodeToString([]byte("s3cr+t/x=")) {
				w.Write([]byte(`{"result":"1"}`))
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "zsid", Value: "tok123"})
			w.Write([]byte(`{"result":"0"}`))
		case "SET_X":
			if c, err := r.Cookie("zsid"); err != nil || c.Value != "tok123" {
				w.WriteHeader(401)
				return
			}
			w.Write([]byte(`{"result":"success"}`))
		default:
			http.Error(w, "unknown", 400)
		}
	}))
	defer srv.Close()
	code, out, errs := call("-ip", addr(srv), "-pwd", "s3cr+t/x=", "-body", "goformId=SET_X&isTest=false", "-v")
	if code != exitOK || out != `{"result":"success"}` {
		t.Fatalf("code=%d out=%q err=%q", code, out, errs)
	}
	for _, secret := range []string{"s3cr", "tok123", "SET_X"} {
		if strings.Contains(errs, secret) {
			t.Errorf("-v leaked %q: %s", secret, errs)
		}
	}
	if logins != 1 {
		t.Errorf("logins = %d", logins)
	}
}

func TestWrongPasswordIsTriedOnce(t *testing.T) {
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			hits++
		}
		w.Write([]byte(`{"result":"1"}`))
	}))
	defer srv.Close()
	code, out, errs := call("-ip", addr(srv), "-pwd", "bad", "-body", "goformId=SET_X")
	if code != exitLogin || out != "" || hits != 1 {
		t.Fatalf("code=%d out=%q hits=%d err=%q", code, out, hits, errs)
	}
}

func TestPublicAddressNeverContacted(t *testing.T) {
	code, _, errs := call("-ip", "8.8.8.8", "-params", "cmd=LD")
	if code != exitUsage || !strings.Contains(errs, "private") {
		t.Fatalf("code=%d err=%q", code, errs)
	}
}

func TestUsageErrors(t *testing.T) {
	cases := [][]string{
		{"-method", "PUT"},
		{"-method", "POST"},
		{"-method", "GET", "-body", "a=b"},
		{"-path", "//evil.com/x"},
		{"-t", "0"},
		{"extra"},
		{"-enc", "md5", "-pwd", "x"},
	}
	for _, c := range cases {
		code, _, _ := call(append([]string{"-ip", "127.0.0.1:1"}, c...)...)
		if code != exitUsage {
			t.Errorf("%v: code %d, want %d", c, code, exitUsage)
		}
	}
}

func TestJSONFlag(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("cmd") == "html" {
			w.Write([]byte("<html>"))
			return
		}
		w.Write([]byte(`{"a":[1,2]}`))
	}))
	defer srv.Close()
	code, out, _ := call("-ip", addr(srv), "-params", "cmd=x", "-json")
	if code != exitOK || out != "{\n  \"a\": [\n    1,\n    2\n  ]\n}\n" {
		t.Errorf("code=%d out=%q", code, out)
	}
	code, out, _ = call("-ip", addr(srv), "-params", "cmd=html", "-json")
	if code != exitNotJSON || out != "<html>" {
		t.Errorf("code=%d out=%q", code, out)
	}
}

func TestNon2xxAndRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("cmd") == "r" {
			http.Redirect(w, r, "http://example.com/", http.StatusFound)
			return
		}
		w.WriteHeader(500)
		w.Write([]byte("boom"))
	}))
	defer srv.Close()
	code, out, _ := call("-ip", addr(srv), "-params", "cmd=e")
	if code != exitHTTP || out != "boom" {
		t.Errorf("500: code=%d out=%q", code, out)
	}
	code, _, _ = call("-ip", addr(srv), "-params", "cmd=r")
	if code != exitHTTP { // a redirect is reported, never followed
		t.Errorf("302: code=%d", code)
	}
}

func TestNetworkErrorHidesQuery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	a := addr(srv)
	srv.Close() // nothing listens any more
	code, _, errs := call("-ip", a, "-params", "cmd=LD&token=SECRETVALUE", "-t", "2")
	if code != exitNet || strings.Contains(errs, "SECRETVALUE") {
		t.Errorf("code=%d err=%q", code, errs)
	}
}

func TestHelpAndVersion(t *testing.T) {
	if code, _, errs := call("-h"); code != exitOK || !strings.Contains(errs, "Usage: zreq") {
		t.Errorf("-h: code=%d err=%q", code, errs)
	}
	if code, out, _ := call("-version"); code != exitOK || !strings.HasPrefix(out, "zreq ") {
		t.Errorf("-version: code=%d out=%q", code, out)
	}
}

func TestLdSecret(t *testing.T) {
	// SHA256("abc") = BA7816BF...; the login value is SHA256(upper(SHA256(pw)) + LD), upper-case hex.
	if got := sha256Upper("abc"); got != "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD" {
		t.Errorf("sha256Upper = %s", got)
	}
	want := sha256Upper(sha256Upper("pw") + "LD1")
	if got := ldSecret("pw", "LD1"); got != want || got != strings.ToUpper(got) {
		t.Errorf("ldSecret = %s", got)
	}
}

// ldServer answers cmd=LD with ld (or no LD field when ld is "-") and accepts LOGIN only with the matching secret.
func ldServer(ld, wantSecret string, logins *int, getsAfterLogin *int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Method == http.MethodGet && r.URL.Query().Get("cmd") == "LD" {
			if ld == "-" {
				w.Write([]byte(`{"x":"y"}`))
			} else {
				w.Write([]byte(`{"LD":"` + ld + `"}`))
			}
			return
		}
		if r.Method == http.MethodPost && r.PostForm.Get("goformId") == "LOGIN" {
			*logins++
			if r.PostForm.Get("password") != wantSecret {
				w.Write([]byte(`{"result":"1"}`))
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "zsid", Value: "tok"})
			w.Write([]byte(`{"result":"0"}`))
			return
		}
		if c, err := r.Cookie("zsid"); err != nil || c.Value != "tok" {
			w.WriteHeader(401)
			return
		}
		*getsAfterLogin++
		w.Write([]byte(`{"ok":"1"}`))
	}))
}

func TestAutoSignInUsesLdChallenge(t *testing.T) {
	logins, gets := 0, 0
	srv := ldServer("A1B2C3", ldSecret("hunter2", "A1B2C3"), &logins, &gets)
	defer srv.Close()
	code, out, errs := call("-ip", addr(srv), "-pwd", "hunter2", "-params", "cmd=wan_ipaddr")
	if code != exitOK || out != `{"ok":"1"}` || logins != 1 || gets != 1 {
		t.Fatalf("code=%d out=%q logins=%d gets=%d err=%q", code, out, logins, gets, errs)
	}
}

func TestAutoFallsBackToBase64WithoutLd(t *testing.T) {
	logins, gets := 0, 0
	srv := ldServer("-", base64.StdEncoding.EncodeToString([]byte("old")), &logins, &gets)
	defer srv.Close()
	if code, _, errs := call("-ip", addr(srv), "-pwd", "old", "-params", "cmd=x"); code != exitOK || logins != 1 {
		t.Fatalf("code=%d logins=%d err=%q", code, logins, errs)
	}
}

func TestLdModeRefusesWhenNoChallenge(t *testing.T) {
	logins, gets := 0, 0
	srv := ldServer("-", "", &logins, &gets)
	defer srv.Close()
	if code, _, _ := call("-ip", addr(srv), "-pwd", "x", "-enc", "ld", "-params", "cmd=x"); code != exitLogin || logins != 0 {
		t.Fatalf("code=%d logins=%d (no login may be posted)", code, logins)
	}
}

func TestChallengeServerErrorPostsNoLogin(t *testing.T) {
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts++
		}
		w.WriteHeader(503)
	}))
	defer srv.Close()
	if code, _, _ := call("-ip", addr(srv), "-pwd", "x", "-params", "cmd=x"); code != exitNet || posts != 0 {
		t.Fatalf("code=%d posts=%d: a busy router must not get a base64 password", code, posts)
	}
}

func TestBadEncIsUsageError(t *testing.T) {
	if code, _, _ := call("-ip", "127.0.0.1:1", "-pwd", "x", "-enc", "md5", "-params", "cmd=x"); code != exitUsage {
		t.Fatalf("code=%d", code)
	}
}
