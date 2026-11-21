package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"
)

func selfPID() int { return os.Getpid() }

// limits: zero means "no limit".
type limits struct {
	wall  time.Duration
	cpu   time.Duration
	memKB int64
	procs int
}

type groupUse struct {
	cpu   time.Duration
	memKB int64
	procs int
}

// breach says which limit is exceeded first ("" when none).
func breach(l limits, elapsed time.Duration, u groupUse) (what string, val, max int64) {
	switch {
	case l.wall > 0 && elapsed > l.wall:
		return "wall", int64(elapsed / time.Second), int64(l.wall / time.Second)
	case l.cpu > 0 && u.cpu > l.cpu:
		return "cpu", int64(u.cpu / time.Second), int64(l.cpu / time.Second)
	case l.memKB > 0 && u.memKB > l.memKB:
		return "mem", u.memKB / 1024, l.memKB / 1024
	case l.procs > 0 && u.procs > l.procs:
		return "procs", int64(u.procs), int64(l.procs)
	}
	return "", 0, 0
}

func measureGroup(root string, pgid int) (groupUse, []procInfo) {
	var u groupUse
	var m []procInfo
	for _, p := range scanProcs(root) {
		if p.PGID == pgid && p.State != 'Z' {
			m = append(m, p)
			u.cpu += time.Duration(p.Ticks) * time.Second / clkTck
			u.memKB += p.RSSPages * int64(os.Getpagesize()) / 1024
			u.procs++
		}
	}
	return u, m
}

var superviseTick = 500 * time.Millisecond

// terminateGroup: TERM, up to 2 s of grace, then KILL, always by PID + start time.
func terminateGroup(root string, pgid int) {
	_, m := measureGroup(root, pgid)
	for _, p := range m {
		killFn(root, p.PID, p.Start, syscall.SIGTERM)
	}
	for i := 0; i < 10; i++ {
		time.Sleep(200 * time.Millisecond)
		if _, m = measureGroup(root, pgid); len(m) == 0 {
			return
		}
	}
	for _, p := range m {
		killFn(root, p.PID, p.Start, syscall.SIGKILL)
	}
}

type event struct {
	TS     int64  `json:"ts"`
	Event  string `json:"event"`
	Plugin string `json:"plugin"`
	Limit  string `json:"limit,omitempty"`
	Value  int64  `json:"value,omitempty"`
	Max    int64  `json:"max,omitempty"`
}

func emit(path string, e event) {
	e.TS = time.Now().Unix()
	b, _ := json.Marshal(e)
	fmt.Fprintf(os.Stderr, "matchi-guard: %s\n", b)
	if path != "" {
		if f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
			f.Write(append(b, '\n'))
			f.Close()
		}
	}
}

func cmdRun(args []string) int {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	plugin := fs.String("plugin", "", "plugin name (required)")
	wall := fs.Int("wall", 0, "seconds of wall time, 0 = no limit")
	cpu := fs.Int("cpu", 0, "seconds of CPU time over the whole group, 0 = no limit")
	mem := fs.Int("mem", 0, "MB of resident memory over the whole group, 0 = no limit")
	procs := fs.Int("procs", 0, "most processes in the group, 0 = no limit")
	nice := fs.Int("nice", 0, "nice value for the command and its children (0 to 19)")
	shares := fs.Int("shares", 0, "cpu.shares of the plugin cgroup (2 to 1024), 0 = no cgroup")
	report := fs.String("report", "", "file that receives one JSON line when a limit is hit")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	rest := fs.Args()
	if !validName(*plugin) || len(rest) == 0 || *nice < 0 || *nice > 19 || (*shares != 0 && (*shares < 2 || *shares > 1024)) {
		fmt.Fprintln(os.Stderr, "usage: matchi-guard run --plugin NAME [--wall S] [--cpu S] [--mem MB] [--procs N] [--nice N] [--shares N] [--report FILE] -- command [args...]")
		return 2
	}
	lim := limits{time.Duration(*wall) * time.Second, time.Duration(*cpu) * time.Second, int64(*mem) * 1024, *procs}

	if *nice > 0 {
		reniceFn(0, *nice) // children inherit it
	}
	if *shares > 0 {
		h := defaultCg()
		if h.setShares(*plugin, *shares) == nil {
			h.join(h.cpu, *plugin, os.Getpid())
		}
		if *mem > 0 && h.setMemLimit(*plugin, int64(*mem)*1024*1024*5/4) == nil { // kernel backstop 25% above our own limit
			h.join(h.mem, *plugin, os.Getpid())
		}
	}

	cmd := exec.Command(rest[0], rest[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = append(envWithout(os.Environ(), tagVar), tagVar+"="+*plugin)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "matchi-guard: cannot start %s: %v\n", rest[0], err)
		return 127
	}
	pgid := cmd.Process.Pid
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	start := time.Now()
	tick := time.NewTicker(superviseTick)
	defer tick.Stop()
	for {
		select {
		case err := <-done:
			return exitCode(cmd, err)
		case s := <-sig:
			terminateGroup("", pgid)
			<-done
			if ss, ok := s.(syscall.Signal); ok {
				return 128 + int(ss)
			}
			return 143
		case <-tick.C:
			u, _ := measureGroup("", pgid)
			if what, v, m := breach(lim, time.Since(start), u); what != "" {
				emit(*report, event{Event: "limit", Plugin: *plugin, Limit: what, Value: v, Max: m})
				terminateGroup("", pgid)
				<-done
				return 124
			}
		}
	}
}

func exitCode(cmd *exec.Cmd, err error) int {
	if cmd.ProcessState == nil {
		return 1
	}
	if ws, ok := cmd.ProcessState.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		return 128 + int(ws.Signal())
	}
	return cmd.ProcessState.ExitCode()
}

func envWithout(env []string, name string) []string {
	out := make([]string, 0, len(env)+1)
	for _, e := range env {
		if len(e) > len(name) && e[:len(name)+1] == name+"=" {
			continue
		}
		out = append(out, e)
	}
	return out
}
