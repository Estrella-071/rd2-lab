# Performance

Random Dice 2 Lab keeps a repeatable Chromium lab budget for the generated
`.pages/` artifact. The gate protects the large SVG tree, initial transfer,
startup and parse work, pan and zoom responsiveness, and static compendium
poster loading.

## Run the profile

```bash
npm run build:pages
npm run check:performance
```

`npm run check:performance` runs three cold desktop loads and three cold
mobile-emulation loads. Each run uses a fresh browser context. The command
writes its complete inputs, per-run samples, medians, maxima, and violations to
the ignored `artifacts/performance/pages-budget.json` report.

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
| Interaction | desktop wheel-zoom frame p95 and touch-style pan frame p95 in a 390 × 844 mobile emulation; delayed-frame counts remain in the report for diagnosis |
| Runtime | page errors and failed requests in desktop and mobile runs |

Timing and frame thresholds use the median of three runs. Context and error
thresholds use the worst observed value. Artifact limits use exact file sizes.
CI runs this profile against the same downloaded `.pages/` artifact that the
browser suites validate and the deploy job publishes. Shared hosted runners use
a 550 ms total-blocking-time ceiling; the local profile keeps its 450 ms
ceiling. Artifact, startup, and runtime limits stay
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
