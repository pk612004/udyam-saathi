// Browser validators must give the same verdicts as the Python ones.  Run: node tests/kyc_parity.mjs
import { readFileSync } from "node:fs";
import { Registry, validate } from "../web/js/kyc.js";

const d = (f) => JSON.parse(readFileSync(new URL(`../web/data/${f}`, import.meta.url)));
const reg = new Registry(d("gstin_registry.json"), d("udyam_registry.json"));
const ext = d("kyc_extracted.json"), py = d("kyc_results.json");
let bad = 0;
for (const k of Object.keys(ext).sort()) {
  const js = validate(k, ext[k], reg);
  const same = js.verdict === py[k].verdict && JSON.stringify(js.checks.map((c) => [c.id, c.status])) === JSON.stringify(py[k].checks.map((c) => [c.id, c.status]));
  console.log(k, js.verdict.padEnd(18), same ? "same as Python" : "DIFFERENT");
  if (!same) bad++;
}
process.exit(bad ? 1 : 0);
