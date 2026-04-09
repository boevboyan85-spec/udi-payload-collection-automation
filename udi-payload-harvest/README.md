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

**VM bootstrap:** [`setup-kasm-ubuntu.sh`](setup-kasm-ubuntu.sh) installs Node 20, Playwright deps/browsers, Brave, and **Tor Browser** on **amd64** (official tarball; normalized to **`~/tor-browser`** even when the archive root is **`tor-browser_en-US`**). **`TOR_BROWSER_PATH`** targets **`Browser/firefox-bin`**. Downloads use a browser **User-Agent** and try several Tor mirrors (some networks return **403** to plain `curl`). On **arm64** it installs **`torbrowser-launcher`**. Skip Tor with **`SKIP_TOR_BROWSER=1`**. **Kasm non-persistent home:** after a full workspace reset, **`~/tor-browser`** may be gone — run **`setup-kasm-ubuntu.sh`** again (or restore Tor). **`run-kasm.sh`** scans **`~/tor-browser*/Browser`** for **`firefox-bin`** when **`TOR_BROWSER_PATH`** is unset.

Or manually:

```bash
npm install
# System libraries for bundled browsers (needs sudo on Ubuntu):
sudo npx playwright install-deps
npx playwright install chromium firefox webkit
npm run collect
```

## Configure browsers

Optional **`collect.env`** in the project root (copy from **`collect.env.example`**) sets **`UDIBROWSERS`**, **`CHROME_SIMULATE_REAL_USER`**, **`DISABLE_PLUGINS`**, etc. **Values in the file overwrite** the same variables already exported in your shell (so a full browser list in **`collect.env`** is not ignored when **`UDIBROWSERS=chrome`** is left over from **`~/.bashrc`** or an install script). Use **`UDI_COLLECT_ENV_OVERRIDE=0`** if you want the old rule: only set variables that are **unset**. Point at another file with **`UDI_COLLECT_ENV`**. **`run-kasm.sh`** does not default **`UDIBROWSERS`** so **`collect.env`** can drive the list.

Comma-separated list in **`UDIBROWSERS`** (default: `chrome,chromium,firefox,tor,brave`):

| Token | Behavior |
| ----- | -------- |
| `chrome` | Google Chrome (`channel: chrome`, fallback `google-chrome-stable`) |
| `chromium` | Playwright’s bundled Chromium |
| `brave` | `BRAVE_PATH` or `/usr/bin/brave-browser` |
| `opera` | `OPERA_PATH` or `/usr/bin/opera` |
| `firefox` | Playwright’s bundled Firefox unless **`FIREFOX_PATH`** is set (system Firefox) |
| `tor` | **`TOR_BROWSER_PATH`** → **`…/tor-browser/Browser/firefox-bin`** (Gecko ELF; **`Browser/firefox`** is often a wrapper script). Uses **Selenium + GeckoDriver** (Marionette), **not** Playwright. Install **`geckodriver`** or set **`GECKODRIVER_PATH`**. Selenium 4 may download a driver if none is found. |
| `webkit` | Playwright WebKit (not Safari). Payload comes from **`#udip` / `#txId`** on the collector page (same as other browsers). |

Example:

```bash
export UDIBROWSERS=chrome,firefox,brave,opera,tor,webkit
export TOR_BROWSER_PATH="/path/to/tor-browser/Browser/firefox-bin"
npm run collect
```

### Google Chrome: real profile and extensions (e.g. Canvas Blocker)

**`CHROME_DESKTOP_FILE`** only selects which **Chrome binary** to launch (same as a `.desktop` shortcut). It does **not** load your interactive Chrome **profile**, so extensions installed for day-to-day browsing will not appear unless you point the collector at that profile directory.

Set **`CHROME_USER_DATA_DIR`** to Chrome’s user-data path so **`launchPersistentContext`** uses the same profile tree (extensions, settings):

| OS | Typical path |
| -- | -------------- |
| Linux / Kasm | `~/.config/google-chrome` |
| macOS | `~/Library/Application Support/Google/Chrome` |

Add it to **`collect.env`** or export it before **`npm run collect`**. **Quit** other Chrome windows that use that profile first, or you may hit a **profile lock** / singleton error.

**`PLAYWRIGHT_CHROMIUM_USER_DATA_DIR`** still applies to **chromium**, **brave**, **opera**, and to **chrome** only if **`CHROME_USER_DATA_DIR`** is unset. For Google Chrome with extensions, prefer **`CHROME_USER_DATA_DIR`**.

The collector **always opens a new tab** for the URL (restored-session profiles used to reuse `pages()[0]`, which could sit on `chrome://` or a restored tab and never complete navigation). If the page still does not load, check whether an extension (Canvas Blocker, ad blockers) blocks **`COLLECTOR_URL`** — temporarily allow that origin or disable the extension for testing.

## URLs

| Variable | Default |
| -------- | ------- |
| `COLLECTOR_URL` | `https://gdtm-dev.globalsiteanalytics.com/kasm.html` (reads **`#udip`** payload and **`#txId`**) |
| `COLLECTOR_SETTLE_MS` | `2000` — extra wait after `kasm.html` loads so GDTM can fill `#udip` / `#txId` |
| `PLAYWRIGHT_IGNORE_HTTPS_ERRORS` | Default **on** (`1` / unset). Playwright passes **`ignoreHTTPSErrors`** on the browser context so TLS still works when a corporate proxy re-signs HTTPS (Firefox often shows **`SEC_ERROR_UNKNOWN_ISSUER`** without this). Set to **`0`** or **`false`** to require a valid certificate chain. |
| `PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX` | Default **on** (`1` / unset). Sets several **`MOZ_DISABLE_*`** env vars for **Playwright’s Firefox** only (bundled Juggler Firefox / **`FIREFOX_PATH`**). Set **`0`** to keep Mozilla sandboxes. **Tor** uses Selenium prefs instead. |
| `GECKODRIVER_PATH` | Optional. Path to **`geckodriver`** for **Tor** (Selenium). If unset, common locations and Selenium Manager are tried. |
| `TOR_WARMUP_MS` | Default **`20000`**. After Marionette connects, wait this long **before** `driver.get` so Tor can finish connecting to the Tor network. Increase if the window loads the URL then misbehaves. **`0`** is allowed. |
| `TOR_SETTLE_AFTER_LOAD_MS` | Default **`4000`** (Tor + Selenium only). Sleep after **`driver.get`** before polling **`#udip`**. Playwright browsers use **`COLLECTOR_SETTLE_MS`** after load instead. |
| `TOR_SELENIUM_KEEP_OPEN` | Set **`1`** to **not** call **`driver.quit()`** so Tor stays open for debugging (you close it yourself). |
| `TOR_SELENIUM_PROFILE_DIR` | **Persistent** Firefox profile directory for Tor + Selenium (default: **`~/.udi-tor-selenium-profile`**). Reusing one directory lets Tor remember **Always connect** and other launcher state. |
| `TOR_SELENIUM_EPHEMERAL_PROFILE` | Set **`1`** / **`true`** to **not** pass **`-profile`** — each run gets a new anonymous profile (connect dialog every time; legacy behavior). |
| `TOR_SELENIUM_TOR_LAUNCHER_PROMPT` | Default **on** (unset). Sets Tor prefs to reduce the startup **Connect to Tor** modal (quickstart + no launcher prompt at startup). Set **`0`** / **`false`** to leave Tor defaults. |

## Headless

**Google Chrome** and all other **Playwright** browsers (Chromium, Brave, Opera, Firefox, WebKit) honor **`HEADLESS=1`** or **`HEADLESS=true`**. **Tor** uses Selenium with **`-headless`** when **`HEADLESS`** is set the same way.

Headless changes automation/fingerprint signals. Prefer headed on KASM.

```bash
HEADLESS=1 npm run collect
```

Or set **`HEADLESS=1`** in **`collect.env`** (see **`collect.env.example`**).

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
| `GITHUB_TOKEN_FILE` | If **`GITHUB_TOKEN`** is unset, **`push-results.sh`** reads the PAT from this path (single line). |

### Push results to GitHub (`develop`)

**Automatic (default):** after every `npm run collect`, the results file is written, then (unless **`SKIP_RESULTS_FILE=1`**) the script commits **`results/txids.jsonl`** and pushes **`develop`**.

- **SSH:** configure `origin` as `git@github.com:…` and use your SSH key — no token needed.
- **HTTPS without prompts:** set **`GITHUB_USERNAME`** and **`GITHUB_TOKEN`** before `npm run collect`, or use **`GITHUB_TOKEN_FILE`**. **`setup-kasm-ubuntu.sh`** writes **`~/.config/udi-payload-harvest/git-push.env`** (mode **600**) and **`collect.mjs` merges that file** into the environment when running **`push-results.sh`**, so auto-push works even when you did not `export` in the current shell. **`run-kasm.sh`** also **`source`**s that file. **Do not commit the token.** **Revoke** any exposed PAT and create a new one.

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

**Tor (Selenium): `binary is not a Firefox executable`**

- GeckoDriver must launch the **Gecko ELF**, usually **`Browser/firefox-bin`**. On Linux, **`Browser/firefox`** is often a **shell wrapper** (`#!`) that sets the library path — using it as **`TOR_BROWSER_PATH`** fails. The collector prefers **`firefox-bin`**, then a non-script **`firefox`**, and scans **`~/tor-browser/Browser`** and **`~/.local/share/torbrowser/tbb/.../Browser`**. **`/usr/bin/tor-browser`** is usually a distro script (skipped). Stderr logs **`Tor: binary …`** when it picks one.

**Brave / Opera / Tor not found**

- Set **`BRAVE_PATH`**, **`OPERA_PATH`**, or **`TOR_BROWSER_PATH`**. For Tor + Selenium use **`…/Browser/firefox-bin`** (or unset for auto-detect), not **`/usr/bin/tor-browser`** when that is a wrapper.

**Firefox (Playwright): `CanCreateUserNamespace() … EPERM`**

- Containers often block Linux user namespaces. **`PLAYWRIGHT_MOZ_DISABLE_CONTENT_SANDBOX`** (default on) sets **`MOZ_DISABLE_*`** for Playwright’s Firefox launches.

**Tor asks to connect every run even after “Always connect”**

- By default the script uses a **persistent profile** at **`~/.udi-tor-selenium-profile`** (override with **`TOR_SELENIUM_PROFILE_DIR`**) via **`-profile`**, so Tor can save launcher settings. Older behavior used a **new anonymous profile each session** (nothing persisted). If you still see the dialog on every run, confirm stderr shows **`Tor: persistent Marionette profile:`** and that you are not setting **`TOR_SELENIUM_EPHEMERAL_PROFILE=1`**. **`TOR_SELENIUM_TOR_LAUNCHER_PROMPT`** defaults to prefs that skip the launcher modal when Tor allows it.

**Tor Browser opens but automation never navigates / stuck until you close the window**

- **Tor is not Playwright-Juggler Firefox.** This project uses **Selenium + GeckoDriver**. Install **`geckodriver`**, run **`npm install`**. **`tor`** is in the default **`UDIBROWSERS`**; add it if you use a shorter list.

**Tor opens the URL then the window closes with little or no terminal output**

- The script logs **`[tor] …`** steps to stderr. If it closes right after load, Tor may still be **bootstrapping** when HTTPS runs — increase **`TOR_WARMUP_MS`** (e.g. **`30000`**). Polling now **re-finds** **`#udip`** each loop so **stale WebElement** errors from GDTM reloads do not abort silently. Use **`TOR_SELENIUM_KEEP_OPEN=1`** to skip **`driver.quit()`** and inspect the tab. **`[tor] driver.quit failed:`** can appear if Tor already exited on its own.

**`RenderCompositorSWGL` / framebuffer errors (Kasm)**

- Tor’s Selenium path disables **WebRender** / GPU layers via Firefox **preferences** where possible. If graphics still fail, try **`HEADLESS=1`** for that run or fix the session’s **GL/VNC** setup.

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
