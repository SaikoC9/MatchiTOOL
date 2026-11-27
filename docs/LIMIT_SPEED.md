# Limit speed

Status: host side written. The web page is not built. Not verified on a real F50.

Caps download and upload for one device on the hotspot or USB tether, on the phone with root, using `tc`. The F50 firmware has no per-device limit, so no router call exists.

## Use

1. Network > Devices.
2. Tap **Limit speed** on a device row.
3. Enter Download and Upload in KB/s. Empty = Unlimited.
4. Tap **Apply** and confirm (needs a fresh root sign-in).

The row shows the active limit. Clear both fields to remove it.

## Interfaces

| Interface | Role | Used for |
|---|---|---|
| `br0` | LAN bridge 192.168.0.1/24 | Download (egress) |
| `wlan0` | Wi-Fi hotspot, bridge member | Upload (ingress) |
| `usb0` | USB tether, bridge member | Upload (ingress) |

`br0` ingress uses `clsact` and rejects the upload filter on this kernel, so upload is limited on `wlan0` and `usb0`. No `ifb`: the module is not loaded on the F50.

## Model

Devices are keyed by IPv4. The app maps MAC to the current IP from the device list. `N` = limit KB/s, `O` = last byte of the IP.

Download (`br0` egress):

```
tc qdisc replace dev br0 root handle 1: htb default 10
tc class add dev br0 parent 1: classid 1:10 htb rate 1gbit
tc class add dev br0 parent 1: classid 1:<0x100+O hex> htb rate <N>kbps ceil <N>kbps
tc filter add dev br0 parent 1: protocol ip prio <1000+O> u32 match ip dst <ip>/32 flowid 1:<same minor>
```

Upload (each of `wlan0`, `usb0`):

```
tc filter add dev <if> parent ffff: protocol ip prio <1000+O> u32 match ip src <ip>/32 action police rate <N>kbps burst 20k drop
```

Class `1:10` is the unlimited default, created once.

## Names and removal

The app owns only filter priorities 1000-1255 and classes `1:101`-`1:1ff`.

**Never use priority 1.** On `wlan0` and `usb0` ingress the system has a BPF filter (`ttl_bpf`, pref 1) for hotspot TTL. Do not delete it, do not flush the ingress qdisc, do not run `tc filter del` without a priority.

To remove a limit, delete that device's priority on `br0`, `wlan0`, `usb0`, then its class. Unlimited does exactly this.

Before the first `tc qdisc replace` on `br0`, the app reads the root qdisc. If it is not `noqueue` and not the app's own `htb`, it stops and reports. It never overwrites another tool's setup.

## Persistence

Rules are lost on reboot and when the hotspot or tether restarts. Limits are saved per MAC with the last-used address.

While a limit is saved, a loop checks every 30 s with one short root read and restores what is missing. With no saved limit it does not run.

- Reboot: the loop starts with the host and waits for `br0`.
- Device not listed yet: applied at its last address, unless another device has it.
- Device moved to a new address: new address gets the limit, old one is cleared.
- Opening Devices: reads state and shows whether each limit is really active.

## Routes

| Route | Gate | Does |
|---|---|---|
| `GET /api/net/limits` | fresh sign-in | Restores missing rules; returns saved limits and whether each is active |
| `POST /api/net/limit` | fresh sign-in | Body `mac`, `down`, `up` (KB/s, empty = Unlimited). Sets or clears one device |

The address comes from the phone's neighbour table, not the request. A set call reads the result back and removes the rule if it does not match.

## Not covered

- **IPv6** is limited too, matched on MAC (global addresses rotate): priority 1300+O, `protocol ipv6`. Download: destination MAC at offset -14 on `br0` egress as three `match u16` (-14, -12, -10). Upload: source MAC at -8 / -4 on `wlan0` / `usb0` ingress.
  Why three `u16`: this `tc` (iproute2 171113) refuses `match u32` at a non-multiple-of-4 offset. The first version used `u32 ... at -14`, silently refused, so IPv6 traffic was unlimited and IPv6 speed tests ran several Mbit/s over the cap. Now a refusal is reported (MATCHI_V6 plus tc's message), rules are read back, and a limit counts as active only when they are present. If the kernel still refuses, the set call removes the limit and says why.
- **Device that changes IP:** the limit follows after the next refresh.
- **Other firmware:** interfaces or kernel (`ifb`) may differ. Check `tc` and interfaces first.
- **The console device:** limiting it slows the console. The dialog warns.
