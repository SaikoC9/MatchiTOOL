#!/usr/bin/env python3
"""Resource-rule lint: finds code patterns that caused CPU spikes on the MU300 (phase 0-4 findings).

Rules (see docs/PLUGIN_RULES.md for the reasons):
  R1  du without -x                    ERROR  walked /proc and /sys inside a plugin rootfs (~4 s at 100% of one core)
  R2  find without -xdev/-mount/-maxdepth  ERROR  same cause
  R3  /proc/*/cmdline read by a tool or piped to tr   ERROR  the read never reaches EOF on this kernel; tr stuck at 100%
  R4  unbounded loop with no sleep / blocking read / break   ERROR  busy loop
  R5  timer under 1000 ms              ERROR  (host and plugin code)
  R6  timer file that also names an expensive route (tagged "@expensive-route" in the Kotlin routes)   ERROR unless the timer line has "lint-ok: <reason>"
  R7  mount command in plugin code     WARN   a mount inside the plugin data folder must be declared; the host's size check uses du -x so it is safe

Suppress one finding with "lint-ok: <reason>" on the same line. The reason is required.
Scans: Kotlin sources, web-src/*.js, docs/examples/*.js, and any extra files or folders given on the command line (your own plugins).
usage: lint_resource_rules.py [ROOT] [--plugin FILE_OR_DIR ...]      exit 1 on any ERROR; WARN is printed only.
"""
from pathlib import Path
import re, sys

SUPPRESS = re.compile(r'lint-ok:\s*\S')
TOOL_PREFIX = r'(?:^|[\s;|&(`"\'\x27]|\$T\s|\$\(\$T\s)'


def strip_comment(line: str) -> str:
    """Drop a whole-line comment or a trailing // or # comment that sits outside quotes (crude but enough for a lint)."""
    t = line.strip()
    if t.startswith(('//', '/*', '*', '#')):
        return ''
    for marker in (' // ', ' # '):
        i = line.find(marker)
        if i >= 0 and (line[:i].count('"') % 2 == 0) and (line[:i].count("'") % 2 == 0):
            return line[:i]
    return line


def flags_of(rest: str):
    """All option tokens at the start of a command's arguments."""
    out = []
    for tok in rest.split():
        if tok == '--':
            break
        if tok.startswith('-'):
            out.append(tok)
        else:
            break
    return out


def check_du(code):
    for m in re.finditer(TOOL_PREFIX + r'du(\s+[^;|&)\n]*)', code):
        fl = flags_of(m.group(1).lstrip())
        if not fl and not m.group(1).strip():
            continue  # the word "du" alone, not a command
        letters = ''.join(f[1:] for f in fl if not f.startswith('--'))
        if 'x' in letters or '--one-file-system' in fl:
            continue
        if not fl and not re.match(r'\s+(--|[/\'"$])', m.group(1)):
            continue  # prose such as "du the folder"
        return 'du without -x (add -x / --one-file-system and run it under timeout)'
    return None


def check_find(code):
    for m in re.finditer(TOOL_PREFIX + r'find(\s+[/\'"$.][^;|&)\n]*)', code):
        a = m.group(1)
        if re.search(r'-xdev|-mount|-maxdepth', a):
            continue
        return 'find without -xdev / -mount / -maxdepth'
    return None


def check_cmdline(code):
    if re.search(r'(?:grep|cat|tr|xargs|strings|sed|awk|head|cut)\b[^\n]*/proc/[^\s"\']*/cmdline', code):
        return '/proc/*/cmdline read by a tool: read the command line from "ps -A -o PID,ARGS" instead'
    if re.search(r'/cmdline[^\n]*\|\s*(?:\$T\s+)?tr\b', code):
        return '/proc/*/cmdline piped to tr: read the command line from "ps -A -o PID,ARGS" instead'
    return None


LOOP_SH = re.compile(r'\bwhile\s+(?:true|:|\[\s*1\s*\])\s*;?\s*do\b|\buntil\s+false\b')
LOOP_JS = re.compile(r'\bwhile\s*\(\s*(?:true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)')


def check_loops(lines, i):
    code = strip_comment(lines[i])
    window = '\n'.join(strip_comment(l) for l in lines[i:i + 20])
    if LOOP_SH.search(code):
        # a sleep, a blocking read, or a way out inside the next lines
        if re.search(r'\bsleep\b|\bread\b|\bbreak\b|\bexit\b|\bwait\b|\bnc\b', window):
            return None
        return 'unbounded shell loop with no sleep, blocking read or break'
    if LOOP_JS.search(code):
        if re.search(r'\bawait\b|\bbreak\b|\breturn\b', window):
            return None
        return 'unbounded JS loop with no await, break or return'
    return None


TIMER = re.compile(r'\b(?:setInterval|requestInterval|interval)\s*\(')


def check_timer_ms(code):
    for m in re.finditer(r'\b(?:setInterval|requestInterval|matchi\.interval)\s*\(.*?,\s*(\d+)\s*\)', code):
        if int(m.group(1)) < 1000:
            return f'timer every {m.group(1)} ms (minimum 1000)'
    return None


def check_mount(code):
    m = re.search(TOOL_PREFIX + r'mount(\s+[^;|&)\n]*)', code)
    if not m:
        return None
    args = m.group(1)
    if re.search(r'-o\b|-t\b|--bind|-B\b|--rbind|-R\b|-n\b', args) or len(re.findall(r'(?:^|\s)[/$\'"][^\s]*', args)) >= 2:
        return 'mount command: a mount inside the plugin data folder must be declared (docs/PLUGIN_RULES.md rule 3)'
    return None


def expensive_routes(root: Path):
    out = set()
    for p in (root / 'app/src/main/java/com/matchi/tool').glob('*.kt'):
        for line in p.read_text(errors='replace').splitlines():
            if '@expensive-route' in line:
                m = re.search(r'"(/api/[A-Za-z0-9_/.-]+)"', line)
                if m:
                    out.add(m.group(1))
    return out


def lint_text(name, text, is_plugin, expensive=()):
    """Returns a list of (severity, line number, rule, message). Public so the tests can call it."""
    lines = text.splitlines()
    res = []
    for i, raw in enumerate(lines):
        if SUPPRESS.search(raw):
            continue
        code = strip_comment(raw)
        if not code.strip():
            continue
        for rule, sev, fn in (('R1', 'ERROR', check_du), ('R2', 'ERROR', check_find), ('R3', 'ERROR', check_cmdline), ('R5', 'ERROR', check_timer_ms)):
            msg = fn(code)
            if msg:
                res.append((sev, i + 1, rule, msg))
        msg = check_loops(lines, i)
        if msg:
            res.append(('ERROR', i + 1, 'R4', msg))
        if is_plugin:
            msg = check_mount(code)
            if msg:
                res.append(('WARN', i + 1, 'R7', msg))
    if expensive and name.endswith('.js'):
        used = [r for r in expensive if r in text]
        if used:
            for i, raw in enumerate(lines):
                if TIMER.search(strip_comment(raw)) and not SUPPRESS.search(raw):
                    res.append(('ERROR', i + 1, 'R6', 'timer in a file that calls expensive route ' + ', '.join(sorted(used)) + ' (add "lint-ok: <reason>" if it is bounded and visibility-aware)'))
    return res


def gather(root: Path, extra):
    kt = root / 'app/src/main/java/com/matchi/tool'
    files = [(p, False) for p in sorted(kt.glob('*.kt'))]
    files += [(p, False) for p in sorted((root / 'app/src/main/web-src').glob('*.js'))]
    files += [(p, True) for p in sorted((root / 'docs/examples').glob('*.js'))]
    for e in extra:
        e = Path(e)
        if e.is_dir():
            files += [(p, True) for p in sorted(e.glob('*.js'))] + [(p, True) for p in sorted(e.glob('*.sh'))]
        elif e.is_file():
            files.append((e, True))
        else:
            print(f'not found: {e}')
            sys.exit(2)
    return files


def main(argv):
    args = argv[1:]
    extra = []
    root = Path(__file__).resolve().parent.parent
    if '--plugin' in args:
        i = args.index('--plugin')
        extra = args[i + 1:]
        args = args[:i]
    if args:
        root = Path(args[0])
    exp = expensive_routes(root)
    errors = warns = 0
    for path, is_plugin in gather(root, extra):
        for sev, ln, rule, msg in lint_text(path.name, path.read_text(errors='replace'), is_plugin, exp):
            print(f'{sev} {path.relative_to(root) if path.is_relative_to(root) else path}:{ln} [{rule}] {msg}')
            errors += sev == 'ERROR'
            warns += sev == 'WARN'
    print(f'resource-rule lint: {errors} error(s), {warns} warning(s); expensive routes: {", ".join(sorted(exp)) or "none"}')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
