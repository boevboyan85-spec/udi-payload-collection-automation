/**
 * Runs multiple automation stacks (Puppeteer, Playwright, Selenium) against the UDI Collector page,
 * waits for #textareaPayload to contain text, then appends rows to results/payloads.csv
 * (`documentHasFocus` / `documentVisibility` are read from the decompressed JSC, not the automation DOM).
 */
import path from "path";
import { fileURLToPath } from "url";

import { CSV_PATH, isDualCollectionEnabled, TARGET_URL } from "./config.js";
import { appendPayloadRow } from "./csvStore.js";
import { normalizeCollectorPayloadEnvelope } from "./httpHeadersNormalize.js";
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
  console.log("---");

  for (const { name, run } of tasks) {
    try {
      console.log(`Running: ${name} ...`);
      const row = await run();
      appendPayloadRow(csvAbsolute, {
        ...row,
        payload: normalizeCollectorPayloadEnvelope(row.payload),
      });
      console.log(
        `  OK — headless=${row.headless}, document.hasFocus=${row.documentHasFocus}, visibility=${row.documentVisibility}, payload (${row.payload.length} chars)`
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
