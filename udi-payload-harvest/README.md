# udi-payload-harvest

Collect **UDI Collector** payloads from multiple browsers on **Ubuntu / KASM**, then write **`results/txids.jsonl`** (this run only) and optionally **push** to GitHub **`develop`** for downstream use.

Companion docs:

- [Confluence draft (paste into your space)](docs/confluence-device-risk-web-testing.md)
- [TestRail CSV starter cases](docs/testrail-import.csv)
- [Risk service E2E alignment checklist](docs/risk-service-e2e-alignment.md)

## Prerequisites

- **Node.js 18+**
- Display available (**headed** mode is default — required for realistic fingerprints on KASM)
- Target browsers installed (paths below)

**Safari** does not run on Linux. Use **macOS** for Safari, or use **WebKit** (`UDIBROWSERS=webkit`) as a WebKit-engine proxy only.

## Quick start (KASM)

```bash
cd udi-payload-harvest
chmod +x run-kasm.sh scripts/collect.mjs
./run-kasm.sh
```

**VM bootstrap:** [`setup-kasm-ubuntu.sh`](setup-kasm-ubuntu.sh) installs Node 20, Playwright deps/browsers, Brave, and **Tor Browser** on **amd64** (official tarball → `~/tor-browser`, **`TOR_BROWSER_PATH`**). Downloads use a browser **User-Agent** and try several Tor mirrors (some networks return **403** to plain `curl`). On **arm64** it installs **`torbrowser-launcher`** (run once from the GUI to download Tor, then set **`TOR_BROWSER_PATH`**). Skip Tor with **`SKIP_TOR_BROWSER=1`**; pin a version with **`TOR_BROWSER_VERSION`**. **`run-kasm.sh`** exports **`TOR_BROWSER_PATH`** automatically when `~/tor-browser/Browser/firefox` exists and the variable is unset.

Or manually:

```bash
npm install
# System libraries for bundled browsers (needs sudo on Ubuntu):
sudo npx playwright install-deps
npx playwright install chromium firefox webkit
npm run collect
```

## Configure browsers

Comma-separated list in **`UDIBROWSERS`** (default: `chrome,firefox,chromium`):

| Token | Behavior |
| ----- | -------- |
| `chrome` | Google Chrome (`channel: chrome`, fallback `google-chrome-stable`) |
| `chromium` | Playwright’s bundled Chromium |
| `brave` | `BRAVE_PATH` or `/usr/bin/brave-browser` |
| `opera` | `OPERA_PATH` or `/usr/bin/opera` |
| `firefox` | Playwright’s bundled Firefox unless **`FIREFOX_PATH`** is set (system Firefox) |
| `tor` | `TOR_BROWSER_PATH` or `/usr/bin/tor-browser` |
| `webkit` | Playwright WebKit (not Safari). Payload comes from **`#udip` / `#txId`** on the collector page (same as other browsers). |

Example:

```bash
export UDIBROWSERS=chrome,firefox,brave,opera,tor,webkit
export TOR_BROWSER_PATH="/path/to/tor-browser/Browser/firefox"
npm run collect
```

## URLs

| Variable | Default |
| -------- | ------- |
| `COLLECTOR_URL` | `https://gdtm-dev.globalsiteanalytics.com/kasm.html` (reads **`#udip`** payload and **`#txId`**) |
| `COLLECTOR_SETTLE_MS` | `2000` — extra wait after `kasm.html` loads so GDTM can fill `#udip` / `#txId` |
| `PLAYWRIGHT_IGNORE_HTTPS_ERRORS` | Default **on** (`1` / unset). Playwright passes **`ignoreHTTPSErrors`** on the browser context so TLS still works when a corporate proxy re-signs HTTPS (Firefox often shows **`SEC_ERROR_UNKNOWN_ISSUER`** without this). Set to **`0`** or **`false`** to require a valid certificate chain. |

## Headless

Headless changes automation/fingerprint signals. Prefer headed on KASM.

```bash
HEADLESS=1 npm run collect
```

## How collection works

1. For each browser: new context, open **[kasm.html](https://gdtm-dev.globalsiteanalytics.com/kasm.html)** (or `COLLECTOR_URL`).
2. Wait for **`input#udip`** and **`input#txId`**, then poll until **`#udip`** has the payload (GDTM snippet fills these asynchronously).
3. After all browsers finish, **overwrite** [`results/txids.jsonl`](results/txids.jsonl) with **only this run’s** rows (JSON Lines — previous runs are not kept in the file).

### `results/txids.jsonl` (JSONL)

Each **successful** browser in the current run becomes one line. The file is **replaced** on every `npm run collect` (no historical accumulation in the file).

```json
{"txId":"…","browserName":"Google Chrome","browserVersion":"131.0.6778.0","fetchedAt":"2026-04-01T14:00:00.000Z"}
```

| Field | Meaning |
| ----- | ------- |
| `txId` | Value from `#txId` (may be empty string) |
| `browserName` | Display label (e.g. Google Chrome, Brave) |
| `browserVersion` | Playwright `browser.version()` (engine/browser build string) |
| `fetchedAt` | ISO-8601 timestamp when the row was written |

**Why JSONL:** one object per line; easy to parse in another automation (`readline` / `jq -c .`). Use **`SKIP_RESULTS_FILE=1`** to disable writing.

| Env | Default |
| --- | ------- |
| `RESULTS_FILE` | `<project>/results/txids.jsonl` (override path; relative paths are under the project root) |
| `SKIP_RESULTS_FILE` | unset — set to `1` to skip the file (also skips auto-push) |
| `AUTO_PUSH_RESULTS` | **on** by default — after the last browser, runs **`scripts/push-results.sh`** (commit + **`git push origin develop`**). Set to **`0`** or **`false`** to disable. |
| `GITHUB_USERNAME` | GitHub login for **HTTPS** push when **`GITHUB_TOKEN`** is set (no username prompt) |
| `GITHUB_TOKEN` | [Personal access token](https://github.com/settings/tokens) (`repo` scope). **Never commit this.** Prefer SSH keys for daily use; HTTPS+token is optional for headless KASM. |

### Push results to GitHub (`develop`)

**Automatic (default):** after every `npm run collect`, the results file is written, then (unless **`SKIP_RESULTS_FILE=1`**) the script commits **`results/txids.jsonl`** and pushes **`develop`**.

- **SSH:** configure `origin` as `git@github.com:…` and use your SSH key — no token needed.
- **HTTPS without prompts:** set **`GITHUB_USERNAME`** (your GitHub login) and **`GITHUB_TOKEN`** (PAT) in the environment before `npm run collect`. **`push-results.sh`** uses them for `git push` so the terminal does not ask for a password. **Do not put the token in the repo** — use `export` in `~/.bashrc`, a local file listed in `.gitignore`, or your secret manager. **Revoke any token that was exposed** (e.g. pasted in chat) and create a new one.

Use **`AUTO_PUSH_RESULTS=0`** to skip pushing.

**Git author on KASM (required for `git commit`):** **Option C (recommended)** — set a **global** identity once:

```bash
git config --global user.email "you@example.com"
git config --global user.name "Your Name"
```

Or the same via helper (keeps secrets out of shell history if you prefer env vars):

```bash
export GIT_USER_EMAIL="you@example.com"
export GIT_USER_NAME="Your Name"
bash scripts/git-config-global.sh
```

**Alternative:** session-only exports (no global config) — `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` — see earlier in this file; you can add them to `~/.bashrc` if needed.

**Manual:** from the **`udi-payload-harvest`** folder:

```bash
chmod +x scripts/push-results.sh
npm run push-results -- "chore(results): append txId capture records"
```

This commits **`results/txids.jsonl`** and runs **`git push origin develop`**. For the parent repo ([`udi-payload-collection-automation`](https://github.com/boevboyan85-spec/udi-payload-collection-automation)), run from the cloned tree so git sees **`udi-payload-harvest/results/txids.jsonl`**.

**Consuming downstream:** read the file line-by-line, `JSON.parse` each line, and pass `txId` to your service.

## Troubleshooting

**Empty payload / missing txId**

- Open `COLLECTOR_URL` manually and confirm **`#udip`** and **`#txId`** are filled after the GDTM snippet runs.
- Check stderr for **`Payload captured (N chars), txId: …`**. If `#udip` stays empty, increase **`COLLECTOR_SETTLE_MS`** (e.g. `5000`) or fix network / snippet on the page.

**Hangs after the page opens**

- The script no longer waits for **`networkidle`** (analytics/WebSockets often prevent it from ever finishing). It waits for **`load`**, then **`COLLECTOR_SETTLE_MS`**, then **`#udip` / `#txId` attached** (not only *visible*, so hidden inputs still count).
- If it still stalls, confirm the IDs in DevTools; inputs inside a **same-origin iframe** are handled. **Cross-origin** iframes cannot be read from the parent page — run against a page that exposes fields on the top document or use a proxy host.

**Brave / Opera / Tor not found**

- Set `BRAVE_PATH`, `OPERA_PATH`, or `TOR_BROWSER_PATH` to the real binary. Tor is often under `tor-browser/Browser/firefox` or a distro wrapper script.

**403 / corporate proxy**

- Run inside KASM where the collector is reachable; set `HTTP_PROXY`/`HTTPS_PROXY` if required.

## Security

Payloads and `txId` values are sensitive. Store **`results/txids.jsonl`** and Git remotes only where your policy allows; rotate credentials if exposed (see Confluence draft).

## TestRail import

Import [docs/testrail-import.csv](docs/testrail-import.csv) via TestRail’s CSV importer (column mapping may need adjustment for your project). Create a suite **Device Risk Indicators — Web (UDI Collector)** and map the **Section** column to sections.

## Optional: Playwright test runner

```bash
npx playwright test
```

The sample spec is skipped by default; use it as a template for CI smoke tests.
