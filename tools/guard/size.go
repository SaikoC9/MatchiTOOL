package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// dirSize is `du -skx`: it counts disk blocks, never follows symlinks, never crosses into another filesystem (so a plugin folder with
// proc, sys, dev or tmp mounted inside is not walked), counts a hard-linked file once, and stops at a deadline or an entry cap.
func dirSize(root string, deadline time.Time, maxEntries int) (kb int64, complete bool) {
	var st syscall.Stat_t
	if err := syscall.Lstat(root, &st); err != nil {
		return 0, true
	}
	dev := uint64(st.Dev)
	type inode struct{ dev, ino uint64 }
	seen := map[inode]bool{}
	var blocks int64
	n := 0
	complete = true
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		n++
		if n > maxEntries || (n%256 == 0 && time.Now().After(deadline)) {
			complete = false
			return filepath.SkipAll
		}
		var s syscall.Stat_t
		if syscall.Lstat(p, &s) != nil {
			return nil
		}
		if uint64(s.Dev) != dev {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if s.Nlink > 1 && !d.IsDir() {
			k := inode{uint64(s.Dev), uint64(s.Ino)}
			if seen[k] {
				return nil
			}
			seen[k] = true
		}
		blocks += int64(s.Blocks)
		return nil
	})
	return blocks / 2, complete
}

func cmdSize(args []string) int {
	fs := flag.NewFlagSet("size", flag.ContinueOnError)
	secs := fs.Int("timeout", 8, "seconds before the walk stops")
	maxN := fs.Int("max-entries", 2000000, "entries before the walk stops")
	if fs.Parse(args) != nil || fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: matchi-guard size [--timeout S] [--max-entries N] PATH")
		return 2
	}
	kb, ok := dirSize(fs.Arg(0), time.Now().Add(time.Duration(*secs)*time.Second), *maxN)
	fmt.Printf("%d\t%s\n", kb, fs.Arg(0))
	if !ok {
		fmt.Fprintln(os.Stderr, "matchi-guard: size is partial (stopped at the limit)")
		return 3
	}
	return 0
}
