# bots-automation

Multi-stack browser automation against an **UDI collector** page: waits for a serialized payload, appends rows to CSV, and optionally generates **risk service** reports (Markdown / JSON / PDF).

Configuration is loaded from **`.env`** in this directory (see **`.env.example`**). Copy once:

```bash
cp .env.example .env
```

All defaults match prior behaviour if `.env` is missing empty keys—variables are optional unless you need overrides.

## Prerequisites

- Node.js 18+
- **Browsers:** `npm run install:browsers` (platform-aware; see below)
- **macOS:** Safari stacks need `sudo safaridriver --enable` once
- **Ubuntu / Kasm:** Chrome, Chromium, Firefox, Brave, and optionally Edge via apt; Playwright bundles Chromium/Firefox
- **Windows:** Chrome, Edge, Firefox, Brave — all four tools, headless + headed (no Chromium / WebKit / Safari rows)

## Platform (macOS vs Ubuntu / Kasm vs Windows)

Set in **`.env`** or the environment:

| Variable | Values | Purpose |
|----------|--------|---------|
| `BOTS_PLATFORM` | `auto` (default), `macos`, `ubuntu`, `kasm`, `linux`, `win32`, `windows` | Which browser matrix to run |
| `BOTS_IN_CONTAINER` | `1` | Treat as Docker/Kasm (implies `--no-sandbox` for Chromium) |
| `BOTS_NO_SANDBOX` | `1` / `0` | Force or disable Chromium sandbox flags |
| `BOTS_SKIP_OS_BROWSER_INSTALL` | `1` | Skip apt browser install during `install:browsers` |

**Auto detection:** `darwin` → macOS (Chrome, Chromium, Firefox, WebKit, Safari, Edge). Linux with Ubuntu/Kasm in `/etc/os-release` → Ubuntu profile (Chrome, Chromium, Firefox, Edge, Brave). `win32` → Windows profile (Chrome, Edge, Firefox, Brave).

**Kasm example (`.env`):**

```env
BOTS_PLATFORM=ubuntu
BOTS_IN_CONTAINER=1
BOTS_HEADLESS=true
BOTS_COLLECT_DUAL=false
```

**Windows example (`.env`):**

```env
BOTS_PLATFORM=win32
BOTS_COLLECT_DUAL=true
PUPPETEER_SKIP_DOWNLOAD=1
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

Then:

```powershell
npm install
npm run install:browsers
.\run-windows.ps1
```

Or set `BOTS_PLATFORM=auto` on Windows (detects `win32` automatically).

## Install

```bash
cd bots-automation
npm install
npm run install:browsers
```

On **Ubuntu/Kasm**, `install:browsers` runs `scripts/install-os-browsers-ubuntu.sh` (apt: Chrome, Chromium, Firefox, Brave, Edge) and `playwright install chromium firefox` plus Linux deps. On **macOS**, Playwright **chromium, firefox, webkit** (no Brave in matrix). On **Windows**, `install-os-browsers-windows.ps1` (winget: Chrome, Edge, Firefox, Brave) plus Playwright **chromium, firefox** — **Playwright + Firefox** uses the Playwright bundle under `%LOCALAPPDATA%\ms-playwright`, not retail `firefox.exe`; Puppeteer / Selenium / TestCafe use `FIREFOX_BIN`. **Brave** is Chromium-based (all four tools use `BRAVE_BIN` / system path).

**Kasm one-shot setup** (clone monorepo, apt browsers, npm, git credentials for test env):

```bash
bash setup-kasm-ubuntu.sh
cd ~/Documents/git/udi-payload-collection-automation/bots-automation
cp .env.example .env
./run-kasm.sh
```

**Push to GitHub** (`develop` on `boevboyan85-spec/udi-payload-collection-automation`):

```bash
npm run push:github
# or: bash scripts/push-to-github.sh "your commit message"
```

Git credentials match **`udi-payload-harvest`**: embedded PAT in `setup-kasm-ubuntu.sh`, persisted to `~/.config/bots-automation/git-push.env`.

### Corporate TLS / Puppeteer Chrome download

If `npm install` fails on Puppeteer with certificate errors, use `install:deps` and set **`PUPPETEER_EXECUTABLE_PATH`** to a local Chrome binary, then `npm run install:browsers`. See inline comments in `.env.example` and prior troubleshooting below if needed.

```bash
npm run install:deps
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run install:browsers
```

**Last resort** (weakens TLS—only if IT allows): `npm run install:deps:insecure-tls`

## npm scripts

All scripts are defined in **`package.json`**. Run them from the **`bots-automation`** directory (same folder as `package.json`). Configuration comes from **`.env`** (see **`.env.example`**) and **`src/env.js`**.

### Collection (payload → CSV)

| Script | Command | What it does |
|--------|---------|----------------|
| **`collect`** | `node scripts/run-with-collector.mjs` | If **`COLLECTOR_URL`** is not set, starts the local static server for **`COLLECTOR_PAGE_DIR`**, then runs **`src/index.js`** (all automation stacks) and appends to **`CSV_PATH`**. If **`COLLECTOR_URL`** is set, only runs the stacks—no local server. |
| **`collect:direct`** | `node src/index.js` | Same collection as **`collect`**, but does **not** start the local collector. Use when the page is already available at **`COLLECTOR_URL`** or the default `http://COLLECTOR_HOST:COLLECTOR_PORT/`. |
| **`start`** | `npm run collect && npm run report` | Runs **`collect`**, then **`report`** (all report scripts—see below). Needs the risk service online for the HTTP-based reports. |
| **`serve:collector`** | `node scripts/serve-collector.mjs` | Serves **`collector-page/`** on **`COLLECTOR_HOST`:`COLLECTOR_PORT`** for manual testing; does not run bots. |

### Reports (read CSV, optional risk API)

| Script | Command | What it does |
|--------|---------|----------------|
| **`report`** | `report:risk` → `report:identifiers` → `report:risk:indicators` → `report:risk:with-isbot-matrix-pdf` | Runs **every** report in order: classic risk Markdown/JSON/matrix, identifiers table (offline), transposed **all** risk indicators, then **`report:risk:with-isbot-matrix-pdf`** (runs **`report:risk`** again and builds the isBot matrix **PDF**). Use after **`collect`** or whenever **`CSV_INPUT`** has been refreshed. |
| **`report:risk`** | `node scripts/report-risk-from-csv.mjs` | Reads **`CSV_INPUT`** (default same as **`CSV_PATH`**). POSTs each row to **`RISK_SERVICE_URL`**. Writes **`RISK_REPORT_MD`**, **`RISK_REPORT_JSON`**, **`RISK_REPORT_MATRIX_MD`**. |
| **`report:risk:isbot-matrix-pdf`** | `node scripts/isbot-matrix-to-pdf.mjs` | Converts **`RISK_REPORT_MATRIX_MD`** to **`RISK_REPORT_MATRIX_PDF`** via `md-to-pdf`. Run **`report:risk`** first so the matrix markdown exists. |
| **`report:risk:with-isbot-matrix-pdf`** | `report:risk` **then** `report:risk:isbot-matrix-pdf` | Convenience chain for Markdown + JSON + matrix markdown + PDF. |
| **`report:identifiers`** | `node scripts/report-identifiers-from-csv.mjs` | No HTTP calls. Parses payloads from the CSV and writes a transposed table of HTTP headers + decoded UDI task values → **`IDENTIFIERS_REPORT_MD`** / **`IDENTIFIERS_REPORT_JSON`**. |
| **`report:risk:indicators`** | `node scripts/report-risk-indicators-from-csv.mjs` | Same CSV input and risk POST as **`report:risk`**, but output is a **transposed** table of **all** signal categories → **`RISK_INDICATORS_*`** paths. |

### Install / Playwright tooling

| Script | Command | What it does |
|--------|---------|----------------|
| **`install:deps`** | `PUPPETEER_SKIP_DOWNLOAD=1 npm install` | Installs npm dependencies without Puppeteer’s browser download (useful behind strict TLS). |
| **`install:deps:insecure-tls`** | `NODE_TLS_REJECT_UNAUTHORIZED=0 npm install` | **Use sparingly**—relaxes TLS for `npm install` only. |
| **`install:browsers`** | `node scripts/install-browsers.mjs` | Platform-aware Playwright + Ubuntu apt browsers. |
| **`install:browsers:ubuntu`** | `bash scripts/install-os-browsers-ubuntu.sh` | Apt: Chrome, Chromium, Firefox, Edge (root). |

### Typical workflows

- **Collect only:** `npm run collect`
- **Collect + all reports (risk, identifiers, risk indicators, matrix PDF):** `npm start`
- **All reports from existing CSV** (no new collection): `npm run report` — requires risk service for steps that call the API; **`report:identifiers`** runs offline
- **Single report:** `npm run report:risk`, `npm run report:identifiers`, `npm run report:risk:indicators`, or `npm run report:risk:with-isbot-matrix-pdf` as needed

## Configuration (`src/env.js` + `.env`)

| Variable | Purpose |
|----------|---------|
| **Collector** | |
| `COLLECTOR_URL` | Full URL to open. If **unset**, defaults to `http://COLLECTOR_HOST:COLLECTOR_PORT/`. Set this to use a hosted page without starting the local static server. |
| `COLLECTOR_HOST` | Bind host for local server (default `127.0.0.1`). |
| `COLLECTOR_PORT` | Port (default `7778`). |
| `COLLECTOR_PAGE_DIR` | Subfolder under the project root with `index.html` (default `collector-page`). |
| **Collection** | |
| `PAYLOAD_ELEMENT_ID` | DOM id of the textarea with the payload (default `textareaPayload`). |
| `PAYLOAD_TIMEOUT_MS` | Max wait for payload text in ms (default `180000`). |
| `TESTCAFE_PAYLOAD_TIMEOUT_MS` | Override payload wait for TestCafe only. |
| `TESTCAFE_FIREFOX_HEADED_EXTRA_MS` | Extra wait when TestCafe runs Firefox headed (default `120000`). |
| `TESTCAFE_PAGE_LOAD_TIMEOUT_MS`, `TESTCAFE_BROWSER_INIT_TIMEOUT_MS` | TestCafe page load / browser start (default `180000`). |
| `PUPPETEER_NAVIGATION_TIMEOUT_MS` | Puppeteer `page.goto` timeout (default = `PAYLOAD_TIMEOUT_MS`). Firefox uses `load`, not `networkidle2`. |
| `PUPPETEER_BROWSER_CLOSE_TIMEOUT_MS` | Force-kill Firefox if `browser.close()` hangs (default `20000`). |
| `CSV_PATH` | Output CSV relative to project root (default `results/payloads.csv`). |
| `BOTS_COLLECT_DUAL` | Default dual mode: headless then headed per stack (`!== "false"`). |
| `BOTS_HEADLESS` | When dual mode is off, global headless default (`!== "false"` → headless). |
| `PUPPETEER_HEADLESS`, `PLAYWRIGHT_HEADLESS`, `SELENIUM_HEADLESS`, `TESTCAFE_HEADLESS` | Per-tool overrides (`true` / `false`). |
| `BOTS_STEALTH` | Stealth mode: force `navigator.webdriver` (collector `webDriverEnabled`) to **false**, mimicking a fraudster hiding automation. Off by default; `true` / `1` to enable. |
| `PUPPETEER_STEALTH`, `PLAYWRIGHT_STEALTH`, `SELENIUM_STEALTH`, `TESTCAFE_STEALTH` | Per-tool stealth overrides (`true`/`1` or `false`/`0`); take precedence over `BOTS_STEALTH`. |
| `BOTS_PLATFORM`, `BOTS_IN_CONTAINER`, `BOTS_NO_SANDBOX`, `BOTS_SKIP_OS_BROWSER_INSTALL` | Platform and Kasm/Docker behaviour (see above). |
| `SELENIUM_CHROME_BINARY`, `CHROME_BIN`, `GOOGLE_CHROME_BIN` | Chrome binary for Selenium / Puppeteer. |
| `CHROMIUM_BIN`, `SELENIUM_CHROMIUM_BINARY` | System Chromium for Puppeteer/TestCafe/Selenium `chromium` rows. |
| `FIREFOX_BIN`, `SELENIUM_FIREFOX_BINARY` | Retail Firefox for Puppeteer / Selenium / TestCafe (not Playwright). |
| `PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH` | Optional override for Playwright’s bundled Firefox only. |
| `EDGE_BIN`, `SELENIUM_EDGE_BINARY` | Microsoft Edge (Ubuntu/Linux/Windows). |
| `BRAVE_BIN`, `SELENIUM_BRAVE_BINARY` | Brave Browser (Ubuntu/Kasm/Windows; Chromium-based). |
| `BOTS_SKIP_SELENIUM_SAFARI` | `true` / `1` to skip Safari on macOS. |
| `SELENIUM_SAFARI_SERVER` | Attach to a running `safaridriver` URL. |
| **Risk API & reports** | |
| `RISK_SERVICE_URL` | Risk signals endpoint (default `http://localhost:8080/v1/risk/signals`). |
| `RISK_REQUEST_IP` | IP sent in the JSON body (default in `.env.example`). |
| `RISK_HTTP_HEADERS_JSON` | Optional JSON object merged into each risk request `httpHeaders`. |
| `CSV_INPUT` | CSV path for report scripts; defaults to **`CSV_PATH`** when unset. |
| `RISK_REPORT_MD`, `RISK_REPORT_JSON`, `RISK_REPORT_MATRIX_MD` | Outputs for `npm run report:risk`. |
| `RISK_REPORT_MATRIX_PDF` | Output for `npm run report:risk:isbot-matrix-pdf`. |
| `IDENTIFIERS_*`, `RISK_INDICATORS_*` | Paths and `*_CELL_MAX_CHARS` for transposed Markdown reports. |
| **PDF** | |
| `MD_TO_PDF_NO_SANDBOX`, `CI` | When enabled, Chromium runs with `--no-sandbox` for `md-to-pdf`. |

Implementation lives in **`src/env.js`** (dotenv load + typed getters). **`src/config.js`** re-exports env constants and adds headless helpers used by runners.

## Stealth mode

`BOTS_STEALTH=true` (or a per-tool `*_STEALTH`) makes each automation stack report `navigator.webdriver === false` — the collector then records `webDriverEnabled: false` — emulating a real fraudster who hides the automation tell. It is **off by default** and orthogonal to headless/dual mode, so run a deliberate stealth pass when you want to compare against normal runs (the CSV `stealth` column tells the rows apart).

Per engine (all in **`src/stealth.js`**):

- **Chromium** (Chrome/Chromium/Edge/Brave): launch flag `--disable-blink-features=AutomationControlled` (+ Selenium `excludeSwitches: enable-automation`), plus an init-script getter override.
- **Firefox**: pref `dom.webdriver.enabled=false` (Puppeteer `extraPrefsFirefox`, Playwright `firefoxUserPrefs`, Selenium `setPreference`), plus the init script.
- **TestCafe**: no WebDriver — the override is injected via `clientScripts` before page scripts run (plus the Chromium flag for Chrome-family).
- **WebKit (Playwright)**: init-script override only.
- **Safari (native, Selenium)**: not supported — `safaridriver` exposes no hook to suppress `navigator.webdriver`.

Scope is limited to `navigator.webdriver` (DEVP-2649); other headless/automation tells are unchanged.

Examples:

```bash
BOTS_STEALTH=true npm run collect            # whole matrix in stealth
PUPPETEER_STEALTH=true npm run collect       # only Puppeteer stacks stealthed
BOTS_STEALTH=true PLAYWRIGHT_STEALTH=false npm run collect   # all but Playwright
```

## CSV schema

Columns: **`type`**, **`browser`**, **`headless`**, **`stealth`**, **`payload`**, **`documentHasFocus`**, **`documentVisibility`**.  
`payload` is the full textarea JSON (e.g. `{ "headers": { … }, "payload": "<UDI base64>" }`).  
`documentHasFocus` / `documentVisibility` are derived from the **decompressed** JSC where applicable.  
`stealth` is `true`/`false` per run; legacy CSVs are auto-migrated (old rows get an empty `stealth` cell) on the next append.

## Output

- **`results/payloads.csv`** — created/appended by collection runs (gitignored via `results/`).
- Report paths — configurable via `.env`; defaults under `results/` as in `.env.example`.

## Risk report details

The risk script mirrors **`sample-risk-request.sh`**: inner base64 UDI in `payload`, merged **`httpHeaders`** from the collector envelope + optional **`RISK_HTTP_HEADERS_JSON`**.

Markdown includes per–IS_BOT strategy sections (see `scripts/isBotStrategies.mjs`), the full isBot matrix, and reasons. After upgrading the risk service, re-run `npm run report:risk` to pick up new signal names.

### Sending real browser headers (hosted collector)

The bundled collector records headers into the payload JSON. For custom pages, forward **`User-Agent`**, **`Sec-CH-UA`**, and related client hints into the risk API `httpHeaders` from your backend.
