/**
 * If COLLECTOR_URL is unset, starts the local collector server and runs `src/index.js`
 * with COLLECTOR_URL set. Otherwise runs the collector against the given URL only.
 */
import "../src/env.js";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { startCollectorServer } from "./collector-http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const indexEntry = path.join(projectRoot, "src", "index.js");

function runIndex(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [indexEntry], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) resolve(1);
      else resolve(code ?? 0);
    });
  });
}

let exitCode = 0;

if (process.env.COLLECTOR_URL && String(process.env.COLLECTOR_URL).trim()) {
  exitCode = await runIndex({});
} else {
  const server = await startCollectorServer();
  try {
    console.log(`Local collector: ${server.baseUrl}`);
    exitCode = await runIndex({ COLLECTOR_URL: server.baseUrl });
  } finally {
    await server.close();
  }
}

process.exit(exitCode);
