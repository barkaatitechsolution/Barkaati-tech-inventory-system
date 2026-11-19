# Web App Performance & Resource Report

**Date:** 2026-11-19  
**Build:** production web client in `client/dist`, served through a local preview proxy on `http://127.0.0.1:4174/`  
**API:** `node index.js` on `http://127.0.0.1:3001/`  
**Browser:** headless Chrome 157 via Chrome DevTools Protocol, cache disabled, 1440×900 window flag with 800×600 screen override (observed viewport height 608 px)  
**Data set:** 271 products, 11 customers, 6 suppliers, 2 low-stock items, 40 sidebar sections  
**Store:** Royal Spicy Masala  
**Scope:** web app only; mobile app and online store were excluded as requested.

## Scope & Method

- Cold-loaded the production build and captured Navigation Timing, Paint Timing, Long Tasks, Cumulative Layout Shift, resource timing, and JS heap.
- Opened all 40 sidebar sections and verified each navigation landed on the expected heading.
- Measured route switching with `performance.now()` and history-state detection, followed by a short settle window for API/DOM work.
- Exercised the sidebar section filter, the Sales “New Sale” modal, and the Settings sync-conflict view.
- Stress-tested 48 rapid route transitions, then let the app idle for 5 seconds and compared heap, DOM nodes, long tasks, and renderer CPU.
- Sampled a 151-frame `requestAnimationFrame` scroll on Product DB.
- Captured all network requests through the full run and sampled OS-level process RSS/CPU.
- Browser console/page exceptions were captured throughout the run.

## Functional Results

| Check | Result | Notes |
|---|---|---|
| Cold production load | Pass | FCP 72 ms, LCP 196 ms, CLS 0, no long tasks. |
| All 40 sidebar sections | Pass | 40/40 navigations landed on the expected page; every section rendered a heading and visible content. |
| Sidebar section filter | Pass | Typing `sales` reduced 40 items to 11 in 23.7 ms; clearing restored all 40. |
| Sales modal | Pass | “New Sale” opened in 34 ms; close button removed the dialog cleanly. |
| Settings conflicts | Pass | Shows `Sync conflicts — 0 open` and `No open conflicts.` |
| Scroll | Pass | 60 FPS average on Product DB with 0 frames over 32 ms. |
| Stability | Pass | 0 browser console errors, page exceptions, crashes, or failed navigations. |

## Performance Metrics

### Cold Load

| Metric | Value |
|---|---:|
| TTFB | 2.5 ms |
| Response end | 2.8 ms |
| DOMContentLoaded | 29.2 ms |
| Load | 29.3 ms |
| First Contentful Paint | 72 ms |
| Largest Contentful Paint | 196 ms |
| Cumulative Layout Shift | 0 |
| Long tasks | 0 (0 ms total) |
| Initial DOM nodes | 996 |
| JS heap after load | 24.7 MB used / 31.0 MB total |
| Renderer CPU during load | 63.6% of one core |
| Scripted cold-load window | 2,626 ms including instrumentation/settle waits |

Cold load transferred **1,300.8 KB** across **46 resources**:

| Type | Requests | Transfer | Notes |
|---|---:|---:|---|
| Script | 39 | 873.3 KB | Main bundle plus preloaded/lazy chunks. |
| CSS/link | 2 | 123.7 KB | 76.3 KB CSS plus preload/link resources. |
| API/fetch | 4 | 185.4 KB | `store-info`, `reminders`, `dashboard`, monthly `stats`. |
| Other | 1 | 138.9 KB | Document/other local resource. |

Cold API calls:

| Endpoint | Duration | Payload |
|---|---:|---:|
| `GET /api/store-info` | 103 ms | 186,590 B |
| `GET /api/reminders` | 92 ms | 981 B |
| `GET /api/dashboard` | 103 ms | 1,355 B |
| `GET /api/stats?from=2026-11-01&to=2026-11-19` | 106 ms | 823 B |

`store-info` is the largest cold API response at ~182 KB and accounts for most of the cold API transfer. It is returned on every fresh load, so memoizing/cache-revalidating it is the clearest payload optimization.

### Navigation Responsiveness

| Metric | Value |
|---|---:|
| Sections opened | 40 |
| Successful navigations | 40/40 |
| Average switch time | 1.6 ms |
| Median switch time | 2 ms |
| p95 switch time | 2 ms |
| Max switch time | 2 ms |
| API calls observed during route settle windows | 47 |

The switch timer stops when the SPA history state changes; the separate settle window allowed lazy chunks and route data to render. This is why the reported switch times are lower than full route-ready time. No section produced a blank screen; the smallest rendered section still had 134 characters of visible text.

Largest DOM footprints after route render:

| Route | DOM nodes | Switch time |
|---|---:|---:|
| Product DB | 2,316 | 1 ms |
| Customers | 1,761 | 2 ms |
| Prices | 1,661 | 1 ms |
| Supplier Purchased | 1,597 | 1 ms |
| Inventory Packs | 1,388 | 2 ms |
| Stock Levels | 1,126 | 2 ms |
| Sales | 1,116 | 2 ms |
| Settings | 1,112 | 2 ms |

Product DB remains the heaviest screen, but its 2,316 nodes are far below the mobile WebView’s 6,446 nodes for the same dataset because the web build renders a smaller page slice and avoids the mobile-only wrapper tree.

### Smoothness

Product DB 151-frame scroll sample:

| Metric | Value |
|---|---:|
| Average FPS | 60.0 |
| p50 frame time | 17 ms |
| p95 frame time | 17 ms |
| Max frame time | 21 ms |
| Frames over 32 ms | 0 |
| Scroll height / viewport height | 1,764 px / 608 px |

### Stress & Memory

48 rapid transitions across the first 12 sections, repeated 4 times:

| Metric | Before | Immediately after | After 5 s idle |
|---|---:|---:|---:|
| JS heap used | 23.99 MB | 27.48 MB | 18.60 MB |
| DOM nodes | 7,056 | 17,472 | 19,192 |
| Added long tasks | — | 0 | 0 |
| Renderer CPU | — | 70.5% of one core | — |

There is no sustained JS heap growth: the value after idle is lower than the starting heap. The DOM node count depends on the final rendered page and is not by itself a leak signal, but the peak of 17,472 nodes during rapid navigation confirms that long-list routes can momentarily inflate layout work.

### Network Over Full Run

| Metric | Value |
|---|---:|
| Total requests | 171 |
| JS requests | 93 |
| JS transfer | 1,582.3 KB |
| CSS requests | 1 |
| CSS transfer | 76.3 KB |
| API requests | 69 |
| API transfer | 279.1 KB |

Slowest resources over the full run:

| Resource | Duration | Transfer |
|---|---:|---:|
| `stats?from=2026-11-01&to=2026-11-19` | 107 ms | 1 KB |
| `store-info` | 106 ms | 182 KB |
| `dashboard` | 100 ms | 1 KB |
| `reminders` | 95 ms | 1 KB |
| `receipt-indian-rupee-*.js` | 62 ms | 1 KB |
| `CompletedBills-*.js` | 60 ms | 7 KB |
| `mail-*.js` | 60 ms | 1 KB |
| `Customers-*.js` | 57 ms | 23 KB |
| `phone-*.js` | 56 ms | 1 KB |
| `Products-*.js` | 52 ms | 28 KB |

All API responses except `store-info` are tiny. The slowest resources are local and remain under ~110 ms; no network request failed.

### Process Resources

Sample taken after the full test run:

| Process | RSS | CPU |
|---|---:|---:|
| Chrome renderer processes (summed) | 864.8 MB | 16.4% |
| API server (`node index.js`) | 109.7 MB | 0.1% |
| Vite dev server (not used for production preview) | 162.6 MB | 0.3% |

The renderer figure is the sum of all Chrome renderer processes in the isolated browser profile, not the RSS of a single tab. It is useful for spotting gross regressions but should not be read as the memory cost of one web app page.

## Findings

1. **Cold load is fast.** TTFB 2.5 ms, FCP 72 ms, LCP 196 ms, CLS 0, and no long tasks on local infrastructure.
2. **Navigation is effectively instant.** 40/40 sections switched in 0–2 ms, with a 2 ms median.
3. **Scrolling is smooth.** Product DB held 60 FPS with zero frames over 32 ms.
4. **No stability issues.** No console errors, page exceptions, failed routes, or dialog leaks across the route sweep, interactions, and stress run.
5. **Memory is stable.** JS heap fell from 23.99 MB to 18.60 MB after the 48-transition stress plus idle; no long tasks were added.
6. **Cold JS is the largest payload.** 39 script requests / 873 KB on first load and 93 script requests / 1.58 MB over the full run. Code splitting is in place, but the initial script set is still the main transfer cost.
7. **`store-info` is the largest API payload.** 182 KB on cold load and ~106 ms locally; it is the first API response to cache or trim.
8. **Long lists drive DOM size.** Product DB, Customers, Prices, and Supplier Purchased peak at 1.6k–2.3k nodes. They still perform well here but are the first candidates for windowing if the data grows.
9. **Renderer CPU peaks during rapid navigation.** ~70% of one core during the 48-transition burst, dropping to ~16% at sample time; no long tasks were recorded.
10. **Sync-conflict cleanup is verified in the UI.** Settings reports `0 open` and `No open conflicts.`

## Recommendations

- Cache or revalidate `/api/store-info`; avoid shipping the full store logo/settings blob on every cold load when unchanged.
- Review the initial lazy-chunk graph: 39 script requests on first load is acceptable locally but can be costly over higher-latency links. Consider preloading only the dashboard-critical chunks and deferring the rest.
- Add windowing/virtualization to Product DB, Customers, Prices, and Supplier Purchased if row counts grow beyond a few hundred, or if testing moves to low-end hardware.
- Keep the current 200 ms debounce on search/filter inputs; the sidebar filter responded in ~24 ms with React’s event path.
- Re-run the same harness against a throttled network (Fast 3G) and CPU (4× slowdown) before treating these local loopback numbers as real-user budgets.
- Continue monitoring JS heap after large data imports/syncs; this run used the existing local dataset and found no leak.

## Limitations

- All measurements were taken on localhost with headless Chrome; real network latency, disk speed, and GPU behavior were not included.
- Chrome renderer RSS is summed across all renderer processes in the isolated profile.
- `performance.memory` is Chrome-specific and coarse; OS RSS is the more reliable resource signal.
- The mobile app and storefront were explicitly out of scope for this report.
