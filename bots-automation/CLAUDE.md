# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Orientation map for the project. See **`README.md`** for full user-facing docs and **`docs/KASM.md`** for the KASM/Ubuntu setup.

> **No tests, linter, or build step exist.** It is a plain ESM Node project (`"type": "module"`, Node ≥ 18) — there is nothing to compile; "running" means executing a collection or report script. Do not invent `npm test`/`npm run lint`/`npm run build` commands.

## What this project does

Cross-platform browser-automation harness that measures how automated browsers look to a fingerprinting/risk service. For every **automation tool × browser** combination it:

1. Prepares the environment and (optionally) installs browsers.
2. Launches the browser and navigates to a page hosting an integrated **UDI collector** (`collector-page/`).
3. Waits for the collector to serialize a payload into a textarea (`#textareaPayload`).
4. Appends the payload + metadata as a row to a CSV (`results/payloads.csv`).
5. Optionally POSTs each payload to a **risk service** and renders Markdown/JSON/PDF reports.

Runs on **macOS, Windows, and KASM/Ubuntu (Linux, often containerized)**.

### Automation tools (4)
Playwright, Puppeteer, Selenium, TestCafe — one runner module each in `src/`.

### Browsers
Chrome, Chromium, Firefox, Edge, Brave, WebKit (Playwright/macOS), Safari (native/macOS). The available matrix is **platform-dependent** — see `src/platform.js` / `getPlatformProfile()` and `src/tasks.js`.

### The payload
A flat JSON array of `{ name, data }` entries (or `{ name, error: { message } }` for features that failed; some entries time out). It is a full fingerprint surface: UA + client hints, full `navigator` object, audio/canvas/WebGL fingerprints, fonts, timezone, WebRTC IPs, permissions, ever-cookie (`wdi1`) tokens, and automation tells such as `webDriverEnabled` / `navigator.webdriver`. The textarea value is usually an envelope `{ "headers": {…}, "payload": "<base64 UDI>" }`.

## Key commands (run from this directory)

| Command | What it does |
|---------|--------------|
| `npm run collect` | **Collect only.** Starts local collector server (unless `COLLECTOR_URL` set), runs all stacks, appends to CSV. **Does NOT call the risk service.** |
| `npm run collect:direct` | Same collection but assumes the page is already served (`node src/index.js`, no local server). |
| `npm start` | `collect` then `report` (reports need the risk service online). |
| `npm run report` | Full report chain from the existing CSV: `report:risk` → `report:identifiers` → `report:risk:indicators` → `report:risk:with-isbot-matrix-pdf` → `export:xlsx`. `report:identifiers` and `export:xlsx` are offline; the rest POST to the risk service. |
| `npm run report:risk` / `:identifiers` / `:risk:indicators` | Run a single report. Reads `CSV_INPUT` (defaults to `CSV_PATH`). |
| `npm run export:xlsx` | Bundle the generated reports into an `.xlsx` (offline, `xlsx` dep). |
| `npm run serve:collector` | Serve `collector-page/` for manual testing (no bots). |
| `npm run install:browsers` | Platform-aware Playwright + apt browser install (`:ubuntu` / `:windows` variants for OS browsers). |
| `npm run install:deps` | `npm install` with Puppeteer download skipped + relaxed TLS (corporate proxy). `install:deps:insecure-tls` disables TLS verification entirely — last resort. |

Collection never contacts the risk service; only the `report:*` scripts do. There is **no single-test runner** — the smallest unit of work is one stack via env scoping (e.g. `PUPPETEER_STEALTH=true BOTS_COLLECT_DUAL=false npm run collect:direct`, narrowing browsers by leaving others uninstalled / unset).

## Code map (`src/`)

- **`index.js`** — collection entrypoint; iterates `buildTaskList()`, runs each task, appends rows, logs results.
- **`tasks.js`** — builds the platform-aware tool×browser matrix (`buildTaskList`); `expandDual` handles headless+headed dual runs.
- **`config.js`** — re-exports `env.js`; adds `resolveHeadless()`, `runWithGlobalHeadless()`, `isDualCollectionEnabled()`.
- **`env.js`** — dotenv load + typed getters (`stringEnv`/`numberEnv`/`boolEnv`) + all config constants (`TARGET_URL`, `CSV_PATH`, `PAYLOAD_*`, risk/report paths).
- **`stealth.js`** — stealth-mode helpers (see below).
- **Runners** — `playwrightRunner.js`, `puppeteerRunner.js`, `seleniumRunner.js`, `testcafeRunner.js` (+ `testcafe/collector-test.js`, `testcafeBrowser.js`, `testcafeTimeouts.js`). Each exports `run<Tool><Browser>()` returning a row `{ type, browser, headless, stealth, payload, documentHasFocus, documentVisibility }`.
- **Browser resolution** — `browserBinaries.js`, `chromiumBinary.js`, `firefoxBinary.js`, `browserLaunchArgs.js` (sandbox flags), `platform.js`.
- **`csvStore.js`** — CSV schema, append, and legacy-schema migration.
- **`udiDecompress.js`** — decodes/inflates the UDI payload (uses `pako`); `userAgent.js`, `documentFocus.js`, `waitForPayload.js`, `riskHttpHeaders.js`.
- **`scripts/`** — `run-with-collector.mjs`, `serve-collector.mjs`, report generators (`report-*.mjs`), `isbot-matrix-to-pdf.mjs` (via `md-to-pdf`), `export-reports-to-xlsx.mjs` (via `xlsx`), `isBotStrategies.mjs`, and OS browser installers.

No Cursor/Copilot rules and no `.eslintrc`/test config are present in the repo.

## CSV schema

`results/payloads.csv` columns (in order):

```
type, browser, headless, stealth, payload, documentHasFocus, documentVisibility
```

- `type` = automation tool; `browser` = browser label; `headless`/`stealth` = `true`/`false`.
- `payload` = full textarea JSON.
- `documentHasFocus` / `documentVisibility` derived from the decompressed UDI.
- Legacy CSVs (pre-`stealth`, or `bot` instead of `type`) are auto-migrated on the next append (`migratePayloadsCsvIfNeeded`); old rows get an empty `stealth` cell.

## Stealth mode (feature/DEVP-2649)

Makes each tool report `navigator.webdriver === false` (collector `webDriverEnabled: false`), emulating a fraudster hiding the automation tell. **Off by default; orthogonal to headless/dual.**

- Toggle: `BOTS_STEALTH=true` (global) or per-tool `PUPPETEER_STEALTH` / `PLAYWRIGHT_STEALTH` / `SELENIUM_STEALTH` / `TESTCAFE_STEALTH` (`true`/`1` | `false`/`0`; per-tool wins). Resolved by `resolveStealth()` in `src/stealth.js`, mirroring `resolveHeadless()`.
- Per engine (`src/stealth.js`):
  - **Chromium** (Chrome/Chromium/Edge/Brave): `--disable-blink-features=AutomationControlled` (+ Selenium `excludeSwitches: enable-automation`) + init-script getter override.
  - **Firefox**: pref `dom.webdriver.enabled=false` (Puppeteer `extraPrefsFirefox`, Playwright `firefoxUserPrefs`, Selenium `setPreference`) + init script.
  - **TestCafe**: no WebDriver — override injected via `runner.clientScripts({ content })` (+ Chromium flag in browser string).
  - **WebKit (Playwright)**: init-script override only.
  - **Safari (native, Selenium)**: NOT supported — `safaridriver` exposes no hook.
- Scope is limited to `navigator.webdriver` only; other headless/automation tells are unchanged by design.
- **Known follow-up:** the three report scripts key rows by `type / browser / headless` and do not yet include `stealth`, so stealth vs non-stealth runs of the same tool/browser/headless collide in reports (raw CSV still distinguishes them).

## Important env vars

Collector: `COLLECTOR_URL` (if set, no local server), `COLLECTOR_HOST`/`COLLECTOR_PORT` (default `127.0.0.1:7778`), `COLLECTOR_PAGE_DIR`.
Collection: `PAYLOAD_ELEMENT_ID` (`textareaPayload`), `PAYLOAD_TIMEOUT_MS` (180000), `CSV_PATH` (`results/payloads.csv`).
Mode: `BOTS_COLLECT_DUAL` (dual headless+headed, default on), `BOTS_HEADLESS`, per-tool `*_HEADLESS`, `BOTS_STEALTH` + per-tool `*_STEALTH`.
Platform: `BOTS_PLATFORM` (`auto`/`macos`/`ubuntu`/`kasm`/`linux`/`win32`), `BOTS_IN_CONTAINER`, `BOTS_NO_SANDBOX`, `BOTS_SKIP_OS_BROWSER_INSTALL`, `BOTS_SKIP_SELENIUM_SAFARI`.
Binaries: `CHROME_BIN`, `CHROMIUM_BIN`, `FIREFOX_BIN`, `EDGE_BIN`, `BRAVE_BIN`, `PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH`, `PUPPETEER_EXECUTABLE_PATH`.
Risk/reports: `RISK_SERVICE_URL`, `RISK_REQUEST_IP`, `RISK_HTTP_HEADERS_JSON`, `CSV_INPUT`, `RISK_REPORT_*`, `IDENTIFIERS_*`, `RISK_INDICATORS_*`.

`.env` is loaded from this directory. **Note:** `.env` / `.env.*` files (including `.env.example`) may be unreadable/unwritable by the agent due to sandbox rules — edit them manually.

## Conventions & gotchas

- ESM throughout (`.js`/`.mjs`, `import`); Node 18+.
- Each runner resolves headless/stealth via the env helpers — keep new per-tool options consistent with that pattern.
- Firefox: Playwright needs its **bundled** Firefox (juggler); Puppeteer/Selenium/TestCafe use retail Firefox via `FIREFOX_BIN`.
- Puppeteer headed Firefox on macOS can hang on close (`closeBrowser` force-kills).
- Chromium in Kasm/Docker needs `--no-sandbox` (`browserLaunchArgs.js`).
- Verifying real browser launches usually requires running outside the restricted command sandbox.
