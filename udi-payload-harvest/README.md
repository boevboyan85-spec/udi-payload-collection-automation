# udi-payload-harvest

Collect **UDI Collector** payloads from multiple browsers on **Ubuntu / KASM**, then **append** labeled blocks to the [shared text sync](https://gdtm-dev.globalsiteanalytics.com/text.html) page so you can read them from your local machine.

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
| `firefox` | System Firefox or `FIREFOX_PATH` |
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
| `TEXT_SYNC_URL` | `https://gdtm-dev.globalsiteanalytics.com/text.html` |
| `TEXT_SYNC_DRAIN_MS` | `3000` — wait after each append so WebSocket sync can flush before the browser closes |
| `TEXT_SYNC_STABLE_MS` | `400` — poll interval while waiting for `#text` to finish loading from sync |
| `TEXT_SYNC_STABLE_TICKS` | `4` — how many unchanged polls count as “stable” |
| `COLLECTOR_SETTLE_MS` | `2000` — extra wait after `kasm.html` loads so GDTM can fill `#udip` / `#txId` |

## Headless

Headless changes automation/fingerprint signals. Prefer headed on KASM.

```bash
HEADLESS=1 npm run collect
```

## How collection works

1. For each browser: new context, open **[kasm.html](https://gdtm-dev.globalsiteanalytics.com/kasm.html)** (or `COLLECTOR_URL`).
2. Wait for **`input#udip`** and **`input#txId`**, then poll until **`#udip`** has the payload (GDTM snippet fills these asynchronously).
3. Open the shared text page, **append** to **`textarea#text`** (or **`contenteditable`** if that element is absent):

   `--- BROWSER: <name> | engine: <version> | <ISO time> ---`  
   `txId: …`  
   User-Agent, blank line, then payload.

4. **Append a machine-readable row** to [`results/txids.jsonl`](results/txids.jsonl) (JSON Lines: one JSON object per line).

### `results/txids.jsonl` (JSONL)

Each successful browser run appends one line:

```json
{"txId":"…","browserName":"Google Chrome","browserVersion":"131.0.6778.0","fetchedAt":"2026-04-01T14:00:00.000Z"}
```

| Field | Meaning |
| ----- | ------- |
| `txId` | Value from `#txId` (may be empty string) |
| `browserName` | Display label (e.g. Google Chrome, Brave) |
| `browserVersion` | Playwright `browser.version()` (engine/browser build string) |
| `fetchedAt` | ISO-8601 timestamp when the row was written |

**Why JSONL:** easy to append without rewriting the file; easy to stream in another automation (`readline` / `jq -c .`). Use **`SKIP_RESULTS_FILE=1`** to disable writing.

| Env | Default |
| --- | ------- |
| `RESULTS_FILE` | `<project>/results/txids.jsonl` (override path; relative paths are under the project root) |
| `SKIP_RESULTS_FILE` | unset — set to `1` to skip the file |
| `AUTO_PUSH_RESULTS` | **on** by default — after the last browser, runs **`scripts/push-results.sh`** (commit + **`git push origin develop`**). Set to **`0`** or **`false`** to disable. |

### Push results to GitHub (`develop`)

**Automatic (default):** after every `npm run collect`, if **`results/txids.jsonl`** exists and you are inside a **git** clone with **`origin`** and credentials, the script commits changes and pushes **`develop`**. Use **`AUTO_PUSH_RESULTS=0`** to skip.

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

**Sync page shows nothing (collector looked fine)**

- Many real-time editors use **React** (controlled `<textarea>`). The script sets `#text` via the native `value` setter and dispatches `input` / `InputEvent` so sync libraries see updates; if yours still ignores it, record the framework and we can add a targeted hook.

**Literal “undefined” when the sync box was empty**

- Empty synced values are normalized (Playwright / React can otherwise surface the literal string `undefined`). A single `input` event is sent to avoid double React updates flashing junk before the real content.

**Brave / Opera / Tor not found**

- Set `BRAVE_PATH`, `OPERA_PATH`, or `TOR_BROWSER_PATH` to the real binary. Tor is often under `tor-browser/Browser/firefox` or a distro wrapper script.

**Shared text does not update remotely**

- The page may require **`input`/`change` events** on the field; the script dispatches them. If the app uses a different widget, adjust `appendToSharedText` in `scripts/collect.mjs`.

**403 / corporate proxy**

- Run inside KASM where the collector is reachable; set `HTTP_PROXY`/`HTTPS_PROXY` if required.

## Security

Payloads are sensitive. The shared text URL may be visible to others. Prefer short sessions, access control if available, or store artifacts only in approved secure storage (see Confluence draft).

## TestRail import

Import [docs/testrail-import.csv](docs/testrail-import.csv) via TestRail’s CSV importer (column mapping may need adjustment for your project). Create a suite **Device Risk Indicators — Web (UDI Collector)** and map the **Section** column to sections.

## Optional: Playwright test runner

```bash
npx playwright test
```

The sample spec is skipped by default; use it as a template for CI smoke tests.
