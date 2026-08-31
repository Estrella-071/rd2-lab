# Performance

Random Dice 2 Lab keeps a repeatable Chromium lab budget for the generated
`.pages/` artifact. The gate protects the large SVG tree, initial transfer,
startup and parse work, pan and zoom responsiveness, and static compendium
poster loading.

## Run the profile

```bash
npm run build:pages
npm run check:performance
npm run check:performance:high-refresh
```

`npm run check:performance` runs three cold desktop loads and three
mobile-emulation loads in headless Chromium. Each run uses a fresh browser
context. It records frame timing for diagnostics, but does not enforce the
120Hz frame-drop count because headless and hosted runners do not promise a
120Hz display clock. The command writes its complete inputs, per-run samples,
medians, maxima, and violations to the ignored
`artifacts/performance/pages-budget.json` report.

`npm run check:performance:high-refresh` is the 120Hz interaction gate. It uses
headed Chromium on a high-refresh display and enforces zero sampled intervals
over the configured 10ms threshold for desktop and mobile pan, wheel, pinch,
and filter scenarios. The nominal 8.333ms interval remains in the report for
diagnostics. The stress profile uses the same hard frame gate with CPU
throttling.

Use `npm run measure:performance` to collect the same report without returning
a failure code for threshold violations. Use
`node scripts/measure_pages_performance.mjs --runs=1` only for a quick local
diagnostic; the required gate remains the three-run profile.

## Budget contract

The reviewed thresholds live in
[`performance-budget.json`](performance-budget.json). The current profile
checks:

| area | measurements |
| --- | --- |
| Pages artifact | allowlisted file count, total bytes, SVG bytes, CSS bytes, and the compendium facade size |
| Startup | first contentful paint, load event, 239-node tree readiness, SVG response completion, and initial transfer bytes |
| Main thread | longest task and total blocking time derived from Long Tasks entries |
| Interaction | desktop wheel-zoom, pan, filter, and emulated mobile gestures; every profile records frame intervals, while the high-refresh and stress profiles enforce a zero dropped-frame count against the 120 FPS target |
| Runtime | page errors and failed requests in desktop and mobile runs |

Startup and diagnostic timing values use the median of three runs. Dropped-frame,
context, and error counts use the worst observed value, so one bad run cannot
be hidden by averaging. The frame target is 120 FPS, with a nominal 8.333 ms
interval (1000 / 120). A sampled interval over 10 ms is counted as a dropped
frame observation: this keeps a small 20% allowance for compositor and
timestamp scheduling jitter while still requiring zero observed drops in the
high-refresh hard gate. The nominal 8.333 ms threshold remains available in
every report as a diagnostic. Artifact limits use exact file sizes. CI runs the
headless profile against the same downloaded `.pages/` artifact that the
browser suites validate and the deploy job publishes; its frame counts remain
diagnostic because the hosted display clock is not a 120Hz test fixture.
Shared hosted runners use a 550 ms total-blocking-time ceiling; the local
profile keeps its 450 ms ceiling. Artifact, startup, and runtime limits stay
the same in both profiles.

## Evidence boundary

This is a controlled local-server Chromium regression gate. It models local
responses and browser-based mobile emulation. Production compression, CDN
latency, real network conditions, and physical devices sit outside this
profile. The measurements represent local lab data; Core Web Vitals reporting
requires field telemetry.

Before a performance-sensitive release, record production field data and a
physical-device trace separately when those claims matter. A threshold change
should include the old and new report, the reason for the change, and the
artifact or behavior responsible for the delta.
