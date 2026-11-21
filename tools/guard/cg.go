package main

import (
	"os"
	"strconv"
)

// cgHost drives the Android cgroup v1 mounts found on the MU300: cpu (cpu.shares), memory, freezer.
// There is no CFS bandwidth on this kernel, so there is no hard CPU percentage cap: shares only decide who wins when the CPU is busy.
type cgHost struct{ cpu, mem, frz string }

func defaultCg() cgHost { return cgHost{"/dev/cpuctl", "/dev/memcg", "/dev/cpufreezer"} }

func (h cgHost) dir(root, name string) string { return root + "/matchi-" + name }

func writeFile(path, val string) error { return os.WriteFile(path, []byte(val), 0) }

// join puts pid in the group (created on demand). Errors are returned, never fatal: a missing cgroup only means less protection.
func (h cgHost) join(root, name string, pid int) error {
	d := h.dir(root, name)
	if err := os.Mkdir(d, 0o755); err != nil && !os.IsExist(err) {
		return err
	}
	v := strconv.Itoa(pid)
	if err := writeFile(d+"/cgroup.procs", v); err != nil {
		return writeFile(d+"/tasks", v)
	}
	return nil
}

func (h cgHost) setShares(name string, n int) error {
	d := h.dir(h.cpu, name)
	if err := os.Mkdir(d, 0o755); err != nil && !os.IsExist(err) {
		return err
	}
	return writeFile(d+"/cpu.shares", strconv.Itoa(n))
}

func (h cgHost) setMemLimit(name string, bytes int64) error {
	d := h.dir(h.mem, name)
	if err := os.Mkdir(d, 0o755); err != nil && !os.IsExist(err) {
		return err
	}
	return writeFile(d+"/memory.limit_in_bytes", strconv.FormatInt(bytes, 10))
}

func (h cgHost) freeze(name string, on bool) error {
	v := "THAWED"
	if on {
		v = "FROZEN"
	}
	return writeFile(h.dir(h.frz, name)+"/freezer.state", v)
}
