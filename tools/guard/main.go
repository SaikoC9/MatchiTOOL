// matchi-guard: keeps plugin processes from taking over the CPU. Stdlib only, no cgo.
//
//	matchi-guard run   --plugin NAME [limits] -- command [args...]   run a plugin command with limits and a MATCHI_PLUGIN tag
//	matchi-guard watch [--interval S] [--budget NAME=PCT,...] ...    sum CPU per plugin, stop stuck helpers, throttle plugins over budget
//	matchi-guard size  PATH                                          disk size of a folder like `du -skx`, with a deadline
//	matchi-guard version
//
// Design, limits and the safe-kill rules: DESIGN.md. The kernel on the target phone has no CFS bandwidth, so there is no hard CPU
// percentage cap: the guard limits damage and reacts within one interval.
package main

import (
	"fmt"
	"os"
)

const version = "matchi-guard 1.0 (MatchiTOOL)"

func main() { os.Exit(dispatch(os.Args[1:])) }

func dispatch(a []string) int {
	if len(a) == 0 {
		fmt.Fprintln(os.Stderr, "usage: matchi-guard run|watch|size|version (see README.md)")
		return 2
	}
	switch a[0] {
	case "run":
		return cmdRun(a[1:])
	case "watch":
		return cmdWatch(a[1:])
	case "size":
		return cmdSize(a[1:])
	case "version", "--version":
		fmt.Println(version)
		return 0
	}
	fmt.Fprintf(os.Stderr, "matchi-guard: unknown command %q\n", a[0])
	return 2
}
