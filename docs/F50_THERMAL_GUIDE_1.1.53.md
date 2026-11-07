# ZTE F50 thermal and efficiency notes — MatchiTOOL 1.1.53

## What this update does

MatchiTOOL reduces its own telemetry workload as the F50 warms up. When the router API is unavailable, modem AT reads are cached for 60 seconds. Live Status refreshes every 45 seconds when cool, 90 seconds when warm, and 120 seconds when hot/critical. The dashboard uses battery, modem, and thermal-zone readings to show an advisory status.

These thresholds are conservative UI heuristics, not ZTE factory limits or a calibration of every F50 firmware/thermal sensor. Sensor labels and scaling can differ by firmware. Use the values as trends, not as a guarantee of safe operating temperature.

## Safe ways to keep temperatures lower

- Keep the F50 upright or on a hard, open surface; do not cover vents or place it on fabric.
- Keep it out of direct sunlight and away from other heat sources.
- Avoid prolonged heavy downloads, screen streaming, repeated diagnostics, and multiple simultaneous root tools when the case is already warm.
- If it becomes hot, pause high-load activity and allow it to cool. Avoid charging during heavy use when practical.
- Use a suitable, reputable power adapter and cable; avoid damaged or unusually hot chargers.
- Keep stock thermal services and firmware protections enabled.

## What MatchiTOOL deliberately does not change

This release does not force CPU/GPU governors, lock maximum/minimum frequencies, change voltage, disable thermal throttling, alter battery charging limits, write vendor thermal nodes, or kill system thermal daemons. Such tweaks are firmware-specific and can cause instability, battery wear, or overheating.

## Device verification still needed

After installing, compare temperatures at idle, while charging, and under normal network load. Record the exact sensor labels and readings from Device Status/Live Status, plus firmware build and ambient conditions. If any sensor rises rapidly, the device reports an over-temperature warning, or the case becomes uncomfortable, stop the load and let it cool. Do not use a generic temperature number as a target to force the device to maintain.
