// Adversarial advisor scenarios, the kind judges run live. Run: node tests/engine.test.mjs
import { readFileSync } from "node:fs";
import { Engine } from "../web/js/engine.js";

const d = (f) => JSON.parse(readFileSync(new URL(`../web/data/${f}`, import.meta.url)));
const e = new Engine(d("catalogue.json"), d("reference.json"));
const base = { gstActive: true, tier: 1, employees: 5, sites: 1, segment: "micro", needs: [], fibre: true, spend: 2000 };
const ids = (r) => r.items.map((i) => i.id);
let fail = 0;
const t = (name, p, assert) => {
  const r = e.recommend({ ...base, ...p });
  const bad = e.validate(r.items, { ...base, ...p }).filter((i) => i.problems.length);
  const ok = assert(r) && bad.length === 0;
  console.log(ok ? "PASS" : "FAIL", name, "→", ids(r).join(" "), r.notes.length ? `| notes: ${r.notes.length}` : "");
  if (!ok) fail++;
};

t("Tier-2 clinic never gets 1 Gbps fibre", { segment: "prof", tier: 2, employees: 40 }, (r) => !ids(r).includes("P03"));
t("Tier-1 busy office can get 1 Gbps", { segment: "prof", tier: 1, employees: 20 }, (r) => ids(r).includes("P03"));
t("No GST: no WhatsApp API, explains why", { gstActive: false, needs: ["whatsapp"] }, (r) => !ids(r).includes("P15") && r.notes.some((n) => /GSTIN/.test(n)));
t("No GST: no SMS, telephony, firewall", { gstActive: false, segment: "prof", employees: 12, needs: ["calls", "security"] }, (r) => !ids(r).some((x) => ["P12", "P13", "P21"].includes(x)));
t("SD-WAN refused for 2 sites", { segment: "multi", sites: 2, employees: 30, needs: ["manage"] }, (r) => !ids(r).includes("P10"));
t("SD-WAN offered for 8 sites", { segment: "multi", sites: 8, employees: 45, needs: ["manage"] }, (r) => ids(r).includes("P10"));
t("No fibre at address → AirFiber, no failover/static IP", { fibre: false, needs: ["backup", "cctv"] }, (r) => ids(r).includes("P04") && !ids(r).includes("P09"));
t("Manufacturer 30 staff → 100 Mbps leased line", { segment: "mfg", employees: 30, needs: ["machines"] }, (r) => ids(r).includes("P06") && ids(r).includes("P24"));
t("Small manufacturer 6 staff: no machine IoT", { segment: "mfg", employees: 6, needs: ["machines"] }, (r) => !ids(r).includes("P24"));
t("Kirana: lean bundle, owner SIM", { segment: "micro", employees: 2, needs: ["payments"] }, (r) => ids(r).includes("P01") && ids(r).includes("P07") && r.items.length <= 4);
t("Multi-site gets one line per site", { segment: "multi", sites: 5, employees: 30 }, (r) => r.items.find((i) => i.id === "P02")?.qty === 5);
t("Firewall needs 10+ staff", { segment: "prof", employees: 6, needs: ["security"] }, (r) => !ids(r).includes("P21"));
t("Empty needs → peer-based defaults", { segment: "prof", employees: 8 }, (r) => r.items.length >= 3);
const q = e.quote(e.recommend({ ...base, segment: "prof", employees: 8, needs: ["email", "security", "storage"] }).items, { ...base, spend: 9000 });
console.log(q.total > 0 && q.saving !== null ? "PASS" : "FAIL", "Quote: one monthly price", q.total, "saving vs today", q.saving);
process.exit(fail ? 1 : 0);
