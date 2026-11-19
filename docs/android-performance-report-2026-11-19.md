# Android App Performance & Stability Report

**Date:** 2026-11-19  
**Build:** `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (49,236,263 bytes / 47 MiB, built 19/11 11:10)  
**App:** Barkaati Inventory (`com.barkaati.inventory`), version 1.0, fully offline mode (sync not paired)  
**Emulator:** `sdk_gphone64_x86_64` / AVD `BarkaatiPhone`, Android 15 (API 35), x86_64, 4 cores, 1080×2400 @ 420 dpi  
**Data set:** 245 products, 56 bills, 11 customers, 37 More-menu links  
**PIN used:** `123456`

## Scope & Method

- Unlocked with PIN `123456`, opened **all 37 app routes** and all 37 More-menu entries.
- Measured a 90-frame (`requestAnimationFrame`) scroll on every route, plus a controlled 415-frame `gfxinfo` run on the heaviest screens.
- Measured navigation/tap latency in-page via `performance.now()` + DOM mutation detection (Chrome DevTools Protocol attached to the Capacitor WebView).
- Sampled `dumpsys meminfo`, `dumpsys cpuinfo`, `top`, `dumpsys gfxinfo framestats`, `dumpsys batterystats`, `dumpsys netstats`, logcat, and CDP `Performance.getMetrics`.
- Stress: 4 × 12 rapid route changes (48 transitions in 6.3 s), then 3 s idle; separate 5 s rapid-navigation CPU burst.
- Functional smoke: bottom-nav taps, product search, lock → unlock, web-network request capture.

## Functional Results

| Check | Result | Notes |
|---|---|---|
| PIN unlock | Pass | `123456` opens dashboard; ~761 ms including 120 ms synthetic key pacing. |
| All 37 routes | Pass | Every route rendered visible content; no blank screens. |
| Bottom navigation | Pass | Sell, Products, Sales, More, Home — 7/7 taps landed on the expected route. |
| More menu | Pass | All 37 links present and reachable. |
| Product search | Pass | Typing a filter re-rendered 245-item list in ~357 ms. |
| Lock / unlock | Pass | `Lock app` → PIN screen → dashboard works. |
| Stability | Pass | No crashes, ANRs, fatal JS exceptions, or app-specific errors in logcat. |
| Web network | Pass | 0 WebView network requests during the sweep (offline behaviour as designed). |

## Performance Metrics

### Startup

| Metric | Value |
|---|---|
| `am start -W` TotalTime (cold) | 2,194 ms |
| `ActivityTaskManager: Displayed` (cold) | +2,194 ms |
| PIN screen visible after cold start | Immediate once WebView is attached (34 ms in CDP poll) |
| PIN entry → dashboard | 761 ms (20 ms key pacing; ~640 ms excluding pacing) |
| Warm resume | Intent delivered to running top instance; effectively instant |

### Navigation Responsiveness

| Metric | Value |
|---|---|
| 36-route sweep, average / median / p95 / max | 37.3 / 28 / 81 / 132 ms |
| Precise repeat transitions, average / p95 / max | 41.1 / 52 / 60 ms |
| Bottom-nav tap → rendered content, average / max | 36.3 / 59 ms |
| Failed navigations | 0 |

The first measured `/` transition showed 6,006 ms because the app was already on `/` (no text change to detect); it is an automation artifact, not a navigation cost.

### Smoothness

Per-route 90-frame scroll sampling:

| Metric | Value |
|---|---|
| Average measured FPS | 60.0 (min 58.7 on `/pos`, 59.3 on `/more`) |
| Average / p95 frame time | 16.7 / 16.8 ms |
| Long frames (>32 ms) | 1 across all 37 screens |
| Heaviest screen | `/products` — 245 items, 26,708 px scroll height, 6,446 DOM nodes |

Controlled `gfxinfo` run (415 frames after reset):

| Metric | Value |
|---|---|
| Median / p90 / p95 / p99 frame time | 17 / 28 / 30 / 36 ms |
| GPU p50 / p95 | 14 / 21 ms |
| Janky frames (new metric) | 31 / 415 (7.47%) |
| Janky frames (legacy metric) | 181 / 415 (43.61%) |
| Missed VSync | 1 |
| Slow UI thread | 0 |
| Slow issue draw commands | 31 (7.5% of frames) |
| 4,950 ms GPU outlier frames | 5 (emulator artifact) |

### CPU, Memory & Resources

| Metric | Idle | During/after stress |
|---|---:|---:|
| App PSS | 120.5 MB | 130.8 MB peak / 129.4 MB after idle |
| App RSS | 250.8 MB | 261.9 MB / 260.4 MB |
| Native heap | 18.7 MB | 19.2 MB |
| Dalvik/Java heap | 14.2 MB | 17.5 MB / 16.5 MB |
| CDP JS heap used | ~4–10 MB (coarse granularity) | no sustained growth |
| WebViews | 1 | 1 |
| CPU (top, app) | ~0% | ~73% of one core during rapid navigation |
| CPU (dumpsys, 5-min window) | App below 0.1% | — |

| Other | Value |
|---|---|
| APK size | 47 MiB |
| App data storage | Not readable via `adb shell` on this non-root image |
| Battery | Emulator reports no discharge; not usable for consumption estimates |
| Idle SQLite activity | 0 calls in a 10 s idle sample; 30 s auto-sync timer when unpaired does 9 metadata reads |

## Findings

1. **No stability failures.** No crashes, ANRs, fatal JS errors, or transaction/FK errors across the full sweep and stress run.
2. **Navigation is fast.** ~28 ms median route change and ~36 ms average tap-to-render; no perceptible lag on the emulator.
3. **Scrolling is smooth.** 60 FPS average with only one >32 ms frame across 37 screens; `gfxinfo` shows 0 slow UI-thread frames.
4. **Products is the hotspot.** 245 products produce 6,446 DOM nodes and a 26.7k-px list; filtering takes ~357 ms to re-render. It still scrolls at 60 FPS here, but this is the first screen to optimize for low-end devices.
5. **Memory is stable.** PSS rose ~10 MB under a 48-transition burst and settled at 129 MB; no leak signal, WebView count stayed at 1.
6. **Draw-command jank exists.** 31/415 frames (7.5%) were slow draw commands and GPU p95 was 21 ms. Likely inflated by the emulator's Goldfish GPU, but worth re-checking on hardware.
7. **Benign SQLCipher log error (fixed).** Re-unlocking logged `SetEncryptionSecret: a passphrase has already been set`. `openDatabase()` now checks the plugin's stored secret before setting it and resets its in-memory flag on `Forgot PIN`; fresh setup, cold unlock, and lock/unlock produced zero SQLCipher/plugin errors.
8. **Cleartext flag mismatch (fixed).** `usesCleartextTraffic="true"` is intentional for local `http://` sync; `BUILD.md` now documents it and the merged `INTERNET` permission.
9. **Header overlapped status bar (fixed).** Startup disables WebView overlay and applies the measured inset when Android 15 keeps edge-to-edge. Verified `overlays: false`, `--status-bar-inset: 0px`, header top 32–34 px on main screens and 225 px on the auth screen.
10. **Cold start ~2.2 s + ~0.6–1.5 s unlock.** Acceptable; dashboard aggregates and DB init are the likely costs.

## Recommendations

- Re-run GPU jank and battery profiling on a physical mid/low-end device before treating the 7.5% draw-jank figure as real-user behaviour.
- Window/virtualize the Products list (and other long lists) to cut 6.4k DOM nodes; memoize row components and debounce search input.
- Guard `setEncryptionSecret` so re-unlock does not emit an error (done).
- Document `usesCleartextTraffic="true"` as intentional for local HTTP sync (done).
- Avoid the 9 metadata SQL reads per 30 s auto-sync tick when no server is paired; exit early if `sync_server_url`/`sync_token` are empty.
- Keep an eye on WebView PSS (~120–130 MB here) when large sync snapshots are applied.

## Fix Verification

- Rebuilt with JDK 21: `vite build`, `npx cap sync android`, and `./gradlew assembleDebug` all succeeded.
- Fresh setup with PIN `123456`, cold unlock at 543 ms, and lock/unlock at 501 ms all passed.
- `StatusBar.getInfo()` reported `overlays: false` and `height: 24`; no header overlapped the notification bar.
- Logcat showed 0 SQLCipher/plugin errors and no FATAL EXCEPTION or ANR.

## Verdict

**Pass.** Functional coverage is complete, navigation and scrolling are responsive, memory is stable, and no crashes or ANRs occurred. The remaining caveats are emulator-inflated draw jank and a heavy Products list.
