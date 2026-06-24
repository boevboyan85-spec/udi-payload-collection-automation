/**
 * Runs multiple automation stacks (Puppeteer, Playwright, Selenium) against the UDI Collector page,
 * waits for #textareaPayload to contain text, then appends rows to results/payloads.csv
 * (`documentHasFocus` / `documentVisibility` are read from the decompressed JSC, not the automation DOM).
 */
import path from "path";
import { fileURLToPath } from "url";

import { CSV_PATH, isDualCollectionEnabled, TARGET_URL } from "./config.js";
import { appendPayloadRow } from "./csvStore.js";
import { formatPlatformSummary, getPlatformProfile } from "./platform.js";
import { buildTaskList } from "./tasks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const csvAbsolute = path.resolve(projectRoot, CSV_PATH);

const tasks = buildTaskList();

async function main() {
  const profile = getPlatformProfile();
  console.log("Environment:", formatPlatformSummary(profile));
  console.log("Target:", process.env.COLLECTOR_URL || TARGET_URL);
  console.log("CSV:", csvAbsolute);
  console.log(
    "Collection mode:",
    isDualCollectionEnabled()
      ? "dual (each stack: headless + headed; Safari: headed once)"
      : "single (BOTS_HEADLESS / per-tool env)"
  );
  const stealthOn =
    process.env.BOTS_STEALTH === "true" || process.env.BOTS_STEALTH === "1";
  console.log(
    "Stealth mode:",
    stealthOn
      ? "on (navigator.webdriver forced false; per-tool *_STEALTH can override)"
      : "off (set BOTS_STEALTH=true, or per-tool *_STEALTH)"
  );
  console.log("---");

  for (const { name, run } of tasks) {
    try {
      console.log(`Running: ${name} ...`);
      const row = await run();
      appendPayloadRow(csvAbsolute, row);
      console.log(
        `  OK — headless=${row.headless}, stealth=${row.stealth}, document.hasFocus=${row.documentHasFocus}, visibility=${row.documentVisibility}, payload (${row.payload.length} chars)`
      );
    } catch (err) {
      console.error(`  FAILED (${name}):`, err.message || err);
    }
  }

  console.log("---");
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
