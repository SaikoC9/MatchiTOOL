// zreq: a small HTTP client for the router's goform API (ZTE style), written for MatchiTOOL.
//
//	zreq [-ip 192.168.0.1] -params 'cmd=LD&multi_data=1'                  GET  /goform/goform_get_cmd_process
//	zreq [-ip 192.168.0.1] -body 'goformId=X&isTest=false'                POST /goform/goform_set_cmd_process
//
// Add -pwd / -pwd-file / env ZREQ_PWD to sign in first (goformId=LOGIN), then send the request with the session cookie.
// The password goes as SHA256(SHA256(pw)+LD) when the router gives an LD challenge (the F50), else as base64 (-enc auto).
//
// This is NOT a copy of the UFI-TOOLS binary and does not promise byte-identical output. It keeps the flag names
// (-ip -method -params -body -pwd -json) and the usual calls. Differences, on purpose:
//   - there is no built-in default password: without a password it sends the request unauthenticated;
//   - only a private, loopback or link-local IPv4 address is accepted as the router, so a plugin cannot aim it elsewhere;
//   - the password can come from a file or ZREQ_PWD, so it need not appear in the process list;
//   - a wrong password is tried once and never retried (routers lock the login after a few failures);
//   - -v prints only method, path and status: never a query, body, password or cookie.
//
// Source is in this repository, stdlib only, built by .github/workflows/build-zreq.yml.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	exitOK      = 0 // request done, HTTP 2xx (and valid JSON when -json was given)
	exitUsage   = 1 // bad flags or arguments
	exitNet     = 2 // could not reach the router or read the reply
	exitLogin   = 3 // the router refused the sign-in
	exitHTTP    = 4 // the router answered with a status other than 2xx
	exitNotJSON = 5 // -json was given and the reply is not JSON

	getPath = "/goform/goform_get_cmd_process"
	setPath = "/goform/goform_set_cmd_process"
	maxBody = 4 << 20
	version = "zreq 1.1 (MatchiTOOL)"
)

type exitErr struct {
	code int
	msg  string
}

type options struct {
	ip, method, params, body string
	pwd, pwdFile, enc        string
	cookie, path             string
	asJSON, verbose          bool
	timeout                  time.Duration
}

type reply struct {
	status int
	header http.Header
	body   []byte
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, stdout, stderr io.Writer) int {
	e := execute(args, stdout, stderr)
	if e == nil {
		return exitOK
	}
	if e.msg != "" {
		fmt.Fprintln(stderr, "zreq:", e.msg)
	}
	return e.code
}

func execute(args []string, stdout, stderr io.Writer) *exitErr {
	fs := flag.NewFlagSet("zreq", flag.ContinueOnError)
	fs.SetOutput(stderr)
	var o options
	fs.StringVar(&o.ip, "ip", "192.168.0.1", "router address: IPv4, optionally with :port (private/loopback only); without a port it tries 8080, then 80")
	fs.StringVar(&o.method, "method", "", "GET or POST (default: POST when -body is given, otherwise GET)")
	fs.StringVar(&o.params, "params", "", "GET query, e.g. cmd=LD&multi_data=1 (isTest=false is added when missing)")
	fs.StringVar(&o.body, "body", "", "POST body, e.g. goformId=SET_X&isTest=false")
	fs.StringVar(&o.pwd, "pwd", "", "router password (visible in the process list; prefer -pwd-file or env ZREQ_PWD)")
	fs.StringVar(&o.pwdFile, "pwd-file", "", "read the router password from this file (trailing newline removed)")
	fs.StringVar(&o.enc, "enc", "auto", "how the password is sent: auto (ask the router for its LD challenge: SHA256(SHA256(pw)+LD) when it gives one, else base64), ld (challenge only), b64 (base64 of the password) or raw (exactly as given)")
	fs.StringVar(&o.cookie, "cookie", "", "session cookie to send, e.g. zsid=abc (or env ZREQ_COOKIE); replaced by the cookie from -pwd sign-in")
	fs.StringVar(&o.path, "path", "", "override the endpoint path (default: the get or set goform path)")
	fs.BoolVar(&o.asJSON, "json", false, "print the reply as indented JSON (exit 5 if it is not JSON)")
	fs.BoolVar(&o.verbose, "v", false, "print method, path and status to stderr (never query, body, password or cookie)")
	secs := fs.Int("t", 10, "timeout in seconds for each request")
	showVersion := fs.Bool("version", false, "print the version and exit")
	fs.Usage = func() {
		fmt.Fprintln(stderr, "Usage: zreq [flags]\n\nSends one request to the router's goform API and prints the reply.\n\nFlags:")
		fs.PrintDefaults()
		fmt.Fprintln(stderr, "\nExit codes: 0 ok, 1 usage, 2 network, 3 sign-in refused, 4 HTTP status not 2xx, 5 reply not JSON (-json).")
	}
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return &exitErr{code: exitOK}
		}
		return &exitErr{code: exitUsage}
	}
	if *showVersion {
		fmt.Fprintln(stdout, version)
		return nil
	}
	if fs.NArg() > 0 {
		return &exitErr{code: exitUsage, msg: "unexpected argument: " + fs.Arg(0)}
	}
	if *secs < 1 || *secs > 120 {
		return &exitErr{code: exitUsage, msg: "-t must be 1 to 120 seconds"}
	}
	o.timeout = time.Duration(*secs) * time.Second

	base, bad := baseURL(o.ip)
	if bad != nil {
		return bad
	}
	if _, _, err := net.SplitHostPort(o.ip); err != nil {
		base = pickPort(o.ip, defaultPorts, 3*time.Second) // no port given: use the one the router answers on (the F50: 8080)
	}
	method := strings.ToUpper(strings.TrimSpace(o.method))
	if method == "" {
		if o.body != "" {
			method = http.MethodPost
		} else {
			method = http.MethodGet
		}
	}
	if method != http.MethodGet && method != http.MethodPost {
		return &exitErr{code: exitUsage, msg: "-method must be GET or POST"}
	}
	if method == http.MethodGet && o.body != "" {
		return &exitErr{code: exitUsage, msg: "-body needs -method POST (use -params for GET)"}
	}
	if method == http.MethodPost && o.body == "" {
		return &exitErr{code: exitUsage, msg: "POST needs -body"}
	}
	path := getPath
	if method == http.MethodPost {
		path = setPath
	}
	if o.path != "" {
		p, ok := safePath(o.path)
		if !ok {
			return &exitErr{code: exitUsage, msg: "-path is not a plain path on the router"}
		}
		path = p
	}
	query := ""
	if method == http.MethodGet {
		q, err := getQuery(o.params)
		if err != nil {
			return &exitErr{code: exitUsage, msg: err.Error()}
		}
		query = q
	}
	pwd, err := resolvePwd(o.pwd, o.pwdFile, os.Getenv)
	if err != nil {
		return &exitErr{code: exitUsage, msg: "cannot read password file: " + cleanErr(err).Error()}
	}
	switch o.enc {
	case "auto", "ld", "b64", "raw":
	default:
		return &exitErr{code: exitUsage, msg: "-enc must be auto, ld, b64 or raw"}
	}
	cookie := o.cookie
	if cookie == "" {
		cookie = os.Getenv("ZREQ_COOKIE")
	}
	if strings.ContainsAny(cookie, "\r\n") {
		return &exitErr{code: exitUsage, msg: "cookie must not contain line breaks"}
	}

	logf := func(format string, a ...any) {
		if o.verbose {
			fmt.Fprintf(stderr, format+"\n", a...)
		}
	}
	client := newClient(o.timeout)

	if pwd != "" {
		c, e := login(client, base, pwd, o.enc)
		if e != nil {
			return e
		}
		logf("sign-in ok")
		if c != "" {
			cookie = c
		}
	}

	logf("> %s %s", method, path)
	rp, err := doRequest(client, method, base, path, query, o.body, cookie)
	if err != nil {
		return &exitErr{code: exitNet, msg: "request failed: " + cleanErr(err).Error()}
	}
	logf("< %d", rp.status)

	notJSON := false
	if o.asJSON {
		var buf bytes.Buffer
		if json.Indent(&buf, bytes.TrimSpace(rp.body), "", "  ") != nil {
			notJSON = true
			stdout.Write(rp.body)
		} else {
			buf.WriteByte('\n')
			stdout.Write(buf.Bytes())
		}
	} else {
		stdout.Write(rp.body)
	}
	if rp.status < 200 || rp.status > 299 {
		return &exitErr{code: exitHTTP, msg: fmt.Sprintf("HTTP %d", rp.status)}
	}
	if notJSON {
		return &exitErr{code: exitNotJSON, msg: "reply is not JSON"}
	}
	return nil
}

// baseURL checks the router address and returns "http://<address>". Only IPv4 addresses that are private,
// loopback or link-local are accepted, with an optional :port.
func baseURL(addr string) (string, *exitErr) {
	host := addr
	if h, p, err := net.SplitHostPort(addr); err == nil {
		n, perr := strconv.Atoi(p)
		if perr != nil || n < 1 || n > 65535 {
			return "", &exitErr{code: exitUsage, msg: "invalid port in -ip"}
		}
		host = h
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.To4() == nil {
		return "", &exitErr{code: exitUsage, msg: "-ip must be an IPv4 address such as 192.168.0.1"}
	}
	if !(ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()) {
		return "", &exitErr{code: exitUsage, msg: "-ip must be a private, loopback or link-local address"}
	}
	return "http://" + addr, nil
}

// defaultPorts are tried in this order when -ip has no port. The F50 web server is on 8080 and refuses 80.
var defaultPorts = []string{"8080", "80"}

// pickPort returns the base URL for ip on the first port that answers HTTP (any status). When none answers it returns the
// plain address (port 80), so the request then fails with the usual network error.
func pickPort(ip string, ports []string, timeout time.Duration) string {
	c := newClient(timeout)
	for _, p := range ports {
		b := "http://" + ip + ":" + p
		if _, err := doRequest(c, http.MethodGet, b, getPath, "isTest=false&cmd=LD", "", ""); err == nil {
			return b
		}
	}
	return "http://" + ip
}

var pathRx = regexp.MustCompile(`^/[A-Za-z0-9._/-]{1,200}$`)

// safePath accepts a plain path: one leading slash, safe characters, no "..", no "//".
func safePath(p string) (string, bool) {
	if !pathRx.MatchString(p) || strings.Contains(p, "..") || strings.Contains(p, "//") {
		return "", false
	}
	return p, true
}

// getQuery returns the GET query. The router's get endpoint expects isTest=false, so it is put in front when the
// caller did not name isTest. The rest is sent exactly as given.
func getQuery(params string) (string, error) {
	params = strings.TrimPrefix(strings.TrimSpace(params), "?")
	vals, err := url.ParseQuery(params)
	if err != nil {
		return "", errors.New("-params is not a valid query string")
	}
	if _, ok := vals["isTest"]; ok {
		return params, nil
	}
	if params == "" {
		return "isTest=false", nil
	}
	return "isTest=false&" + params, nil
}

// sha256Upper is SHA-256 of s as upper-case hex (the form the router's login uses).
func sha256Upper(s string) string {
	h := sha256.Sum256([]byte(s))
	return strings.ToUpper(hex.EncodeToString(h[:]))
}

// ldSecret is the newer-firmware login value: SHA256(SHA256(password) + LD), upper-case hex both times.
func ldSecret(pwd, ld string) string { return sha256Upper(sha256Upper(pwd) + ld) }

// fetchLD asks the router for its login challenge (GET cmd=LD). It returns "" when the router answers without one (older
// firmware). A network error or an HTTP 5xx is an error, NOT "older firmware", so the weak base64 form is never posted
// because of a transient failure.
func fetchLD(c *http.Client, base string) (string, *exitErr) {
	rp, err := doRequest(c, http.MethodGet, base, getPath, "isTest=false&cmd=LD", "", "")
	if err != nil {
		return "", &exitErr{code: exitNet, msg: "sign-in challenge request failed: " + cleanErr(err).Error()}
	}
	if rp.status >= 500 {
		return "", &exitErr{code: exitNet, msg: fmt.Sprintf("router error HTTP %d on the sign-in challenge", rp.status)}
	}
	var m map[string]any
	if json.Unmarshal(rp.body, &m) != nil {
		return "", nil
	}
	if v, ok := m["LD"].(string); ok {
		return v, nil
	}
	return "", nil
}

// encodePwd turns the password into what the login form field carries (b64 and raw only; ld needs the router, see login).
func encodePwd(enc, pwd string) (string, error) {
	switch enc {
	case "b64":
		return base64.StdEncoding.EncodeToString([]byte(pwd)), nil
	case "raw":
		return pwd, nil
	}
	return "", errors.New("-enc must be auto, ld, b64 or raw")
}

// resolvePwd: -pwd, then -pwd-file, then env ZREQ_PWD. Empty means "do not sign in".
func resolvePwd(flagVal, file string, getenv func(string) string) (string, error) {
	if flagVal != "" {
		return flagVal, nil
	}
	if file != "" {
		b, err := os.ReadFile(file)
		if err != nil {
			return "", err
		}
		return strings.TrimRight(string(b), "\r\n"), nil
	}
	return getenv("ZREQ_PWD"), nil
}

func newClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:       timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport:     &http.Transport{Proxy: nil, DisableKeepAlives: true},
	}
}

// cleanErr drops the URL that net/http puts into its errors (a GET query can hold private values).
func cleanErr(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}

func doRequest(c *http.Client, method, base, path, query, body, cookie string) (*reply, error) {
	target := base + path
	if query != "" {
		target += "?" + query
	}
	var rd io.Reader
	if method == http.MethodPost {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, target, rd)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "zreq/1.0")
	req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Origin", base)
	req.Header.Set("Referer", base+"/index.html")
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBody {
		return nil, errors.New("reply is larger than 4 MiB")
	}
	return &reply{status: resp.StatusCode, header: resp.Header, body: data}, nil
}

// login signs in once (goformId=LOGIN) and returns the session cookie the router set ("" when it set none).
func login(c *http.Client, base, pwd, enc string) (string, *exitErr) {
	var encoded string
	switch enc {
	case "auto", "ld":
		ld, e := fetchLD(c, base)
		if e != nil {
			return "", e
		}
		switch {
		case ld != "":
			encoded = ldSecret(pwd, ld)
		case enc == "ld":
			return "", &exitErr{code: exitLogin, msg: "the router gave no LD challenge (use -enc b64 for older firmware)"}
		default:
			encoded = base64.StdEncoding.EncodeToString([]byte(pwd))
		}
	default:
		var err error
		if encoded, err = encodePwd(enc, pwd); err != nil {
			return "", &exitErr{code: exitUsage, msg: err.Error()}
		}
	}
	body := "goformId=LOGIN&isTest=false&password=" + url.QueryEscape(encoded)
	rp, err := doRequest(c, http.MethodPost, base, setPath, "", body, "")
	if err != nil {
		return "", &exitErr{code: exitNet, msg: "sign-in request failed: " + cleanErr(err).Error()}
	}
	if rp.status < 200 || rp.status > 299 {
		return "", &exitErr{code: exitLogin, msg: fmt.Sprintf("sign-in: HTTP %d", rp.status)}
	}
	var m map[string]any
	if json.Unmarshal(rp.body, &m) != nil {
		return "", &exitErr{code: exitLogin, msg: "sign-in: reply is not JSON"}
	}
	if res := fmt.Sprint(m["result"]); res != "0" {
		return "", &exitErr{code: exitLogin, msg: "sign-in refused (result=" + res + ")"}
	}
	return cookieHeader(rp.header), nil
}

// cookieHeader builds a Cookie header value from the Set-Cookie lines of a reply.
func cookieHeader(h http.Header) string {
	resp := http.Response{Header: h}
	var parts []string
	for _, ck := range resp.Cookies() {
		if ck.Value != "" {
			parts = append(parts, ck.Name+"="+ck.Value)
		}
	}
	return strings.Join(parts, "; ")
}
