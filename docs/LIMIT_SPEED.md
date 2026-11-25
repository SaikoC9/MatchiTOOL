# Limit speed

Status: host side written (Step 3), not compiled or run on a device yet. The web
page is not built. The model below was tested by hand on one ZTE F50 (kernel
5.4.254, `tc` iproute2-ss171113).

Limit speed caps the download and upload rate of one device on the hotspot or
USB tether. It runs on the phone with root, using `tc`. The F50 stock firmware
has no per-device limit, so there is no router call to use.

## How to use

1. Open Network > Devices.
2. Tap **Limit speed** on a device row.
3. Enter Download and Upload in KB/s. Leave a field empty for Unlimited.
4. Tap **Apply** and confirm. Applying needs a fresh root sign-in.

The row then shows the active limit. Set both fields empty to remove it.

## Interfaces

| Interface | Role | Used for |
|---|---|---|
| `br0` | LAN bridge, 192.168.0.1/24 | Download (egress) |
| `wlan0` | Wi-Fi hotspot, bridge member | Upload (ingress) |
| `usb0` | USB tether, bridge member | Upload (ingress) |

The `br0` ingress uses `clsact` and rejects the upload filter on this kernel.
That is why upload is limited on `wlan0` and `usb0` instead. No `ifb` device is
used. The `ifb` module is not loaded on the F50.

## Model

Each device is keyed by its IPv4 address. `tc` cannot match a MAC address well,
so the app maps MAC to the current IP from the device list. `N` is the limit in
KB/s and `O` is the last byte of the IP.

Download, on `br0` egress:

```
tc qdisc replace dev br0 root handle 1: htb default 10
tc class add dev br0 parent 1: classid 1:10 htb rate 1gbit
tc class add dev br0 parent 1: classid 1:<0x100+O hex> htb rate <N>kbps ceil <N>kbps
tc filter add dev br0 parent 1: protocol ip prio <1000+O> u32 match ip dst <ip>/32 flowid 1:<same minor>
```

Upload, on each of `wlan0` and `usb0`:

```
tc filter add dev <if> parent ffff: protocol ip prio <1000+O> u32 match ip src <ip>/32 action police rate <N>kbps burst 20k drop
```

Class `1:10` is the unlimited default class. It is created once.

## Names and removal

The app owns only these values:

- Filter priorities 1000 to 1255.
- Classes `1:101` to `1:1ff`.

**Never use priority 1.** On `wlan0` and `usb0` ingress the system installs a
BPF filter (`ttl_bpf`, pref 1) for hotspot TTL handling. Do not delete it, do
not flush the ingress qdisc, and do not run `tc filter del` without a priority.

To remove a limit, delete that device's own priority on `br0`, `wlan0` and
`usb0`, then delete its class. Unlimited does exactly this.

Before the first `tc qdisc replace` on `br0`, the app reads the current root
qdisc. If it is not `noqueue` and not the app's own `htb`, the app stops and
reports it. It does not overwrite another tool's setup.

## Persistence

Rules are lost on a reboot and when the hotspot or USB tether restarts. Limits
are stored per MAC in the app settings, with the address each was last applied
to.

While at least one limit is saved, a loop in the host looks every 30 seconds
with one short root read and puts back what is missing. With no saved limit it
does not run and asks for no root.

- **Reboot:** the loop starts with the host. It waits until `br0` is up.
- **Device not listed yet:** the limit is applied at its last address. If
  another device already has that address, nothing is applied there.
- **Device moved to a new address:** the new address gets the limit and the
  old one is cleared.
- **Opening the Devices tab:** it reads the same state and shows whether each
  limit is really on the phone.

## What was tested

On one F50, client 192.168.0.167 on Wi-Fi, 1 Mbit cap:

- Download: HTB on `br0` held the client near 0.8 Mbit/s. The class counters
  showed overlimits.
- Upload: police on `wlan0` ingress held the client near 0.86 Mbit/s and
  dropped 277 packets. `usb0` counted 0 bytes because the client was on Wi-Fi.
- Modem offload did not bypass `tc` for forwarded hotspot traffic.
- A filter at priority 1000 stayed on `wlan0` after a hotspot toggle. It is not
  proven that the toggle recreated the qdisc, so the app does not rely on it.

Not tested yet: a USB tether client, a reboot, two limited devices at once.

## Routes

| Route | Gate | Does |
|---|---|---|
| `GET /api/net/limits` | fresh sign-in | Puts back missing rules, returns the saved limits and whether each is active |
| `POST /api/net/limit` | fresh sign-in | Body `mac`, `down`, `up` (KB/s, empty = Unlimited). Sets or clears one device |

The address is taken from the phone's neighbour table, not from the request. A
set call reads the result back and removes the rule again if it does not match.

## What is not covered

- **IPv6** is limited too, matched on the device's MAC because its global addresses rotate: filter priority 1300 + O
  (`protocol ipv6`). Download: destination MAC at offset -14 on `br0` egress, written as three `match u16` (at -14, -12, -10).
  Upload: source MAC at -8 / -4 on `wlan0` / `usb0` ingress. Same class (download) and same rate (upload, its own police bucket).
  **Why three u16:** this `tc` (iproute2 171113) refuses `match u32` at an offset that is not a multiple of 4 (`Illegal "match"`).
  The first version used `match u32 ... at -14`, which was silently refused, so IPv6 traffic was never limited and speed tests that
  use IPv6 ran several Mbit/s over the cap. The IPv6 rules are no longer silent: a refusal is reported (MATCHI_V6 and tc's message),
  they are read back (`tc filter show dev br0 parent 1:` and the ingress filters), and a limit counts as active only when they are
  present. If the kernel still refuses them, the set call removes the limit again and says why, instead of leaving a leaky one.
- **A device that changes IP.** The limit follows only after the next refresh.
- **Other firmware.** Another build may have different interfaces or an
  `ifb`-less kernel. Check with the read-only commands in
  [`F50_CHECKLIST_NETWORK.md`](F50_CHECKLIST_NETWORK.md) once the entry exists.
- **The console device.** Limiting the device that runs the console slows the
  console too. The dialog warns about it.
