/**
 * PDF export for the standalone isBot matrix markdown (landscape A4).
 * Requires `results/risk-report-isbot-matrix.md` — run `npm run report:risk` first.
 *
 * Env: RISK_REPORT_MATRIX_MD, RISK_REPORT_MATRIX_PDF, MD_TO_PDF_NO_SANDBOX, CI
 */
import fs from "node:fs/promises";
import path from "node:path";
import { mdToPdf } from "md-to-pdf";

import {
  isMdToPdfNoSandbox,
  resolveProjectPath,
  RISK_REPORT_MATRIX_MD,
  RISK_REPORT_MATRIX_PDF,
} from "../src/env.js";

const mdPath = resolveProjectPath(RISK_REPORT_MATRIX_MD);
const pdfPath = resolveProjectPath(RISK_REPORT_MATRIX_PDF);

try {
  await fs.access(mdPath);
} catch {
  console.error(`Missing matrix markdown: ${mdPath}`);
  console.error("Run: npm run report:risk");
  process.exit(1);
}

const launchOptions = {};
if (isMdToPdfNoSandbox()) {
  launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox"];
}

await mdToPdf(
  { path: mdPath },
  {
    dest: pdfPath,
    css: `
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        font-size: 9px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: auto;
      }
      th, td {
        padding: 2px 4px;
        vertical-align: top;
        word-break: break-word;
      }
      code {
        font-size: 0.95em;
      }
    `,
    pdf_options: {
      format: "A3",
      landscape: true,
      printBackground: true,
      margin: { top: "8mm", bottom: "8mm", left: "6mm", right: "6mm" },
    },
    launch_options: launchOptions,
  }
);

console.log(`Wrote ${pdfPath}`);
