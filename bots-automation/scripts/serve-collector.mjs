/**
 * Serves `collector-page/` on COLLECTOR_HOST:COLLECTOR_PORT (default 127.0.0.1:7778).
 */
import "../src/env.js";
import { startCollectorServer } from "./collector-http.mjs";

const { baseUrl, host, port } = await startCollectorServer();
console.log(`Collector page: ${baseUrl} (listening on ${host}:${port})`);
