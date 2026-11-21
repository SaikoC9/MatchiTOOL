package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Helpers that are disposable: a plugin script starts them for one short job. One that has run longer than helper-max and used a
// quarter of that time as CPU is stuck (the `tr` on /proc/PID/cmdline). `sleep` is not in the list: it uses no CPU.
var helpers = map[string]bool{"tr": true, "du": true, "grep": true, "cat": true, "awk": true, "cut": true, "find": true}

type cfg struct {
	root         string
	interval     time.Duration
	rounds       int
	report       string
	budgets      map[string]float64 // percent of ONE core (800 = all 8 cores)
	defBudget    float64
	helperMax    time.Duration
	throttleAt   int    // consecutive rounds over budget before throttling
	escalateAt   int    // consecutive rounds over budget before freeze/kill
	calmAt       int    // consecutive rounds under budget before release
	action       string // throttle | freeze | kill  (the strongest action allowed)
	freezeRounds int
	cg           cgHost
	cgOn         bool
}

type key struct {
	pid   int
	start uint64
}

type plugState struct {
	strikes, calm, frozenFor int
	state                    string
	touched                  map[key]bool
}

type action struct {
	TS     int64  `json:"ts"`
	What   string `json:"what"`
	Plugin string `json:"plugin,omitempty"`
	PID    int    `json:"pid,omitempty"`
	Comm   string `json:"comm,omitempty"`
	Why    string `json:"why"`
}

type pluginRow struct {
	Name    string  `json:"name"`
	CPU     float64 `json:"cpu_pct"`
	Budget  float64 `json:"budget_pct"`
	RSSKB   int64   `json:"rss_kb"`
	Procs   int     `json:"procs"`
	State   string  `json:"state"`
	Strikes int     `json:"strikes"`
}

// report is the JSON the host and the web panel read (v1).
type report struct {
	V        int         `json:"v"`
	TS       int64       `json:"ts"`
	Interval int         `json:"interval_s"`
	Round    int         `json:"round"`
	Cost     int64       `json:"scan_ms"`
	Procs    int         `json:"procs_seen"`
	Plugins  []pluginRow `json:"plugins"`
	Actions  []action    `json:"actions"`
}

type watcher struct {
	c       cfg
	prev    map[key]uint64
	tags    map[key]string
	plugins map[string]*plugState
	actions []action
	last    time.Time
	n       int
}

func newWatcher(c cfg) *watcher {
	return &watcher{c: c, prev: map[key]uint64{}, tags: map[key]string{}, plugins: map[string]*plugState{}}
}

func (w *watcher) act(what, plugin string, p *procInfo, why string) {
	a := action{TS: time.Now().Unix(), What: what, Plugin: plugin, Why: why}
	if p != nil {
		a.PID, a.Comm = p.PID, p.Comm
	}
	w.actions = append(w.actions, a)
	if len(w.actions) > 20 {
		w.actions = w.actions[len(w.actions)-20:]
	}
}

type usage struct {
	ticks uint64
	rss   int64
	procs []procInfo
}

func (w *watcher) budget(name string) float64 {
	if b, ok := w.c.budgets[name]; ok {
		return b
	}
	return w.c.defBudget
}

func (w *watcher) round(now time.Time) report {
	t0 := time.Now()
	procs := scanProcs(w.c.root)
	up := readUptime(w.c.root)
	w.n++
	baseline := w.last.IsZero()
	secs := now.Sub(w.last).Seconds()
	me := selfPID()

	cur := map[key]uint64{}
	tags := map[key]string{}
	byPID := map[int]*procInfo{}
	agg := map[string]*usage{}
	for i := range procs {
		p := &procs[i]
		byPID[p.PID] = p
		if p.PID <= 2 || p.PPID == 2 || p.PID == me {
			continue
		}
		k := key{p.PID, p.Start}
		tag, ok := w.tags[k]
		if !ok {
			tag = readTag(w.c.root, p.PID)
		}
		tags[k] = tag
		cur[k] = p.Ticks
		if tag == "" {
			continue
		}
		u := agg[tag]
		if u == nil {
			u = &usage{}
			agg[tag] = u
		}
		d := p.Ticks
		if pv, seen := w.prev[k]; seen && p.Ticks >= pv {
			d = p.Ticks - pv
		}
		u.ticks += d
		u.rss += p.RSSPages * int64(os.Getpagesize()) / 1024
		u.procs = append(u.procs, *p)
	}
	w.tags, w.prev = tags, cur

	// 1. stuck helpers that belong to a plugin (tagged, or a parent within 6 steps is tagged)
	for i := range procs {
		p := &procs[i]
		if !stuckHelper(*p, up, w.c.helperMax) || !w.owned(p, byPID, 6) {
			continue
		}
		name := w.ownerName(p, byPID)
		if killFn(w.c.root, p.PID, p.Start, 9) {
			w.act("kill-helper", name, p, fmt.Sprintf("%s ran %ds at %d%% CPU", p.Comm, int(up-float64(p.Start)/clkTck), int(100*float64(p.Ticks)/clkTck/(up-float64(p.Start)/clkTck))))
		}
	}

	// 2. per-plugin budget
	rows := []pluginRow{}
	names := make([]string, 0, len(agg))
	for n := range agg {
		names = append(names, n)
	}
	for n, ps := range w.plugins { // a plugin that went quiet is still handled (thaw, release)
		if _, ok := agg[n]; !ok && ps.state != "ok" {
			names = append(names, n)
		}
	}
	sort.Strings(names)
	for _, name := range names {
		u := agg[name]
		if u == nil {
			u = &usage{}
		}
		ps := w.plugins[name]
		if ps == nil {
			ps = &plugState{state: "ok", touched: map[key]bool{}}
			w.plugins[name] = ps
		}
		pct := 0.0
		if !baseline && secs > 0 {
			pct = float64(u.ticks) / (secs * clkTck) * 100
		}
		w.judge(name, ps, u, pct)
		rows = append(rows, pluginRow{name, round1(pct), w.budget(name), u.rss, len(u.procs), ps.state, ps.strikes})
	}
	w.last = now
	return report{V: 1, TS: now.Unix(), Interval: int(w.c.interval / time.Second), Round: w.n, Cost: time.Since(t0).Milliseconds(),
		Procs: len(procs), Plugins: rows, Actions: append([]action{}, w.actions...)}
}

func round1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }

func stuckHelper(p procInfo, up float64, max time.Duration) bool {
	if !helpers[p.Comm] || p.State == 'Z' {
		return false
	}
	age := up - float64(p.Start)/clkTck
	return age >= max.Seconds() && age > 0 && float64(p.Ticks)/clkTck >= 0.25*age
}

func (w *watcher) ownerName(p *procInfo, byPID map[int]*procInfo) string {
	for i := 0; i < 7 && p != nil; i++ {
		if t := w.tags[key{p.PID, p.Start}]; t != "" {
			return t
		}
		p = byPID[p.PPID]
	}
	return ""
}

func (w *watcher) owned(p *procInfo, byPID map[int]*procInfo, depth int) bool {
	_ = depth
	return w.ownerName(p, byPID) != ""
}

func (w *watcher) judge(name string, ps *plugState, u *usage, pct float64) {
	over := pct > w.budget(name)
	if over {
		ps.strikes++
		ps.calm = 0
	} else {
		ps.strikes = 0
		ps.calm++
	}
	switch ps.state {
	case "frozen":
		ps.frozenFor++
		if ps.frozenFor >= w.c.freezeRounds {
			if w.c.cgOn {
				w.c.cg.freeze(name, false)
			}
			ps.state, ps.strikes, ps.frozenFor = "throttled", 0, 0
			w.act("thaw", name, nil, "freeze time over")
		}
		return
	case "ok", "killed":
		ps.state = "ok"
		if ps.strikes >= w.c.throttleAt {
			ps.state = "throttled"
			w.throttle(name, ps, u, fmt.Sprintf("%d%% CPU, budget %d%% for %d rounds", int(pct), int(w.budget(name)), ps.strikes))
		}
	case "throttled":
		w.throttle(name, ps, u, "") // new processes of a throttled plugin get the same treatment
		if ps.calm >= w.c.calmAt {
			w.release(name, ps, u)
			return
		}
		if over && ps.strikes >= w.c.escalateAt {
			w.escalate(name, ps, u, pct)
		}
	}
}

func (w *watcher) throttle(name string, ps *plugState, u *usage, why string) {
	first := why != ""
	for i := range u.procs {
		p := &u.procs[i]
		k := key{p.PID, p.Start}
		if ps.touched[k] {
			continue
		}
		reniceFn(p.PID, 19)
		if w.c.cgOn {
			w.c.cg.join(w.c.cg.cpu, name, p.PID)
		}
		ps.touched[k] = true
	}
	if first {
		if w.c.cgOn {
			w.c.cg.setShares(name, 2)
		}
		w.act("throttle", name, nil, why)
	}
}

func (w *watcher) release(name string, ps *plugState, u *usage) {
	for i := range u.procs {
		p := &u.procs[i]
		if ps.touched[key{p.PID, p.Start}] {
			reniceFn(p.PID, 0)
		}
	}
	if w.c.cgOn {
		w.c.cg.setShares(name, 1024)
	}
	ps.touched, ps.state, ps.strikes = map[key]bool{}, "ok", 0
	w.act("release", name, nil, "back under budget")
}

func (w *watcher) escalate(name string, ps *plugState, u *usage, pct float64) {
	why := fmt.Sprintf("still %d%% CPU after throttle", int(pct))
	switch w.c.action {
	case "freeze":
		if !w.c.cgOn {
			return
		}
		for i := range u.procs {
			w.c.cg.join(w.c.cg.frz, name, u.procs[i].PID)
		}
		if w.c.cg.freeze(name, true) == nil {
			ps.state, ps.frozenFor = "frozen", 0
			w.act("freeze", name, nil, why)
		}
	case "kill":
		for i := range u.procs {
			p := &u.procs[i]
			if killFn(w.c.root, p.PID, p.Start, 9) {
				w.act("kill", name, p, why)
			}
		}
		ps.state, ps.strikes = "killed", 0
	}
}

func writeReport(path string, r report) error {
	b, _ := json.Marshal(r)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func parseBudgets(s string) (map[string]float64, error) {
	m := map[string]float64{}
	if s == "" {
		return m, nil
	}
	for _, kv := range strings.Split(s, ",") {
		i := strings.IndexByte(kv, '=')
		if i < 1 || !validName(kv[:i]) {
			return nil, fmt.Errorf("bad budget %q (want NAME=PERCENT)", kv)
		}
		v, err := strconv.ParseFloat(kv[i+1:], 64)
		if err != nil || v <= 0 {
			return nil, fmt.Errorf("bad budget %q (want NAME=PERCENT)", kv)
		}
		m[kv[:i]] = v
	}
	return m, nil
}

func cmdWatch(args []string) int {
	fs := flag.NewFlagSet("watch", flag.ContinueOnError)
	every := fs.Int("interval", 30, "seconds between rounds")
	rounds := fs.Int("rounds", 0, "stop after N rounds, 0 = run until stopped")
	rep := fs.String("report", "/data/local/tmp/matchi-guard/report.json", "report file (JSON, replaced every round)")
	budgets := fs.String("budget", "", "NAME=PERCENT,... CPU budget per plugin, percent of one core")
	def := fs.Float64("default-budget", 80, "budget for plugins not listed, percent of one core")
	hmax := fs.Int("helper-max", 20, "seconds before a busy helper (tr du grep cat awk cut find) of a plugin counts as stuck")
	act := fs.String("action", "throttle", "strongest action: throttle | freeze | kill")
	noCg := fs.Bool("no-cgroup", false, "use nice only, no cgroups")
	if fs.Parse(args) != nil || fs.NArg() != 0 || (*act != "throttle" && *act != "freeze" && *act != "kill") || *every < 1 || *def <= 0 {
		fmt.Fprintln(os.Stderr, "usage: matchi-guard watch [--interval S] [--rounds N] [--report FILE] [--budget NAME=PCT,...] [--default-budget PCT] [--helper-max S] [--action throttle|freeze|kill] [--no-cgroup]")
		return 2
	}
	b, err := parseBudgets(*budgets)
	if err != nil {
		fmt.Fprintln(os.Stderr, "matchi-guard:", err)
		return 2
	}
	w := newWatcher(cfg{interval: time.Duration(*every) * time.Second, budgets: b, defBudget: *def, helperMax: time.Duration(*hmax) * time.Second,
		throttleAt: 2, escalateAt: 6, calmAt: 2, action: *act, freezeRounds: 2, cg: defaultCg(), cgOn: !*noCg})
	reniceFn(0, 10) // the guard itself must be cheap
	for i := 0; *rounds == 0 || i < *rounds; i++ {
		if i > 0 {
			time.Sleep(w.c.interval)
		}
		r := w.round(time.Now())
		if err := writeReport(*rep, r); err != nil {
			fmt.Fprintln(os.Stderr, "matchi-guard: report:", err)
		}
	}
	return 0
}
