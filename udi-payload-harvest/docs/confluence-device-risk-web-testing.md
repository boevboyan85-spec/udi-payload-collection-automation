# Device Risk Indicators — Web (UDI Collector) — Test design and results

_Use this page as the Confluence source: copy sections into your space or paste as Markdown if your Confluence supports it._

## Summary

| Field | Value |
| ----- | ----- |
| **Jira** | _(link: Test the effectiveness of device risk indicators for web events)_ |
| **Collector (reference)** | https://gdtm-dev.globalsiteanalytics.com/kasm.html (`#udip`, `#txId`) |
| **Shared text (lab sync)** | https://gdtm-dev.globalsiteanalytics.com/text.html |
| **Risk service / SDK** | _(version, environment, decrypt doc link)_ |
| **Owner** | _(name)_ |
| **Last updated** | _(date)_ |

**Goal:** Establish whether **device risk indicators** for **web events** fire reliably for: virtual machine, anti-fingerprinting browsers, RAT (lab-only), developer tools, and bots—using the collector payload and downstream Risk processing.

---

## Objectives

1. Validate **collector** output: payload present, non-trivial length, repeatable where expected.
2. Validate **Risk service** behavior: expected signals (indicators) for each scenario, with evidence.
3. Record **limitations** (Safari on Linux, clipboard automation, shared-text sensitivity).

---

## Scope

**In scope**

- Reference host page and JSC SDK version aligned with release under test.
- Ubuntu **KASM** (or equivalent) with installed browsers: Chrome, Firefox, Brave, Opera, Tor Browser; **WebKit** (Playwright) as optional WebKit-engine proxy—not Safari.
- Headed sessions as default (realistic fingerprints).

**Out of scope** (unless Product expands)

- Mobile WebView, native apps, production A/B traffic.

---

## Assumptions and non-goals

- Payloads may contain sensitive material; **do not** paste raw payloads into this page. Store artifacts in approved secure storage; here link **TestRail run IDs** and **hashes/lengths** only.
- **RAT** scenarios use **synthetic / approved lab tooling** only—not real malware.
- **Safari** is **not** runnable on Ubuntu; Safari coverage requires **macOS** (physical or CI).

---

## Environment matrix

| Attribute | Value |
| --------- | ----- |
| KASM image / OS | _(e.g. Ubuntu 22.04)_ |
| Browsers under test | _(versions)_ |
| Collector URL | https://gdtm-dev.globalsiteanalytics.com/kasm.html |
| Automation | `udi-payload-harvest` Playwright collector (see repo README) |

---

## Test method

1. **Baseline:** For each browser, capture payload on a clean profile (no extensions). Record length, SHA-256 (optional), and whether two consecutive loads match within tolerance.
2. **Single-variable scenarios:** Change one dimension per run (e.g. DevTools open only, or VM guest only) so attribution stays clear.
3. **Repeatability:** Execute each scenario **N** times (e.g. 5–10); note variance.
4. **Ground truth:** Document how each scenario is confirmed (e.g. `navigator.webdriver`, hypervisor hints, extension enabled, DevTools docked).
5. **End-to-end:** For each scenario, record **expected Risk indicator(s)** vs **observed** (dashboard/API—see [Risk service E2E alignment](risk-service-e2e-alignment.md)).

---

## Scenario catalog (signal mapping template)

_Use one row per executed scenario; link TestRail case and artifact ID._

| Scenario ID | Category | Preconditions | Expected indicator(s) | Payload notes (no secrets) | Observed | Evidence (TestRail / attachment) |
| ----------- | -------- | --------------- | --------------------- | -------------------------- | -------- | ---------------------------------- |
| S-BASE-CHR-01 | Baseline | Clean Chrome | _(TBD with Risk)_ | Length/hash | | |
| S-VM-01 | VM | KASM/guest known VM | _(TBD)_ | Diff vs bare-metal | | |
| S-AFP-01 | Anti-fingerprint | Firefox resistFingerprinting / Brave shields | _(TBD)_ | | | |
| S-DEV-01 | Developer tools | DevTools open | _(TBD)_ | | | |
| S-BOT-01 | Automation | Playwright/Selenium session | _(TBD)_ | `webdriver` etc. | | |
| S-RAT-01 | RAT (lab) | Approved synthetic only | _(TBD)_ | | | |

---

## Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Clipboard blocked in automation | Prefer reading payload from DOM when rendered; grant clipboard permissions; manual capture fallback. |
| Shared text URL exposes payloads | Short-lived sessions; prefer secure artifact store; paste hashes in Confluence. |
| Anti-fingerprint breaks automation | Manual path documented in TestRail; reduce parallel runs. |
| Headless vs headed differ on bot signals | Run headed for primary matrix; document headless as separate case. |
| Safari | Cover on macOS or exclude explicitly from Ubuntu matrix. |

---

## Execution log template

| Date | Executor | Build/SDK | Browsers | Notes | TestRail run |
| ---- | -------- | --------- | -------- | ----- | -------------- |
| | | | | | |

---

## Results and recommendations

_(Fill after test execution.)_

**Summary:** _(effective / partial / ineffective per category)_

**Recommendations:** _(product, engineering, documentation)_

**Open issues:** _(Jira links)_

---

## Appendix: Automation (payload harvest)

Batch collection from KASM: see project [README.md](../README.md) — `run-kasm.sh` / `npm run collect` appends labeled payloads to the shared text page for transfer to a local machine.
