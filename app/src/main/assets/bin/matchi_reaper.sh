#!/system/bin/sh
# MATCHI_REAPER_VERSION=7
# MatchiTOOL uninstall reaper. Runs as root, OUTSIDE the app sandbox (installed by the app to /data/local/matchitool/reaper/).
# Android runs no code of an app when it is uninstalled, so this script watches for the app to be gone and then removes what the
# app left on the device (docs/UNINSTALL_WIPE.md). It needs no app file, no jq, no curl and never talks to the router (D6).
#
# usage:  matchi_reaper.sh [watch]   watch loop (default): wait until the app is really gone, then wipe, then delete itself
#         matchi_reaper.sh wipe      one confirmed wipe now (used by tests and retries)
#
# Constants below are checked against app/.../Footprint.kt by scripts/check_footprint.py. Change them there first.
# Test hooks (never set on a phone): MR_ROOT (fake root prefix), MR_PROC, MR_OWNER_UID, MR_ONCE, MR_DEBUG, MR_*_S (delays).
#
# Processes: the command lines come from ONE bulk "ps -A -o PID,ARGS" and the plugin tags from ONE grep over the environ files, never from
# /proc/PID/cmdline (on the F50 kernel a tr/cat/grep read of it never reaches end of file and tr stays at 100% CPU, docs/PLUGIN_RULES.md rule 2),
# and the loops use shell built-ins only (a program per process took 19 s for 500 processes, see PluginSweep.kt).

R=${MR_ROOT:-}
PROC=${MR_PROC:-/proc}
OWNER=${MR_OWNER_UID:-0}
PKG=com.matchi.tool
B=/data/local/matchitool
RD=$B/reaper
LOGF=/data/local/matchitool-uninstall.log
LOGD=/data/adb/service.d/matchi_logd.sh
STUB=/data/adb/service.d/matchi_reaper.sh
LEGACY="/data/local/tmp/matchi_jobs /data/local/tmp/matchi_memory_clean /data/local/tmp/mt_isms.sh /data/local/tmp/matchi_update.log /data/local/tmp/.matchi_out_prev.apk"
BYPASS="/data/local/matchi_ttl /data/local/matchi_dpi /data/local/matchi_lock /data/local/matchi_boot"
PLUGDIRS="/data/local/adguardhome"
PORT=2334
IFP="br ap swlan usb rndis ecm"
AGH=AGH_UI
PROCS="matchi-guard matchi-sampler matchi-doctor sendat zreq AdGuardHome"
TCDEV=br0
TCIN="wlan0 usb0"
V4LO=1000; V4HI=1255
V6LO=1300; V6HI=1555
WATCH_S=${MR_WATCH_S:-15}
CONFIRM_S=${MR_CONFIRM_S:-20}
SETTLE_S=${MR_SETTLE_S:-60}
RETRY_S=${MR_RETRY_S:-300}
MAX_TRIES=5
SELF=matchi_reaper

say() { [ -z "${MR_DEBUG:-}" ] || echo "reaper: $*" >&2; return 0; }
nap() { sleep "$1" 2>/dev/null; return 0; }

# ---------------------------------------------------------------- is the app really gone?
boot_ready() {
  [ "$(getprop sys.boot_completed 2>/dev/null)" = 1 ] || return 1
  ce=$(getprop sys.user.0.ce_available 2>/dev/null)
  [ -z "$ce" ] || [ "$ce" = true ]
}

# An update or downgrade writes a timestamp first (pm uninstall -k keeps data, so a) and b) stay true anyway).
updating_recent() {
  f=$R$B/updating
  [ -f "$f" ] || return 1
  t=$(head -n 1 "$f" 2>/dev/null)
  case $t in ''|*[!0-9]*) return 1;; esac
  d=$(( $(date +%s) - t ))
  [ "$d" -gt -600 ] && [ "$d" -lt 600 ]
}

# One look. Every test must say "gone"; anything unclear counts as "present".
gone_once() {
  [ -e "$R/data/data/$PKG" ] && return 1                      # a) credential-encrypted storage
  [ -e "$R/data/user_de/0/$PKG" ] && return 1                 # b) device-encrypted storage
  for d in "$R"/data/app/*/$PKG-* "$R"/data/app/$PKG-*; do    # c) the installed APK
    [ -e "$d" ] && return 1
  done
  updating_recent && return 1
  boot_ready || return 1                                      # e) fully booted, user storage unlocked
  out=$(pm path "$PKG" 2>&1); rc=$?                           # d) empty answer; any text (an error) means unknown
  [ -z "$out" ] || return 1
  [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ] || return 1
  return 0
}

# Three agreeing looks, CONFIRM_S apart.
confirmed_gone() {
  i=0
  while [ "$i" -lt 3 ]; do
    gone_once || return 1
    i=$((i + 1))
    [ "$i" -lt 3 ] && nap "$CONFIRM_S"
  done
  return 0
}

wait_boot() {
  while ! boot_ready; do
    [ -n "${MR_ONCE:-}" ] && return 1
    nap 5
  done
  up=$(cut -d. -f1 "$PROC/uptime" 2>/dev/null)
  case $up in ''|*[!0-9]*) up=0;; esac
  [ "$up" -lt 300 ] && nap "$SETTLE_S"          # just booted: let the system settle
  return 0
}

# ---------------------------------------------------------------- path safety (same rules as Footprint.classify / PluginPaths)
ok_remove() {
  case $1 in ''|*..*|*//*) return 1;; /*) ;; *) return 1;; esac
  case $1 in
    "$B"|"$B"/*) return 0;;
    "$LOGD"|"$STUB") return 0;;
  esac
  for p in $LEGACY $BYPASS $PLUGDIRS; do [ "$1" = "$p" ] && return 0; done
  return 1
}

# Ledger path of a plugin (plugins.snap "P"): /data/local/NAME or /data/local/tmp/NAME, never ours, never /sdcard.
plugin_path_ok() {
  p=$1
  [ ${#p} -le 200 ] || return 1
  case $p in *[!A-Za-z0-9._/-]*) return 1;; esac
  case $p in /data/local/tmp/*) rest=${p#/data/local/tmp/}; tmp=1;; /data/local/*) rest=${p#/data/local/}; tmp=0;; *) return 1;; esac
  [ -n "$rest" ] || return 1
  oldifs=$IFS; IFS=/
  for c in $rest; do
    case $c in ''|.|..) IFS=$oldifs; return 1;; esac
  done
  IFS=$oldifs
  case $rest in */) return 1;; esac
  name=${rest%%/*}
  if [ "$tmp" = 1 ]; then
    low=$(printf '%s' "$name" | tr 'A-Z' 'a-z')
    case $low in matchi*|.matchi*|mt_*|.mt_*|sqlite*|.sqlite*|curl) return 1;; esac
  else
    case $name in tmp|matchitool|matchi_ttl|matchi_dpi|matchi_boot|matchi_lock) return 1;; esac
  fi
  # every parent below /data/local (including /data/local/tmp) must be a real folder
  rel=${p#/data/local/}
  oldifs=$IFS; IFS=/
  set -- $rel; count=$#
  IFS=$oldifs
  cur=/data/local; i=0
  for c in "$@"; do
    i=$((i + 1))
    [ "$i" -lt "$count" ] || break
    cur=$cur/$c
    [ -L "$R$cur" ] && return 1
  done
  return 0
}

# Is anything mounted at or below this path? (rm -rf must never walk into a mount.)
mount_inside() {
  [ -r "$PROC/mounts" ] || return 1
  while read -r dev mp rest; do
    case $mp in "$R$1"|"$R$1"/*) return 0;; esac
  done < "$PROC/mounts"
  return 1
}

safe_rm() {
  ok_remove "$1" || { say "refused path $1"; return 1; }
  [ -e "$R$1" ] || [ -L "$R$1" ] || return 0
  mount_inside "$1" && { say "mount inside $1"; return 1; }
  rm -rf "$R$1" 2>/dev/null
  return 0
}

# Same trust rules as HostService "trusted": not a symlink, owned by root, not group/other writable.
trusted() {
  [ -L "$1" ] && return 1
  set -- "$1" $(stat -c '%u %A' "$1" 2>/dev/null)
  [ -n "${2:-}" ] && [ "$2" = "$OWNER" ] || return 1
  case ${3:-} in ?????-??-?) return 0;; esac
  return 1
}

# ---------------------------------------------------------------- plugin snapshot (line based; written by the app, Phase 5)
#   T tag                                  process tag (MATCHI_PLUGIN)
#   P /data/local/...                      ledger path
#   B /path                                boot file
#   C table chain tool                     chain the plugin made
#   R tool table chain rule...             rule the plugin put into a (built-in) chain
#   X command                              approved stop command; runs only if its sha256 is in plugins.manifest
snap_text() {
  [ -d "$R$RD" ] && ! [ -L "$R$RD" ] || return 0
  [ -f "$R$RD/plugins.snap" ] || return 0
  if trusted "$R$B" && trusted "$R$RD" && trusted "$R$RD/plugins.snap"; then
    cat "$R$RD/plugins.snap" 2>/dev/null
  else
    say "plugins.snap not trusted: skipped"; NOTRUST=1
  fi
}

valid_chain() {
  case $1 in ''|*[!A-Za-z0-9_]*) return 1;; esac
  [ ${#1} -le 28 ] || return 1
  case $1 in INPUT|OUTPUT|FORWARD|PREROUTING|POSTROUTING) return 1;; esac
  case $1 in [A-Za-z]*) return 0;; esac
  return 1
}
valid_rule_chain() { case $1 in INPUT|OUTPUT|FORWARD|PREROUTING|POSTROUTING) return 0;; esac; valid_chain "$1"; }
valid_table() { case $1 in filter|nat|mangle|raw) return 0;; esac; return 1; }
valid_tool() { case $1 in iptables|ip6tables) return 0;; esac; return 1; }
valid_tag() { case $1 in ''|*[!A-Za-z0-9._-]*) return 1;; esac; [ ${#1} -le 90 ]; }   # plugin file names are up to 80 characters
valid_spec() { case $1 in ''|*[!A-Za-z0-9_./:,=!+\ -]*) return 1;; esac; [ ${#1} -le 200 ]; }   # same characters as PluginTrace.kt RULE_SPEC

# ---------------------------------------------------------------- firewall
ipt() {
  t=$1; shift
  "$t" -w 5 "$@" 2>/dev/null || "$t" "$@" 2>/dev/null
}
have() { command -v "$1" >/dev/null 2>&1; }
is_lan_if() {
  case $1 in ''|*[!A-Za-z0-9_.-]*) return 1;; esac
  for p in $IFP; do case $1 in "$p"*) return 0;; esac; done
  return 1
}

# The first console-port ACCEPT rule on a hotspot-side interface, read from the rule list (an unplugged interface does not matter).
console_rule_iface() {
  ipt "$1" -S INPUT | while read -r a b c d rest; do
    [ "$a" = -A ] && [ "$b" = INPUT ] && [ "$c" = -i ] || continue
    is_lan_if "$d" || continue
    case $rest in "-p tcp -m tcp --dport $PORT -j ACCEPT"|"-p tcp --dport $PORT -j ACCEPT") echo "$d"; break;; esac
  done
}
rm_console() {
  for tool in iptables ip6tables; do
    have "$tool" || continue
    n=0
    while [ "$n" -lt 20 ]; do
      i=$(console_rule_iface "$tool")
      [ -n "$i" ] || break
      ipt "$tool" -D INPUT -i "$i" -p tcp -m tcp --dport "$PORT" -j ACCEPT || ipt "$tool" -D INPUT -i "$i" -p tcp --dport "$PORT" -j ACCEPT || break
      n=$((n + 1))
    done
  done
}

# Jump rules to the chain (found in the rule list), then flush and delete the chain.
chain_jump() {
  ipt "$1" -t "$2" -S | while read -r l; do
    case $l in *\"*|*\'*) continue;; esac
    case $l in -A*" -j $3"|-A*" -j $3 "*) echo "$l"; break;; esac
  done
}
rm_chain() {
  have "$1" || return 0
  n=0
  while [ "$n" -lt 20 ]; do
    ln=$(chain_jump "$1" "$2" "$3")
    [ -n "$ln" ] || break
    set -f; ipt "$1" -t "$2" -D ${ln#-A } || { set +f; break; }; set +f
    n=$((n + 1))
  done
  ipt "$1" -t "$2" -F "$3" >/dev/null; ipt "$1" -t "$2" -X "$3" >/dev/null
  return 0
}
chain_exists() { ipt "$1" -t "$2" -S | while read -r l; do [ "$l" = "-N $3" ] && { echo 1; break; }; done; }

rm_rule() {   # tool table chain spec
  have "$1" || return 0
  n=0
  set -f
  while [ "$n" -lt 5 ]; do
    ipt "$1" -t "$2" -D "$3" $4 >/dev/null || break
    n=$((n + 1))
  done
  set +f
  return 0
}
rule_exists() { have "$1" || return 1; set -f; ipt "$1" -t "$2" -C "$3" $4 >/dev/null; r=$?; set +f; return $r; }

# ---------------------------------------------------------------- traffic control (only our htb 1: setup and our priorities)
our_prio() {
  case $1 in ''|*[!0-9]*) return 1;; esac
  [ "$1" -ge "$V4LO" ] && [ "$1" -le "$V4HI" ] && return 0
  [ "$1" -ge "$V6LO" ] && [ "$1" -le "$V6HI" ] && return 0
  return 1
}
tc_root_ours() { have tc || return 1; case $(tc qdisc show dev "$TCDEV" 2>/dev/null) in *"qdisc htb 1: root"*) return 0;; esac; return 1; }
ingress_prios() { tc filter show dev "$1" parent ffff: 2>/dev/null | sed -n -e 's/.* pref \([0-9][0-9]*\).*/\1/p' -e 's/.* prio \([0-9][0-9]*\).*/\1/p' | sort -u; }
tc_clean() {
  have tc || return 0
  for dev in $TCIN; do
    for p in $(ingress_prios "$dev"); do our_prio "$p" && tc filter del dev "$dev" parent ffff: prio "$p" 2>/dev/null; done
  done
  tc_root_ours && tc qdisc del dev "$TCDEV" root 2>/dev/null
  return 0
}
tc_left() {
  tc_root_ours && { echo "tc-root"; return; }
  have tc || return 0
  for dev in $TCIN; do
    for p in $(ingress_prios "$dev"); do our_prio "$p" && { echo "tc-filter"; return; }; done
  done
}

# ---------------------------------------------------------------- processes (exact names, never a pattern like "matchi")
tags_wanted() {   # tags from the snapshot, one per line
  printf '%s\n' "$SNAP" | while read -r k v rest; do [ "$k" = T ] && valid_tag "$v" && echo "$v"; done
}
psl() {   # the process list: "PID ARGS" per line, one ps call, with a time limit where "timeout" exists
  T=$(command -v timeout 2>/dev/null) && T='timeout 6'
  $T ps -A -o PID,ARGS 2>/dev/null
}
args_of() {   # the command line of one pid ("" when it is not running)
  psl | while read -r q a; do [ "$q" = "$1" ] && { echo "$a"; break; }; done
}
# A script that lives in one of the Bypass folders ("sh /data/local/matchi_ttl/ttl.sh watch"): the program or its first argument is a path below them.
# These loops are not tagged and not in PROCS; left running they put the lock folder and the rules back after the wipe.
bypass_proc() {
  for x in "$1" "$2"; do
    for d in $BYPASS; do case $x in "$R$d"/*) return 0;; esac; done
  done
  return 1
}
# Prints the pids of our processes: exact program names, the boot log capture loop, and processes carrying a wanted MATCHI_PLUGIN tag.
find_ours() {
  C=$(psl)
  E=$(grep -a -o -H -E '(^|[^A-Za-z0-9_])MATCHI_PLUGIN=[A-Za-z0-9._-]+' "$PROC"/[0-9]*/environ 2>/dev/null | tr '\000' ' ')   # only processes that have the variable are listed
  printf '%s\n' "$C" | while read -r pid a0 a1 rest; do
    case $pid in ''|*[!0-9]*) continue;; esac
    [ "$pid" = "$$" ] && continue
    [ "$pid" = "${PPID:-0}" ] && continue
    case " $a0 $a1 $rest " in *"$SELF"*) continue;; esac       # never the reaper itself (or a second reaper)
    [ -n "$a0" ] || continue
    b0=${a0##*/}
    for n in $PROCS; do [ "$b0" = "$n" ] && { echo "$pid"; continue 2; }; done
    bypass_proc "$a0" "$a1" && { echo "$pid"; continue; }       # Bypass script loop (ttl.sh watch and the like)
    [ "$a1" = "$R$LOGD" ] && { echo "$pid"; continue; }         # boot log capture loop (and its forks)
    case $E in
      *"$PROC/$pid/environ:"*)
        y=${E#*"$PROC/$pid/environ:"}; y=${y#*MATCHI_PLUGIN=}; tag=${y%%[!A-Za-z0-9._-]*}
        case $tag in boot|boot-*) echo "$pid"; continue;; esac
        for t in $TAGS; do [ "$tag" = "$t" ] && { echo "$pid"; continue 2; }; done;;
    esac
  done
}
# A pid file of the capture loop: kill only when the process really is what the script started.
kill_pidfile() {
  [ -f "$1" ] || return 0
  p=$(head -n 1 "$1" 2>/dev/null)
  case $p in ''|*[!0-9]*) return 0;; esac
  [ "$p" = "$$" ] && return 0
  set -- $(args_of "$p")
  [ -n "${1:-}" ] || return 0
  case " $* " in *"$SELF"*) return 0;; esac
  b=${1##*/}
  case $b in logcat|dmesg|cat) kill "$p" 2>/dev/null; return 0;; esac
  [ "${2:-}" = "$R$LOGD" ] && kill "$p" 2>/dev/null
  return 0
}
kill_bypass() {   # only the Bypass script loops, first, so they cannot put rules or the lock folder back
  C=$(psl)
  printf '%s\n' "$C" | while read -r pid a0 a1 rest; do
    case $pid in ''|*[!0-9]*) continue;; esac
    [ "$pid" = "$$" ] && continue
    [ "$pid" = "${PPID:-0}" ] && continue
    case " $a0 $a1 $rest " in *"$SELF"*) continue;; esac
    bypass_proc "$a0" "$a1" && kill "$pid" 2>/dev/null
  done
  nap 1
  return 0
}
kill_all() {
  for p in $(find_ours); do kill "$p" 2>/dev/null; done
  for f in "$R$B"/bootlogs/logd.pid "$R$B"/bootlogs/.cap.*; do kill_pidfile "$f"; done
  nap 2
  for p in $(find_ours); do kill -9 "$p" 2>/dev/null; done
  for f in "$R$B"/bootlogs/logd.pid "$R$B"/bootlogs/.cap.*; do
    [ -f "$f" ] && { kill_pidfile "$f"; }
  done
  return 0
}

# ---------------------------------------------------------------- plugin stop actions (hash pinned, D3)
run_limited() {
  sh -c "$1" >/dev/null 2>&1 &
  cp=$!; i=0
  while kill -0 "$cp" 2>/dev/null && [ "$i" -lt "$2" ]; do nap 1; i=$((i + 1)); done
  kill -9 "$cp" 2>/dev/null; wait "$cp" 2>/dev/null
  SPENT=$((SPENT + i))
}
run_actions() {
  SPENT=0
  have sha256sum || { say "no sha256sum: stop commands skipped"; return 0; }
  [ -f "$R$RD/plugins.manifest" ] && trusted "$R$RD/plugins.manifest" || return 0
  while read -r k cmd; do
    [ "$k" = X ] || continue
    [ "$SPENT" -lt 60 ] || break
    [ -n "$cmd" ] && [ ${#cmd} -le 300 ] || continue
    case $cmd in *[![:print:]]*) continue;; esac
    h=$(printf '%s' "$cmd" | sha256sum | cut -d' ' -f1)
    ok=
    while read -r mh; do [ "$mh" = "$h" ] && ok=1; done < "$R$RD/plugins.manifest"
    [ -n "$ok" ] || { say "stop command not in manifest: skipped"; continue; }
    run_limited "$cmd" 20
  done <<EOF
$SNAP
EOF
  return 0
}

# ---------------------------------------------------------------- the wipe steps
snap_each() {   # print lines of kind $1 (rest of the line after the kind)
  printf '%s\n' "$SNAP" | while read -r k rest; do [ "$k" = "$1" ] && echo "$rest"; done
}

step_boot_entries() {
  safe_rm "$LOGD"
  safe_rm "$B/boot.sh"
  safe_rm "$B/boot.d"
  snap_each B | while read -r p; do
    case $p in "$B"/*) continue;; esac
    plugin_path_ok "$p" && [ ! -d "$R$p" ] && rm -f "$R$p" 2>/dev/null
  done
}
step_rules() {
  rm_console
  for tool in iptables ip6tables; do rm_chain "$tool" filter "$AGH"; done
  snap_each C | while read -r tbl ch tool; do
    valid_table "$tbl" && valid_chain "$ch" && valid_tool "$tool" && rm_chain "$tool" "$tbl" "$ch"
  done
  snap_each R | while read -r tool tbl ch spec; do
    valid_tool "$tool" && valid_table "$tbl" && valid_rule_chain "$ch" && valid_spec "$spec" && rm_rule "$tool" "$tbl" "$ch" "$spec"
  done
}
step_files() {
  # everything in the folder except reaper/ (needed for a retry); then the fixed outside names; then ledger paths
  if [ -L "$R$B" ]; then say "folder is a symlink: refused"; return 1; fi
  mount_inside "$B" && { say "mount inside $B: not deleting"; return 1; }
  for e in "$R$B"/* "$R$B"/.[!.]* "$R$B"/..?*; do
    { [ -e "$e" ] || [ -L "$e" ]; } || continue
    [ "${e##*/}" = reaper ] && continue
    rm -rf "$e" 2>/dev/null
  done
  for p in $LEGACY $BYPASS $PLUGDIRS; do safe_rm "$p"; done
  snap_each P | while read -r p; do
    case $p in "$B"|"$B"/*) continue;; esac
    if plugin_path_ok "$p" && ! mount_inside "$p"; then rm -rf "$R$p" 2>/dev/null; fi
  done
  return 0
}

# What is still there (empty output = clean). The reaper's own folder and stub do not count.
leftover() {
  [ -n "$(find_ours)" ] && echo "process"
  for tool in iptables ip6tables; do
    have "$tool" || continue
    [ -n "$(console_rule_iface "$tool")" ] && echo "console-rule"
    [ -n "$(chain_exists "$tool" filter "$AGH")" ] && echo "agh-chain"
  done
  snap_each C | while read -r tbl ch tool; do
    valid_table "$tbl" && valid_chain "$ch" && valid_tool "$tool" && have "$tool" && [ -n "$(chain_exists "$tool" "$tbl" "$ch")" ] && echo "chain-$ch"
  done
  snap_each R | while read -r tool tbl ch spec; do
    valid_tool "$tool" && valid_table "$tbl" && valid_rule_chain "$ch" && valid_spec "$spec" && rule_exists "$tool" "$tbl" "$ch" "$spec" && echo "rule-$ch"
  done
  tc_left
  [ -e "$R$LOGD" ] && echo "logd-stub"
  for p in $LEGACY $BYPASS $PLUGDIRS; do [ -e "$R$p" ] || [ -L "$R$p" ] && echo "tmp-file"; done
  for e in "$R$B"/* "$R$B"/.[!.]* "$R$B"/..?*; do
    { [ -e "$e" ] || [ -L "$e" ]; } || continue
    [ "${e##*/}" = reaper ] && continue
    echo "folder"; break
  done
  snap_each P | while read -r p; do
    case $p in "$B"|"$B"/*) continue;; esac
    plugin_path_ok "$p" && { [ -e "$R$p" ] || [ -L "$R$p" ]; } && echo "plugin-path"
  done
  return 0
}

tries_done() {
  t=$(sed -n 's/.*retry=\([0-9][0-9]*\).*/\1/p' "$R$LOGF" 2>/dev/null | head -n 1)
  case $t in ''|*[!0-9]*) t=0;; esac
  echo "$t"
}

# Returns 0 = finished (clean, or gave up), 1 = incomplete, try again later, 2 = the app is back, nothing more to do.
run_wipe() {
  tries=$(tries_done)   # not "n": the helpers below use n as their own loop counter (all variables are global in sh), which reset the count and the limit never came
  [ "$tries" -ge "$MAX_TRIES" ] && { say "gave up after $tries tries"; return 0; }
  confirmed_gone || return 2
  SNAP=$(snap_text)
  TAGS=$(tags_wanted)
  step_boot_entries
  gone_once || return 2
  kill_bypass
  step_rules
  gone_once || return 2
  tc_clean
  gone_once || return 2
  kill_all
  run_actions
  gone_once || return 2
  step_files
  kill_all                                       # anything a stop command or a late plugin start left
  left=$(leftover | sort -u | tr '\n' ' ')
  if [ -n "$left" ]; then
    echo "$(date '+%F %T') retry=$((tries + 1)) left=$left" > "$R$LOGF" 2>/dev/null
    say "left: $left"
    return 1
  fi
  # clean: delete the reaper itself, the stub (last), and the log
  rm -rf "$R$RD" 2>/dev/null
  rmdir "$R$B" 2>/dev/null
  safe_rm "$STUB"
  rm -f "$R$LOGF" 2>/dev/null
  return 0
}

# ---------------------------------------------------------------- watch loop
single() {
  [ -d "$R$RD" ] || return 0
  f=$R$RD/watch.pid
  if [ -f "$f" ]; then
    op=$(head -n 1 "$f" 2>/dev/null)
    case $op in ''|*[!0-9]*) ;; *)
      if [ "$op" != "$$" ] && kill -0 "$op" 2>/dev/null; then
        case $(args_of "$op") in *"$SELF"*) return 1;; esac
      fi;;
    esac
  fi
  echo "$$" > "$f" 2>/dev/null
  return 0
}

watch_loop() {
  single || return 0
  wait_boot || return 0
  while :; do
    if [ ! -e "$R/data/data/$PKG" ]; then
      run_wipe; rc=$?
      case $rc in
        0) return 0;;
        1) [ -n "${MR_ONCE:-}" ] && return 1; nap "$RETRY_S"; continue;;
      esac
    fi
    [ -n "${MR_ONCE:-}" ] && return 0
    nap "$WATCH_S"
  done
}

main() {
  case ${1:-watch} in
    watch) watch_loop; return $?;;
    wipe) run_wipe; return $?;;
    *) echo "usage: matchi_reaper.sh [watch|wipe]" >&2; return 2;;
  esac
}
main "$@"
exit $?
