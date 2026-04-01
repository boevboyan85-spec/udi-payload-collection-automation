# Risk service — end-to-end indicator verification (alignment checklist)

Payload collection alone does **not** prove indicator **effectiveness**; Risk must consume the payload and emit signals. Use this checklist with the Risk / Device Intelligence team to close the loop.

## Information to request from Risk engineering

1. **Decryption / parsing:** Which service version and environment decode the web payload?
2. **Indicator catalog:** List of indicator codes or names that can fire for **web** events, with short definitions.
3. **Trigger conditions:** For each indicator, which **payload fields** or derived features (high level—no need for full schema if sensitive) drive the decision?
4. **Observation surface:** How to verify in **non-production**?
   - Risk API (endpoint, auth, sample request)
   - Internal dashboard / Kibana / Splunk query
   - Test harness that accepts payload blob and returns indicator list

## TestRail extension (suggested)

Add a **custom field** or **step 2** to relevant cases:

- **Submit payload** to test Risk endpoint _(or paste correlation ID from production-like pipeline if approved)_.
- **Assert:** Indicator **X** present/absent with severity **Y**.

## Template: mapping table (fill with Risk team)

| Indicator ID / name | Driven by (high level) | Test scenarios that should fire | False-positive risks |
| ------------------- | ---------------------- | ------------------------------- | -------------------- |
| | | | |

## Evidence bundle per run

- TestRail case ID and run ID
- Collector payload artifact (secure storage)—or hash + length only in Confluence
- Risk response screenshot or JSON (redacted) showing indicators
- Browser name, version, and scenario tags (VM, AFP, etc.)

## Sign-off

| Role | Name | Date | Notes |
| ---- | ---- | ---- | ----- |
| Product (Device Intelligence) | | | |
| Risk engineering | | | |
| QA | | | |
