import fs from "fs";

import { ClientFunction, Selector } from "testcafe";

const payloadTimeout = Number(process.env.BOTS_PAYLOAD_TIMEOUT_MS) || 180_000;
const elementId = process.env.BOTS_PAYLOAD_ELEMENT_ID || "textareaPayload";

const readPayloadValue = ClientFunction((id) => {
  const el = document.getElementById(id);
  if (!el) return "";
  const v = "value" in el ? el.value : el.textContent;
  return v == null ? "" : String(v).trim();
});

fixture`UDI Collector payload`.page`${process.env.COLLECTOR_URL}`;

test("Capture textareaPayload", async (t) => {
  const textarea = Selector(`#${elementId}`);
  const existsTimeout = Math.min(90_000, payloadTimeout);

  await t.expect(textarea.exists).ok({ timeout: existsTimeout });
  await t
    .expect(readPayloadValue(elementId))
    .notEql("", { timeout: payloadTimeout });

  const payload = await readPayloadValue(elementId);
  const out = JSON.stringify({ payload });
  fs.writeFileSync(process.env.BOTS_TC_OUT, out, "utf8");
});
