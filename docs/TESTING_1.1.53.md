# MatchiTOOL 1.1.53 — ZTE F50 thermal/efficiency test

1. Build and install using the same signing key as the installed MatchiTOOL.
2. Confirm the home page, plugins, root terminal, Bypass TTL, USB controls, and router API still work.
3. Open Live Status and verify battery, system-max, and modem temperatures are shown with plausible units.
4. Leave Live Status open for at least 3 minutes while cool; confirm readings refresh without repeated fast root-shell activity.
5. If temperatures rise, verify the UI shows Warm/Hot/Critical and refresh cadence backs off (45/90/120 seconds).
6. Hide the page or open another tool; confirm Live Status pauses its collection while not visible.
7. Test router API unavailable fallback; verify AT readings do not refresh more than once per 60 seconds and telephony dump remains cached for 2 minutes.
8. Confirm no CPU governor, frequency, voltage, charging limit, thermal daemon, or vendor thermal-node settings were changed.
9. Compare idle/normal-load/charging temperatures against stock behavior under similar room temperature and network conditions.

Do not run sustained stress tests on a hotspot. Stop if the F50 reports a thermal warning or becomes unusually hot. This source-level test plan is not a substitute for physical-device validation.
