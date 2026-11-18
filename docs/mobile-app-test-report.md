# Mobile App Test Report

**Date:** 2026-11-18  
**Build:** `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (49.2 MB)  
**Device:** Android emulator `BarkaatiPhone`, Android 15 / API 35, 1080×2400, x86_64  
**Backend:** `http://10.0.2.2:3001` (sync connected)  
**App data size:** 6.2 MB

## Scope

- Smoke-tested **36 screens**: 4 bottom tabs and 32 More-menu screens.
- Functional checks: PIN unlock, sale completion, weight barcode create/delete, manual sync, background/resume.
- Stress run: **360 client-side navigations** over 40 loops of 9 routes, followed by 90 s idle.
- Smoothness run: **90 s continuous navigation**, 1,157 frames rendered.
- Tooling: `adb`, `uiautomator`, `dumpsys`, Chrome DevTools Protocol attached to the Capacitor WebView.

## Functional Results

| Area | Result | Notes |
|---|---|---|
| PIN unlock | Pass | `123456` unlocked to dashboard. |
| Dashboard / Home | Pass | Sales, month totals, outstanding, low stock, products, recent bills, top sellers rendered. |
| Sell / POS | Pass | Product add, cart, checkout, stock decrement, receipt all worked. Test bill `INV-BL-0002` (Rs 160) completed. |
| Weight barcodes | Pass | Created 3 labels (`WT:250`, `WT:500`, `WT:1000`) and deleted them successfully via DOM-level clicks. |
| Sync | Pass | Manual "Sync now" completed; cursor advanced to 1804; `sync_last_error` cleared. |
| Background/resume | Pass | App resumed on `#/products` after HOME + relaunch; state preserved. |
| Transaction regression | Pass | No `cannot start a transaction` or FK constraint errors after the recent fix. |
| Offline mode | Inconclusive | `navigator.onLine` stayed `true` with emulator WiFi disabled, so true offline behavior was not reproducible here. |

All 36 screens opened with visible content and **zero app-specific errors** in logcat.

## Performance Metrics

### Startup

| Metric | Value |
|---|---|
| `am start -W` TotalTime | 2,127 ms |
| Cold start to PIN screen | ~4.5 s |
| PIN entry to dashboard | ~5.4 s |
| Full instrumented cold flow | ~13.4 s |

The PIN/dashboard timings include repeated `uiautomator` dumps used to detect readiness, so they are upper bounds. The native activity start itself is ~2.1 s.

### Navigation Responsiveness (CDP, 360 navigations)

| Metric | Value |
|---|---|
| Average route transition | 19.6 ms |
| p95 route transition | 35 ms |
| Max route transition | 46 ms |
| Failed navigations | 0 |
| CPU during active navigation | ~7.3% of total 4-core capacity (~29% of one core) |

Client-side route changes are fast. The slower values in the earlier `uiautomator`-driven test (2.3–4.3 s) were dominated by accessibility dump overhead, not app rendering.

### Rendering / Smoothness (90 s continuous navigation)

| Metric | Value |
|---|---|
| Frames rendered | 1,157 |
| Median frame time | 16 ms |
| p95 frame time | 34 ms |
| GPU p95 | 16 ms |
| Janky frames (new metric) | 566 / 1,157 (48.9%) |
| Janky frames (legacy metric) | 124 / 1,157 (10.7%) |
| 4950 ms outlier frames | 13 |
| Missed VSync | 13 |
| Slow UI thread | 6 |
| Slow issue draw commands | 539 |

The high "janky frames" percentage is inflated by emulator Goldfish GPU behavior and automation stalls (including 13 extreme ~4950 ms frames). The legacy jank rate (~10.7%) and p95 (~34 ms) are more useful here. Physical-device profiling is recommended before drawing conclusions about real-user smoothness.

### Memory & Resources

| Metric | Baseline | Peak (after 40 loops) | After 90 s idle |
|---|---:|---:|---:|
| App PSS | 131.1 MB | 135.7 MB | 129.8 MB |
| App RSS | 267.1 MB | 271.8 MB | 265.7 MB |
| Native heap | 19.7 MB | 19.9 MB | 19.9 MB |
| JS heap used | 6.8 MB | 11.6 MB | 6.8 MB |
| JS heap total | 16.1 MB | 26.5 MB | 24.5 MB |
| DOM nodes | 1,130 | 12,381 | 381 |
| JS event listeners | 214 | 950 | 161 |

WebView sandboxed-process PSS was observed between **101 MB and 150 MB** across the session, including after sync. App PSS and JS heap returned to baseline after idle, so no obvious memory leak was detected.

### Network, Battery, Storage

- **Sync traffic:** 16 sync HTTP requests during the ~4-minute stress window, all successful.
- **Battery:** emulator reports 0 mAh discharge; not usable for real consumption estimates.
- **Storage:** app data stayed at 6.2 MB; APK 49.2 MB.

## Findings

1. **No stability failures:** no crashes, ANRs, fatal JS errors, or app-specific transaction/FK errors across all tests.
2. **Transaction fix verified:** sale creation succeeds and sync no longer leaves SQLite stuck in an open transaction.
3. **Responsive UI:** route changes average ~20 ms client-side, with p95 35 ms.
4. **Memory is stable:** PSS grew only ~3.6 MB over 360 navigations and returned to baseline after idle.
5. **Smoothness needs device validation:** emulator GPU/automation produced jank outliers that are not representative of production hardware.
6. **Cold start is the weakest metric:** ~2.1 s native activity start plus several seconds to a fully usable dashboard.

## Recommendations

- Re-run GPU profiling and battery measurement on a physical mid/low-end Android device.
- Profile cold startup; defer non-critical dashboard aggregates until after first paint or add a skeleton state.
- Virtualize long lists (Products, Attendance, Reports) if lower-end devices show frame drops.
- Monitor WebView PSS after large sync batches; 150 MB was observed in the emulator.
- Add automated regression coverage for: sale → sync, weight barcode create/delete, and app resume.

## Verdict

**Pass with caveats.** Functional coverage and stability are good, navigation is responsive, and no leak was detected. Smoothness and battery conclusions require a physical-device retest.
