#!/usr/bin/env python3
"""Phase 3 / Step 2: runs the REAL undo script of PluginUndo.kt in a real sh, against a fake iptables / ip6tables (a state file) and a fake stat.
The script text is read out of the Kotlin file (the raw string "template" in undoScript), so this tests what the app would send, not a copy.
Needs sh and awk. The Kotlin unit tests (PluginUndoRunTest.kt) check the same things through the app code; this one runs without the Android build."""
import re,os,subprocess,tempfile,shutil,sys
import pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
kt=(ROOT/'app/src/main/java/com/matchi/tool/PluginUndo.kt').read_text()
tpl=kt.split('val template = """\n',1)[1].split('""".trimIndent()',1)[0]
FAKE_IPT = r'''#!/bin/sh
case "^(basename "^0")" in ip6tables) F="^FW6";; *) F="^FW4";; esac
echo "^*" >> "^FW4.calls"
WAITED=0
if [ "^1" = "-w" ]; then
  if [ "^FAKE_WAIT" = 1 ]; then shift 2; WAITED=1; else exit 2; fi
fi
if [ "^FAKE_LOCK" = 1 ] && [ ^WAITED = 0 ]; then echo "Another app is currently holding the xtables lock" >&2; exit 4; fi
[ "^1" = "-t" ] || exit 2
T=^2; shift 2
op=^1; shift
case "^op" in
  -S)
    [ "^FAIL_S" = 1 ] && exit 1
    if [ -n "^1" ]; then
      awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} ^1!=T{next} {line=substr(^0,length(^1)+2)} line=="-N " c||index(line,"-P " c " ")==1{decl=line;found=1} index(line,"-A " c " ")==1{r[++n]=line} END{if(!found)exit 1;print decl;for(i=1;i<=n;i++)print r[i]}' "^F"
    else
      awk -v T="^T" 'BEGIN{FS="|"} ^1!=T{next} {line=substr(^0,length(^1)+2)} index(line,"-A ")==1{r[++n]=line;next} {print line} END{for(i=1;i<=n;i++)print r[i]}' "^F"
    fi ;;
  -D)
    [ "^FAIL_D" = 1 ] && exit 1
    awk -v T="^T" -v c="^1" -v k="^2" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&index(line,"-A " c " ")==1{i++; if(i==k){d=1;next}} {print} END{exit d?0:1}' "^F" >"^F.new"; rc=^?
    if [ ^rc = 0 ]; then mv "^F.new" "^F"; else rm -f "^F.new"; fi; exit ^rc ;;
  -F)
    awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&index(line,"-A " c " ")==1{next} {print}' "^F" >"^F.new" && mv "^F.new" "^F" ;;
  -X)
    awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&line=="-N " c{found=1} ^1==T&&index(line,"-A ")==1{ if(index(line,"-A " c " ")==1)busy=1; n=split(line,w," "); if(n>=2&&(w[n-1]=="-j"||w[n-1]=="-g")&&w[n]==c)busy=1 } END{exit (found&&!busy)?0:1}' "^F" || exit 1
    awk -v T="^T" -v c="^1" 'BEGIN{FS="|"} {line=substr(^0,length(^1)+2)} ^1==T&&line=="-N " c{next} {print}' "^F" >"^F.new" && mv "^F.new" "^F" ;;
  *) exit 2 ;;
esac
'''
fake=FAKE_IPT.replace('^','$')+"\n"
STAT='#!/bin/sh\ncase "$3" in *owned-by-other*) echo 1000;; *) echo 0;; esac\n'
vt=kt.split('val verifyTemplate = """\n',1)[1].split('""".trimIndent()',1)[0]
def vrender(calls,pfx=''):
    return vt.replace('^','$').replace('@PFX@',pfx).replace('@CALLS@','\n'.join(calls))
def render(calls,pfx=''):
    return tpl.replace('^','$').replace('@PFX@',pfx).replace('@MAXJUMPS@','40').replace('@CALLS@','\n'.join(calls))
class W:
    def __init__(s,ip6=True):
        s.d=tempfile.mkdtemp(); s.bin=s.d+'/bin'; os.makedirs(s.bin); s.root=s.d+'/root'; os.makedirs(s.root)
        for n,t in [('iptables',fake),('stat',STAT)]+([('ip6tables',fake)] if ip6 else []):
            open(s.bin+'/'+n,'w').write(t); os.chmod(s.bin+'/'+n,0o755)
        s.fw4=s.d+'/fw4'; s.fw6=s.d+'/fw6'; open(s.fw4,'w'); open(s.fw6,'w'); s.faild=False
    def v4(s,*l): open(s.fw4,'w').write('\n'.join(l)+'\n')
    def rules(s): return [x for x in open(s.fw4).read().split('\n') if x]
    failS=False; wait=False; lock=False
    def calls(s):
        try: return [x for x in open(s.fw4+'.calls').read().split('\n') if x]
        except OSError: return []
    def run(s,calls,v=False):
        env=dict(os.environ,PATH=s.bin+':/usr/bin:/bin',FW4=s.fw4,FW6=s.fw6)
        if s.wait: env['FAKE_WAIT']='1'
        if s.lock: env['FAKE_LOCK']='1'
        if s.faild: env['FAIL_D']='1'
        if s.failS: env['FAIL_S']='1'
        r=subprocess.run(['sh','-c',(vrender if v else render)(calls,s.root)],env=env,capture_output=True,text=True,timeout=30)
        return r.returncode,r.stdout+r.stderr
    def boot(s):
        p=s.root+'/data/local/matchitool/boot.d'; os.makedirs(p,exist_ok=True); return p
C="undo_chain 'mangle' 'MY_CHAIN' 'iptables'"
B="undo_boot '/data/local/matchitool/boot.d/%s'"
fails=0; total=0
def check(n,c,extra=''):
    global fails,total
    total+=1
    if not c: print('FAIL '+n+'  '+str(extra))
    if not c: fails+=1
SYS=["mangle|-P PREROUTING ACCEPT","mangle|-P POSTROUTING ACCEPT","mangle|-N OTHER"]
# 1 chain + jumps from two parents, other table untouched
w=W(); w.v4(*SYS,"mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN","mangle|-A POSTROUTING -o wlan0 -j ACCEPT","mangle|-A POSTROUTING -p tcp -g MY_CHAIN","mangle|-A OTHER -s 10.0.0.1/32 -j MY_CHAIN","mangle|-A OTHER -j ACCEPT","mangle|-A MY_CHAIN -p tcp -j TCPMSS --set-mss 1300","nat|-N MY_CHAIN","nat|-A MY_CHAIN -j RETURN")
rc,out=w.run([C]); 
exp=sorted(SYS+["nat|-N MY_CHAIN","mangle|-A POSTROUTING -o wlan0 -j ACCEPT","mangle|-A OTHER -j ACCEPT","nat|-A MY_CHAIN -j RETURN"])
check('chain+3 jumps removed, rest untouched',rc==0 and 'MTUNDO|chain|mangle|MY_CHAIN|iptables|removed' in out and 'MTUNDO|jumps|mangle|MY_CHAIN|iptables|3' in out and sorted(w.rules())==exp,(out,w.rules()))
# 2 two jumps in one parent (numbers shift)
w=W(); w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN","mangle|-A POSTROUTING -j ACCEPT")
rc,out=w.run([C]); check('two adjacent jumps',w.rules()==["mangle|-P POSTROUTING ACCEPT","mangle|-A POSTROUTING -j ACCEPT"],(out,w.rules()))
# 3 absent
w=W(); w.v4(*SYS,"mangle|-A POSTROUTING -j ACCEPT"); b=w.rules(); rc,out=w.run([C]); check('absent, unchanged','|absent' in out and w.rules()==b,out)
# 4 quoted comment
w=W(); w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN",'mangle|-A POSTROUTING -m comment --comment "x -j MY_CHAIN"',"mangle|-A POSTROUTING -j MY_CHAIN")
rc,out=w.run([C]); check('comment rule kept',w.rules()==["mangle|-P POSTROUTING ACCEPT",'mangle|-A POSTROUTING -m comment --comment "x -j MY_CHAIN"'] and '|removed' in out,(out,w.rules()))
# 5 undeletable jump => not flushed
w=W(); w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN","mangle|-A MY_CHAIN -j ACCEPT"); b=w.rules(); w.faild=True
rc,out=w.run([C]); check('failed, chain not flushed','|failed' in out and w.rules()==b,(out,w.rules()))
# 6 ip6 missing tool, ip4 ok
w=W(ip6=False); w.v4("mangle|-N A","mangle|-A A -j ACCEPT"); rc,out=w.run(["undo_chain 'mangle' 'A' 'iptables'","undo_chain 'mangle' 'A' 'ip6tables'"])
check('notool for ip6tables, ip4 removed','MTUNDO|chain|mangle|A|ip6tables|notool' in out and 'MTUNDO|chain|mangle|A|iptables|removed' in out and w.rules()==[],out)
# 7 boot rules
w=W(); d=w.boot(); open(d+'/20-bypass-ttl.sh','w').write('x')
rc,out=w.run([B%'20-bypass-ttl.sh']); check('boot removed','20-bypass-ttl.sh|removed' in out and not os.path.exists(d+'/20-bypass-ttl.sh'),out)
rc,out=w.run([B%'20-bypass-ttl.sh']); check('boot absent','|absent' in out,out)
open(d+'/30-real.sh','w').write('x'); os.symlink(d+'/30-real.sh',d+'/31-link.sh')
rc,out=w.run([B%'31-link.sh']); check('symlink refused',('refused-symlink' in out) and os.path.islink(d+'/31-link.sh') and os.path.exists(d+'/30-real.sh'),out)
os.makedirs(d+'/32-dir.sh'); rc,out=w.run([B%'32-dir.sh']); check('dir refused','refused-notfile' in out and os.path.isdir(d+'/32-dir.sh'),out)
open(d+'/33-owned-by-other.sh','w').write('x'); rc,out=w.run([B%'33-owned-by-other.sh']); check('other owner refused','refused-owner' in out and os.path.exists(d+'/33-owned-by-other.sh'),out)
# 8 symlinked boot dir
w=W(); real=w.d+'/elsewhere'; os.makedirs(real); open(real+'/20-bypass-ttl.sh','w').write('x'); os.makedirs(w.root+'/data/local'); os.symlink(real,w.root+'/data/local/matchitool')
rc,out=w.run([B%'20-bypass-ttl.sh']); check('symlinked parent refused','refused-dir' in out and os.path.exists(real+'/20-bypass-ttl.sh'),out)
# 9 chain + boot in one run
w=W(); w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN"); open(w.boot()+'/20-bypass-ttl.sh','w').write('x')
rc,out=w.run([C,B%'20-bypass-ttl.sh']); check('both, END marker',out.strip().endswith('MTUNDO-END') and w.rules()==["mangle|-P POSTROUTING ACCEPT"],out)
# 10 hostile rule text: command substitution in a comment must not run
w=W(); marker=w.d+'/PWNED'
w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN",f'mangle|-A POSTROUTING -m comment --comment "$(touch {marker})" -j MY_CHAIN')
rc,out=w.run([C]); check('rule text never executed',not os.path.exists(marker) and '|removed' in out,(out,w.rules()))
# 12 re-check (Step 3): read-only, sees what is left, never takes an unreadable table for gone
CK="chk_chain 'mangle' 'MY_CHAIN' 'iptables'"; BK="chk_boot '/data/local/matchitool/boot.d/20-bypass-ttl.sh'"
w=W(); w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","nat|-N OTHER"); open(w.boot()+'/20-bypass-ttl.sh','w').write('x'); b=w.rules()
rc,out=w.run([CK,BK],v=True); check('re-check: both present','MTCHK|chain|mangle|MY_CHAIN|iptables|present' in out and '20-bypass-ttl.sh|present' in out and w.rules()==b and os.path.exists(w.boot()+'/20-bypass-ttl.sh'),out)
w.v4("mangle|-P POSTROUTING ACCEPT","nat|-N MY_CHAIN"); os.remove(w.boot()+'/20-bypass-ttl.sh')
rc,out=w.run([CK,BK],v=True); check('re-check: other table same name is not it; both absent','iptables|absent' in out and '20-bypass-ttl.sh|absent' in out and out.strip().endswith('MTCHK-END'),out)
w.failS=True; rc,out=w.run([CK],v=True); check('re-check: unreadable table is "error", not absent','|error' in out and '|absent' not in out,out)
w=W(ip6=False); rc,out=w.run(["chk_chain 'mangle' 'A' 'ip6tables'"],v=True); check('re-check: missing tool is notool','|notool' in out,out)
w=W(); os.symlink(w.d+'/nowhere',w.boot()+'/20-bypass-ttl.sh'); rc,out=w.run([BK],v=True); check('re-check: dangling symlink is present','|present' in out,out)
r=subprocess.run(['sh','-n','-c',vrender([CK,BK])],capture_output=True,text=True); check('re-check sh -n parses',r.returncode==0,r.stderr)
# 13 xtables lock (review fix 4): -w 5 is used only where iptables knows it
w=W(); w.wait=True; w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN")
rc,out=w.run([C]); cs=w.calls()
check('-w supported: every call waits for the lock and the chain is removed',cs and all(c.startswith('-w 5 ') for c in cs) and '|removed' in out and w.rules()==["mangle|-P POSTROUTING ACCEPT"],(out,cs))
w=W(); w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN")
rc,out=w.run([C]); cs=w.calls()
check('-w not supported: only the detection call has it, the rest run as before',cs and cs[0].startswith('-w 5 ') and not any(c.startswith('-w') for c in cs[1:]) and '|removed' in out,(out,cs))
w=W(); w.wait=True; w.lock=True; w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN")
rc,out=w.run([C]); check('busy lock + -w supported: still removed',"|removed" in out and w.rules()==["mangle|-P POSTROUTING ACCEPT"],(out,w.rules()))
w=W(); w.lock=True; w.v4("mangle|-P POSTROUTING ACCEPT","mangle|-N MY_CHAIN","mangle|-A POSTROUTING -j MY_CHAIN"); b=w.rules()
rc,out=w.run([C]); rv,outv=w.run([CK],v=True)
check('busy lock, no -w: nothing is changed and the re-check says error, never absent',w.rules()==b and '|error' in outv and '|absent' not in outv,(out,outv,w.rules()))
w=W(); w.wait=True; w.lock=True; w.v4("mangle|-P POSTROUTING ACCEPT"); rc,out=w.run([CK],v=True)
check('re-check waits for the lock when it can',"|absent" in out and all(c.startswith('-w 5 ') for c in w.calls()),(out,w.calls()))
# 14 review fix 3: a command is written to the ledger only AFTER the filter let it through (source order, a tripwire)
for fn,guard,rec in [('WebRoutesRoot.kt','commandBlocked(s, command)','traceCommand(s, command)'),('WebRoutesPlugins.kt','shellDanger(command, true)','traceStore.recordCommand(name, command)')]:
    src=(ROOT/'app/src/main/java/com/matchi/tool'/fn).read_text(); pos=[m.start() for m in re.finditer(re.escape(rec),src)]
    ok=bool(pos) and all(src.rfind(guard,0,p)!=-1 and p-src.rfind(guard,0,p)<900 for p in pos)
    check('ledger written after the filter in '+fn,ok,(fn,pos))
# 11 dash syntax check of the template with busybox-ish strictness
r=subprocess.run(['sh','-n','-c',render([C,B%'20-a.sh'])],capture_output=True,text=True); check('sh -n parses',r.returncode==0,r.stderr)
print('plugin undo shell tests passed (%d checks)' % total if not fails else 'plugin undo shell tests FAILED: %d' % fails); sys.exit(1 if fails else 0)
