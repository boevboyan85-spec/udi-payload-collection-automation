/**
 * Display names and Java strategy classes for every RiskCategories.IS_BOT signal
 * (must match RiskSignals API `name` strings).
 */
export const BOT_BY_DOCUMENT_FOCUS_SIGNAL_NAME = "Bot by document focus";

/** @typedef {{ signalName: string, strategyClass: string, description: string }} IsBotStrategyDef */

/** @type {IsBotStrategyDef[]} Order matches risk-service {@code RiskSignals.java} (IS_BOT entries). */
export const IS_BOT_STRATEGY_SECTIONS = [
  {
    signalName: "Bot by screen size or color depth",
    strategyClass: "BotScreenStrategy",
    description:
      "Uses screen / color-depth style signals from the UDI payload vs expected browser profile. **TRUE** when the service treats size/depth as bot-like.",
  },
  {
    signalName: "Bot by user agent",
    strategyClass: "BotByUserAgentStrategy",
    description:
      "Parses and classifies the user agent (payload and/or HTTP headers). **TRUE** when the UA matches bot automation patterns the service encodes.",
  },
  {
    signalName: "Bot by web driver",
    strategyClass: "BotByWebDriveStrategy",
    description:
      "Uses webdriver / automation hints from the payload (e.g. `navigator.webdriver`). **TRUE** when automation is indicated.",
  },
  {
    signalName: "Bot by hardware mismatch",
    strategyClass: "BotHardwareMismatchStrategy",
    description:
      "Compares hardware or capability signals to the declared device profile from the UA. **TRUE** when payload contradicts the profile.",
  },
  {
    signalName: "Bot by WebGL anomaly",
    strategyClass: "BotByWebGlAnomalyStrategy",
    description:
      "Uses WebGL renderer/vendor and related payload fields. **TRUE** when WebGL data looks anomalous for the claimed browser/OS.",
  },
  {
    signalName: "Bot by navigator anomaly",
    strategyClass: "BotByNavigatorAnomalyStrategy",
    description:
      "Uses navigator-derived consistency checks. **TRUE** when navigator-related fields disagree with each other or expectations.",
  },
  {
    signalName: "Canvas anomaly",
    strategyClass: "BotByCanvasStrategy",
    description:
      "Uses `canvasFingerprint`, `canvasString`, `canvasApiAvailable`, `canvasCollectStatus` from the JSC. **TRUE** when fingerprint is empty/error, matches known spoof patterns, or canvas `toDataURL` string looks tampered. (Risk category: Browser spoofing.)",
  },
  {
    signalName: "Bot by mime types",
    strategyClass: "BotByMimeTypesStrategy",
    description:
      "Uses `navigator.mimeTypes` style length/signals from the payload. **TRUE** when mime-type enumeration looks like a bot profile.",
  },
  {
    signalName: "Bot by service worker",
    strategyClass: "BotByServiceWorkerStrategy",
    description:
      "Uses `serviceWorkerApiPresent` from the JSC plus parsed UA and optional `Sec-CH-UA` / `User-Agent` HTTP headers. **TRUE** when a Chromium-class browser should expose `navigator.serviceWorker` but the payload reports it absent (excludes webviews / excluded browsers → UNKNOWN).",
  },
  {
    signalName: BOT_BY_DOCUMENT_FOCUS_SIGNAL_NAME,
    strategyClass: "BotByDocumentFocusStrategy",
    description:
      "Uses **`documentHasFocus`** and **`documentVisibility`** inside the posted JSC. CSV columns for those keys are filled from the **decompressed** JSC (`udiDecompress.js`). **TRUE** when focus is false (parsed) or visibility is `hidden` (case-insensitive).",
  },
  {
    signalName: "Bot by function bind",
    strategyClass: "BotByFunctionBindStrategy",
    description:
      "Uses `bindString` and `toStringString` (`Function.prototype.bind` / `toString` native signatures). **TRUE** when either string does not match expected native forms. **UNKNOWN** if either field is missing.",
  },
  {
    signalName: "Bot by storage inconsistency",
    strategyClass: "BotByStorageInconsistencyStrategy",
    description:
      "Uses `storagePersistence` JSON (`localStorage` / `sessionStorage` / `indexedDb` buckets with `apiPresent` + `probe`) or legacy booleans plus `localStorageProbe`, `sessionStorageProbe`, `indexedDbProbe`. Probes **BAD**: `blocked`, `error`, `timeout`; **GOOD**: `ok`, `skipped_privacy`. **TRUE** when an API is advertised but a probe is BAD.",
  },
];

/**
 * @param {Set<string>} names
 * @returns {string[]}
 */
export function sortIsBotSignalColumnNames(names) {
  const ordered = IS_BOT_STRATEGY_SECTIONS.map((s) => s.signalName);
  const rest = [...names]
    .filter((n) => !ordered.includes(n))
    .sort((a, b) => a.localeCompare(b, "en"));
  return [...ordered, ...rest];
}
