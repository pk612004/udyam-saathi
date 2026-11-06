import { Engine, NEEDS, TODAY, inr, fmtDate } from "./engine.js";
import { Registry, validate, gstinCandidates, gstinFormatOk } from "./kyc.js";
import * as svc from "./services.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (g) => (g && g.length === 15 ? g.slice(0, 6) + "•••••" + g.slice(11) : g);
const load = (f) => fetch(`data/${f}`).then((r) => r.json());

let D, engine, reg, sample = null;
const S = { lang: "en", step: "welcome", p: null, bundle: null, quote: null, off: new Set(), emi: false, kyc: null, history: [], t0: 0, busy: false };

// strings
const T = {
  en: {
    hello: "Get your shop online today",
    sub: "Internet, business SIMs, billing, WhatsApp and CCTV on one plan and one bill. Set it all up from this phone in a few minutes.",
    cont: "Continue with this number",
    trust: "We check your number with Airtel's network. No OTP, nothing stored.",
    verified: (n) => `Verified ${n} ✓. Let's find the right plan. Do you have a GSTIN? Type it and I'll fill in the rest.`,
    noGst: "No GST yet",
    found: (b, c) => `Found it: ${b}, ${c}. Is that right?`,
    yes: "Yes, that's us", no: "No, let me type it",
    cancelled: "Your GSTIN shows as cancelled in the GST registry. No problem: I'll suggest products that don't need GST, and you can add the rest once it's active.",
    askType: "What kind of business is it?",
    askCity: "Which city are you in?",
    askEmp: "How many people work there, including you?",
    askSites: "How many shops, branches or offices?",
    askNet: "What internet do you use today?",
    askSpend: "Roughly what do you pay every month for phone and internet, all together?",
    askNeeds: "What do you need help with? Pick all that apply.",
    done: "Show my plan",
    checking: "Checking fibre at your address…",
    bundleTitle: "Your plan",
    peers: (s) => `${Math.round(s * 100)}% of businesses like yours chose this`,
    seePrice: "See my monthly price",
    notGst: "Not registered for GST",
  },
  hi: {
    hello: "आज ही अपनी दुकान ऑनलाइन करें",
    sub: "इंटरनेट, बिज़नेस सिम, बिलिंग, WhatsApp, CCTV. एक प्लान, एक बिल, इसी फ़ोन से.",
    cont: "इसी नंबर से आगे बढ़ें",
    trust: "हम आपका नंबर Airtel नेटवर्क से जाँचते हैं. कोई OTP नहीं, कुछ सेव नहीं होता.",
    verified: (n) => `${n} वेरिफ़ाई हो गया ✓. सही प्लान ढूँढते हैं. क्या आपके पास GSTIN है? लिखिए, बाकी मैं भर दूँगा.`,
    noGst: "अभी GST नहीं है",
    found: (b, c) => `मिल गया: ${b}, ${c}. क्या यह सही है?`,
    yes: "हाँ, यही है", no: "नहीं, मैं लिखता हूँ",
    cancelled: "GST रजिस्ट्री में आपका GSTIN रद्द दिख रहा है. कोई बात नहीं: मैं ऐसे प्रोडक्ट सुझाऊँगा जिनमें GST ज़रूरी नहीं, बाकी GST चालू होने पर जोड़ लेंगे.",
    askType: "आपका बिज़नेस किस तरह का है?",
    askCity: "आप किस शहर में हैं?",
    askEmp: "आपको मिलाकर कितने लोग काम करते हैं?",
    askSites: "कितनी दुकानें, ब्रांच या ऑफ़िस हैं?",
    askNet: "अभी कौन सा इंटरनेट इस्तेमाल करते हैं?",
    askSpend: "फ़ोन और इंटरनेट पर हर महीने कुल कितना खर्च होता है?",
    askNeeds: "किन चीज़ों में मदद चाहिए? जितने चाहें चुनें.",
    done: "मेरा प्लान दिखाएँ",
    checking: "आपके पते पर फ़ाइबर चेक कर रहे हैं…",
    bundleTitle: "आपका प्लान",
    peers: (s) => `आप जैसे ${Math.round(s * 100)}% बिज़नेस ने यह लिया`,
    seePrice: "मेरा मासिक खर्च देखें",
    notGst: "GST रजिस्टर्ड नहीं",
  },
};
const t = (k, ...a) => { const v = T[S.lang][k] ?? T.en[k]; return typeof v === "function" ? v(...a) : v; };

const TYPE_CHIPS = ["Kirana store", "Pharmacy", "Salon", "Bakery", "Mobile repair shop", "Dental clinic", "CA firm", "Travel agency", "Coaching centre", "Diagnostic lab", "Restaurant chain", "Pharmacy chain", "Gym chain", "Textile unit", "Auto-parts unit", "Printing press"];
const SEG_NAME = { micro: "a small shop", prof: "a professional office", multi: "a multi-site business", mfg: "a manufacturer" };
const EMP = [["Just me / 1–2", 2], ["3–9", 6], ["10–24", 15], ["25–99", 45], ["100+", 120]];
const SITES = [["1", 1], ["2", 2], ["3–5", 4], ["6–10", 8], ["11+", 12]];
const NET = ["Phone hotspot", "Home broadband", "Business broadband", "Leased line", "Different per site"];
const SPEND = [["Under ₹1,000", 800], ["₹1–3k", 2000], ["₹3–7k", 5000], ["₹7–15k", 10000], ["₹15k+", 20000]];

// activity feed
const ICON = {
  API: '<path d="M11 4a7 7 0 1 0 4.4 12.4l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>',
  RULE: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/>',
  AI: '<path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Zm6 12 .9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14Z"/>',
  DATA: '<path d="M5 20V10h3v10H5Zm5.5 0V4h3v16h-3ZM16 20v-7h3v7h-3Z"/>',
  PRIVACY: '<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm0 5a3 3 0 0 1 3 3v1h1v6H8v-6h1v-1a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v1h2v-1a1 1 0 0 0-1-1Z"/>',
  RISK: '<path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1 5h2v6h-2V7Zm0 8h2v2h-2v-2Z"/>',
};
const STATUS = { ok: "Done", warn: "Check", bad: "Stopped" };
function emptyRegister() {
  const legend = [["API", "Lookup"], ["RULE", "Rule"], ["AI", "AI"], ["PRIVACY", "Privacy"], ["RISK", "Fraud check"], ["DATA", "Data"]]
    .map(([k, l]) => `<span class="lg"><span class="ic ${k}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[k]}</svg></span>${l}</span>`).join("");
  const ghosts = Array.from({ length: 6 }, (_, i) => `<div class="skel-row" style="--i:${i}"><i></i><div><b></b><b></b></div><u></u></div>`).join("");
  $("#log").innerHTML = `<div class="empty"><div class="radar"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON.API}</svg></div><b>Waiting for a sign-up</b>Every lookup and check shows up here, live, as the owner taps through.<div class="legend">${legend}</div></div><div class="ghosts" aria-hidden="true">${ghosts}</div>`;
}
function log(kind, title, detail = "", cls = "") {
  const el = $("#log");
  if (el.querySelector(".empty")) el.innerHTML = "";
  const ms = ((performance.now() - S.t0) / 1000).toFixed(1);
  el.insertAdjacentHTML("beforeend", `<div class="act-row"><span class="ic ${kind}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[kind] || ICON.DATA}</svg></span><div><b>${esc(title)}</b>${detail ? `<span class="d">${esc(detail)}</span>` : ""}<span class="t num">${ms}s</span></div><span class="st ${cls || "none"}">${STATUS[cls] || "Noted"}</span></div>`);
  el.scrollTop = el.scrollHeight;
}
const STEPS = { welcome: [0, "Start"], gst: [1, "Step 1 of 6: Verify"], needs: [2, "Step 2 of 6: Your business"], bundle: [3, "Step 3 of 6: Your plan"], quote: [3, "Step 3 of 6: Your plan"], consent: [4, "Step 4 of 6: Verify business"], kyc: [4, "Step 4 of 6: Verify business"], pay: [5, "Step 5 of 6: Payment"], track: [6, "Step 6 of 6: Live"] };
function setProg() {
  const [n, label] = STEPS[S.step] || [0, ""];
  document.querySelectorAll("#progBar i").forEach((el, i) => el.classList.toggle("on", i < n));
  $("#progLabel").textContent = label;
}

// phone helpers
const ph = () => $("#ph");
function bot(html, raw = false) {
  ph().insertAdjacentHTML("beforeend", `<div class="msg bot">${raw ? html : esc(html)}</div>`);
  scroll();
}
function me(text) { ph().insertAdjacentHTML("beforeend", `<div class="msg me">${esc(text)}</div>`); scroll(); }
function card(html) { const d = document.createElement("div"); d.className = "cardwrap"; d.innerHTML = html; ph().appendChild(d); scroll(); return d; }
function scroll() { const b = ph(); requestAnimationFrame(() => (b.scrollTop = b.scrollHeight)); }
function chips(options, onPick, { multi = false, doneLabel } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "chips";
  const sel = new Set();
  options.forEach(([label, val]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = label; b.setAttribute("aria-pressed", "false");
    b.onclick = () => {
      if (multi) { sel.has(val) ? sel.delete(val) : sel.add(val); b.setAttribute("aria-pressed", sel.has(val)); return; }
      wrap.remove(); me(label); onPick(val, label);
    };
    wrap.appendChild(b);
  });
  if (multi) {
    const d = document.createElement("button");
    d.type = "button"; d.className = "chip primary"; d.textContent = doneLabel || t("done");
    d.onclick = () => { wrap.remove(); const labels = options.filter(([, v]) => sel.has(v)).map(([l]) => l); me(labels.join(", ") || "Not sure, suggest for me"); onPick([...sel]); };
    wrap.appendChild(d);
  }
  ph().appendChild(wrap); scroll();
  return wrap;
}
async function typing(ms = 450) {
  ph().insertAdjacentHTML("beforeend", `<div class="msg bot typing" id="typing"><span class="dots"><i></i><i></i><i></i></span></div>`); scroll();
  await sleep(ms); $("#typing")?.remove();
}

// journey
function newProfile() {
  return { name: "", legal: "", gstin: null, gstActive: false, constitution: "", type: "", segment: "micro", city: "", state: "", tier: 2, pincode: "", employees: 0, sites: 0, net: "", spend: 0, needs: [], fibre: null, lang: S.lang };
}
function resetJourney() {
  S.p = newProfile(); S.bundle = null; S.quote = null; S.off = new Set(); S.emi = false; S.kyc = null; S.history = [];
  S.t0 = performance.now(); S.step = "welcome"; setProg();
  $("#phStatusText").textContent = sample || svc.MODE.ai ? "AI advisor online" : "Business sign-up";
  emptyRegister();
  const feats = S.lang === "hi" ? ["इंटरनेट", "बिज़नेस सिम", "बिलिंग", "WhatsApp", "CCTV"] : ["Internet", "Business SIMs", "Billing", "WhatsApp", "CCTV"];
  ph().innerHTML = `<div class="welcome">
    <div class="w-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16l1.5 5a3 3 0 0 1-2.5 3.4V20H5v-7.6A3 3 0 0 1 2.5 9L4 4Zm2.6 9V18h4v-4h2.8v4h4v-5a3.1 3.1 0 0 1-2.2-1 3.2 3.2 0 0 1-2.2 1 3.2 3.2 0 0 1-2.2-1 3.1 3.1 0 0 1-2.2 1Z"/></svg></div>
    <p class="w-hi">${S.lang === "hi" ? "नमस्ते 🙏" : "Namaste 🙏"}</p>
    <h2>${esc(t("hello"))}</h2>
    <p class="w-sub">${esc(t("sub"))}</p>
    <div class="w-feats">${feats.map((f) => `<span>${esc(f)}</span>`).join("")}</div>
    <button class="btn" id="go">${esc(t("cont"))}</button>
    <p class="trust"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>${esc(t("trust"))}</p>
  </div>`;
  $("#go").onclick = () => startAuth();
}

async function startAuth() {
  S.t0 = performance.now(); $("#log").innerHTML = "";
  $("#go")?.closest(".welcome")?.remove();
  log("API", "Number confirmed by Airtel’s network", "The SIM in this phone matches the number, so no OTP is needed (Airtel IQ Silent Auth)", "ok");
  log("RISK", "No recent SIM swap", "The SIM hasn’t changed in 10 days. A fresh swap is a common sign of fraud", "ok");
  log("API", "Already an Airtel customer", "Prepaid mobile since 2019. Leads like this sign up at 9%, against 5% for local-ISP users", "ok");
  log("PRIVACY", "Phone number masked", "Kept as 98•••••410. The full number never reaches the logs");
  await typing();
  bot(t("verified", "98•••••410"));
  askGst();
}

function askGst() {
  S.step = "gst"; setProg();
  const f = card(`<form class="field" id="gstForm"><input id="gstIn" maxlength="15" placeholder="e.g. 27XUIXG0767D1ZP" aria-label="GSTIN"><button class="chip primary" type="submit">Look up</button></form>`);
  $("#gstForm", f).onsubmit = (e) => { e.preventDefault(); const v = $("#gstIn", f).value.trim(); if (v) { f.remove(); onGst(v); } };
  chips([[t("noGst"), "none"]], () => { f.remove(); noGst(); });
}

async function onGst(raw, quiet = false) {
  if (!quiet) me(raw);
  const g = raw.toUpperCase().replace(/\s/g, "");
  const cand = gstinCandidates(g).filter(gstinFormatOk).find((c) => reg.gst[c]);
  if (!gstinFormatOk(g) && !cand) {
    log("RULE", "GSTIN doesn’t add up", `${mask(g)} fails the check-digit test`, "bad");
    await typing();
    bot("That GSTIN doesn't look right. The last character is a check digit, so even one wrong letter shows up. Please check and type it again.");
    $(".chips")?.remove(); askGst(); return;
  }
  const gstin = cand || g;
  log("RULE", "GSTIN is well-formed", `${mask(gstin)} passes the check-digit test`, "ok");
  const rec = reg.gst[gstin];
  if (!rec) {
    log("API", "Not in the GST registry", "Continuing without GST", "bad");
    await typing(); bot("I couldn't find that GSTIN. Let's continue without it for now."); noGst(); return;
  }
  const [legal, trade, constitution, address, state, , status] = rec;
  const city = (address.match(/,\s*([A-Za-z ]+),\s*[A-Za-z ]+\s*-\s*\d{6}$/) || [])[1]?.trim() || "";
  const pin = (address.match(/(\d{6})$/) || [])[1] || "";
  log("API", status === "Active" ? "Found in the GST registry" : `GSTIN is ${status.toLowerCase()}`, `${trade}, ${constitution.toLowerCase()} in ${city}, ${state}. Registry status: ${status}`, status === "Active" ? "ok" : "bad");
  Object.assign(S.p, { gstin, name: trade, legal, constitution, city, state, pincode: pin, tier: D.ref.cities[city] ?? 2, gstActive: status === "Active" });
  log("DATA", `${city} is a tier-${S.p.tier} city`, "Decides which products can be sold here");
  const u = reg.findUdyamByState(trade, state);
  if (u) {
    const nic = u[1][3];
    const seg = engine.segmentOf(nic);
    Object.assign(S.p, { type: nic, segment: seg, udyam: u[0] });
    log("API", "Found in the Udyam registry", `Registered as “${nic}”, so the advisor treats it as ${SEG_NAME[seg]}`, "ok");
  }
  if (S.p.tier === 2) log("RULE", "1 Gbps fibre ruled out", "It isn’t sold in tier-2 cities, so the advisor won’t offer it");
  await typing();
  bot(t("found", trade + (S.p.type ? ` (${S.p.type.toLowerCase()})` : ""), city));
  chips([[t("yes"), true], [t("no"), false]], async (ok) => {
    if (!ok) { Object.assign(S.p, newProfile()); askGst(); return; }
    S.p.gstConfirmed = true;
    if (!S.p.gstActive) { log("RULE", "GST-only products left out", "We drop the products, not the customer", "warn"); await typing(); bot(t("cancelled")); }
    if (!S.p.type) askType(); else askEmp();
  });
}

// owner says "no GST" after typing one but before confirming it: drop the match, don't sell to the wrong business
function dropGstMatch(p) {
  p.gstActive = false;
  if (!p.gstin || p.gstConfirmed) return;
  log("RULE", "GSTIN match dropped", `Owner says no GST, so ${p.name} isn't treated as their business`, "warn");
  if (p.udyam) Object.assign(p, { type: "", segment: "micro" });  // type came from that business's Udyam record
  Object.assign(p, { gstin: null, name: "", legal: "", constitution: "", udyam: null });
  $(".chips")?.remove();
}

function setOtherCity(p, name) {
  Object.assign(p, { city: name, tier: 2, state: "", pincode: "" });
  log("DATA", `${name} isn't in our city table`, "Treated as tier-2, so only products sold everywhere are offered", "warn");
}

async function noGst() {
  S.p.gstActive = false;
  log("RULE", "No GSTIN, so GST-only products are left out", "Today these leads sign up at 2% against 9.6% with GST. We keep them with a plan that doesn’t need it", "warn");
  await typing(); askType();
}

function askType() {
  bot(t("askType"));
  const opts = TYPE_CHIPS.map((x) => [x, x]);
  chips(opts, (v) => { S.p.type = v; S.p.segment = engine.segmentOf(v); log("DATA", `Treated as ${SEG_NAME[S.p.segment]}`, `Business type: ${v}`); S.p.city ? askEmp() : askCity(); });
}
function askCity() {
  bot(t("askCity"));
  chips(Object.keys(D.ref.cities).sort().map((c) => [c, c]), (c) => {
    Object.assign(S.p, { city: c, tier: D.ref.cities[c], state: D.ref.cityState[c] });
    log("DATA", `${c} is a tier-${S.p.tier} city`, "Decides which products can be sold here"); askEmp();
  });
}
function askEmp() { bot(t("askEmp")); chips(EMP, (v) => { S.p.employees = v; askSites(); }); }
function askSites() {
  if (S.p.segment === "micro") { S.p.sites = 1; return askNet(); }
  bot(t("askSites")); chips(SITES, (v) => { S.p.sites = v; if (v > 1 && S.p.segment !== "multi") { S.p.segment = "multi"; log("DATA", `Treated as ${SEG_NAME.multi}`, "More than one site"); } askNet(); });
}
function askNet() { bot(t("askNet")); chips(NET.map((n) => [n, n]), (v) => { S.p.net = v; askSpend(); }); }
function askSpend() { bot(t("askSpend")); chips(SPEND, (v) => { S.p.spend = v; askNeeds(); }); }
function askNeeds() {
  S.step = "needs"; setProg();
  bot(t("askNeeds"));
  const rel = NEEDS.filter((n) => !(["manage"].includes(n.id) && S.p.sites < 3) && !(["machines"].includes(n.id) && S.p.segment !== "mfg") && !(n.id === "fleet" && S.p.segment === "prof"));
  chips(rel.map((n) => [n[S.lang] || n.en, n.id]), (v) => { S.p.needs = v; showBundle(); }, { multi: true });
}

async function feasibility() {
  if (S.p.fibre !== null) return;
  await typing(250);
  const pin = S.p.pincode;
  const f = await svc.fibreFeasible(pin);
  S.p.fibre = f === null ? true : f;
  log("API", pin ? (S.p.fibre ? `Fibre reaches PIN ${pin}` : `No fibre at PIN ${pin} yet`) : "Fibre to be confirmed on site", pin ? (S.p.fibre ? "Checked against the network map before quoting" : "5G AirFiber goes in the plan instead, live in 2 days") : "5G AirFiber is the fallback if it isn’t there", S.p.fibre ? "ok" : "warn");
}

async function showBundle() {
  await feasibility();
  const r = engine.recommend(S.p);
  S.bundle = r.items; S.notes = r.notes;
  log("RULE", `Plan built: ${r.items.length} products`, "Each one checked against city tier, staff size, number of sites, GST and what it needs to work", "ok");
  r.dropped.forEach((d) => log("RULE", `Left out: ${engine.cat[d.id].name}`, d.problems.join("; "), "warn"));
  renderBundle(r);
}

function renderBundle(r) {
  S.step = "bundle"; setProg();
  const rows = r.items.map((i) => {
    const c = engine.cat[i.id];
    const peer = engine.peerShare(S.p, i.id);
    return `<div class="item"><b>${esc(c.name)}${i.qty > 1 ? ` × ${i.qty}` : ""}</b><span class="p num">${inr(c.pmin * i.qty)}</span>
      <span class="why">${esc(i.why)}</span>${peer && peer >= 0.5 && peer < 1 ? `<span class="peer">${esc(t("peers", peer))}</span>` : ""}</div>`;
  }).join("");
  const notes = (S.notes || []).map((n) => `<div class="note">${esc(n)}</div>`).join("");
  const c = card(`<div class="msg bot" style="max-width:100%"><h3 style="margin:2px 0 4px">${esc(t("bundleTitle"))}: ${esc(S.p.name || S.p.type)}</h3>${rows}${notes}<button class="btn">${esc(t("seePrice"))}</button></div>`);
  $(".btn", c).onclick = () => { $(".btn", c).remove(); renderQuote(); };
}

function renderQuote() {
  S.step = "quote"; setProg();
  const items = S.bundle.filter((i) => !S.off.has(i.id));
  const q = engine.quote(items, S.p);
  S.quote = q;
  log("RULE", `Monthly price: ${inr(q.total)}`, `${q.discount ? `After a ${inr(q.discount)} bundle saving. ` : ""}Setup ${inr(q.setup)}, ${q.contract}-month term. Every price comes from the catalogue`, "ok");
  const base = S.bundle[0].id;
  const tog = S.bundle.map((i) => {
    const c = engine.cat[i.id];
    const locked = i.id === base;
    return `<label class="toggle"><input type="checkbox" data-id="${i.id}" ${S.off.has(i.id) ? "" : "checked"} ${locked ? "disabled" : ""}><span>${esc(c.name)}${i.qty > 1 ? ` × ${i.qty}` : ""}${locked ? " (base)" : ""}</span><b class="num">${inr(c.pmin * i.qty)}</b></label>`;
  }).join("");
  const saving = q.saving !== null ? (q.saving >= 0
    ? `<div class="save">That's ${inr(q.saving)} a month less than the ${inr(S.p.spend)} you pay today, with everything on one bill.</div>`
    : `<div class="save" style="background:var(--blue-soft);color:var(--blue)">${inr(-q.saving)} more than your phone and internet today. ${inr(q.lines.filter((l) => l.cat !== "Connectivity").reduce((s, l) => s + l.monthly, 0))} of it is email, security, billing and other tools you'd otherwise buy from separate vendors. Now it's one bill and one support number.</div>`) : "";
  const c = card(`<div class="msg bot" style="max-width:100%" id="quoteCard"><h3 style="margin:2px 0 6px">Your monthly price</h3>
    ${tog}
    <div class="row"><span>Subtotal</span><span class="num">${inr(q.monthly)}</span></div>
    ${q.discount ? `<div class="row"><span>Bundle saving (10%)</span><span class="num">−${inr(q.discount)}</span></div>` : ""}
    <div class="total"><span>Every month</span><b class="num">${inr(q.total)}</b></div>
    <div class="row"><span>One-time setup</span><span class="num">${inr(q.setup)}</span></div>
    ${q.emi ? `<label class="toggle"><input type="checkbox" id="emi" ${S.emi ? "checked" : ""}><span>Pay setup as 6 × ${inr(q.emi)} with Airtel Money</span></label>` : ""}
    <div class="row"><span>Minimum term</span><span>${q.contract} months</span></div>
    ${saving}<p class="trust" style="margin:4px 0 0">${esc(q.gstNote)}</p>
    <button class="btn">Looks good, continue</button></div>`);
  c.querySelectorAll("input[data-id]").forEach((x) => (x.onchange = () => {
    x.checked ? S.off.delete(x.dataset.id) : S.off.add(x.dataset.id);
    // dependency guard: switching off a base removes dependants
    log("RULE", `${engine.cat[x.dataset.id].name} ${x.checked ? "added back" : "removed"}`, "Plan re-checked and re-priced");
    c.remove(); renderQuote();
  }));
  countUp($(".total b", c));
  $("#emi", c)?.addEventListener("change", (e) => {
    S.emi = e.target.checked;
    if (S.emi) log("API", "Setup EMI approved by Airtel Money", S.p.gstActive ? "Based on GST filings the owner shared through Account Aggregator" : "Based on 7 years of on-time Airtel bills", "ok");
  });
  $(".btn", c).onclick = () => { $(".btn", c).remove(); c.querySelectorAll("input").forEach((i) => (i.disabled = true)); renderConsent(); };
}

function renderConsent() {
  S.step = "consent"; setProg();
  const c = card(`<div class="msg bot consent" style="max-width:100%"><h3 style="margin:2px 0">Before we verify your business</h3>
    <ul style="padding-left:18px;margin:6px 0">
      <li><b>What we fetch:</b> ${S.p.gstin ? "GST certificate, Udyam number, a recent bill, and the signatory's name" : "the owner's Aadhaar e-KYC and a recent electricity bill"}.</li>
      <li><b>Why:</b> only to verify your business for this order (telecom KYC rules).</li>
      <li><b>How long:</b> documents are deleted 30 days after activation; we keep only “verified” and the date.</li>
      <li><b>Your control:</b> withdraw consent any time from the app, as easily as you gave it.</li>
    </ul>
    <button class="btn">I agree, verify my business</button><button class="btn ghost">Not now, save my quote</button></div>`);
  log("PRIVACY", "Consent notice shown", "What we fetch, why, for how long, and how to withdraw. Record CNS-2607-0412");
  const [ok, later] = c.querySelectorAll(".btn");
  ok.onclick = () => { ok.remove(); later.remove(); log("PRIVACY", "Owner agreed", "For KYC on this order only. Documents deleted 30 days after activation", "ok"); renderKyc(); };
  later.onclick = () => { ok.remove(); later.remove(); bot("Saved. I'll send this quote on WhatsApp so you can pick up where you left off."); log("API", "Quote saved, reminder set on WhatsApp", "107 leads last quarter said “we’ll decide later” and never came back"); };
}

function kycDocsFor(p) {
  const hit = Object.entries(D.kycExt).find(([, docs]) => {
    const g = docs.gst_certificate?.fields?.gstin;
    return g && gstinCandidates(g).includes(p.gstin);
  });
  if (hit) return { id: hit[0], docs: hit[1], sample: true };
  // no specimen for this GSTIN: build the docs from the registry record
  const r = reg.gst[p.gstin];
  const prop = r[0].includes("(Prop.") ? r[0].split(" (Prop.")[0] : "Authorised Signatory";
  return { id: "EL", sample: false, docs: {
    gst_certificate: { readable: true, fields: { gstin: p.gstin, legal_name: r[0], trade_name: r[1], address: r[3] } },
    udyam_certificate: p.udyam ? { readable: true, fields: { udyam_number: p.udyam, enterprise_name: r[1] } } : undefined,
    address_proof: { readable: true, fields: { billed_to: r[1], address: r[3], bill_date: "2026-07-02" } },
    signatory_id: { readable: true, fields: { name: prop, business: r[1], valid_till: "2029-01-31" } },
  } };
}

async function renderKyc() {
  S.step = "kyc"; setProg();
  if (!S.p.gstin) {
    await typing();
    bot("No GST needed for your plan. I just need the owner's Aadhaar e-KYC and a recent electricity bill.");
    log("API", "Owner verified through DigiLocker", "Name and address fetched with consent", "ok");
    log("RULE", "Electricity bill is recent", "13 days old; the limit is 90", "ok");
    return renderPay();
  }
  await typing();
  bot("Fetching your documents from Entity Locker, so you don't have to upload anything…");
  const k = kycDocsFor(S.p);
  log("API", "Documents fetched from Entity Locker", `GST certificate${k.docs.udyam_certificate ? ", Udyam" : ""}, a recent bill and the signatory’s ID${k.sample ? `. Uses specimen ${k.id} from the data pack` : ""}`, "ok");
  await sleep(300);
  const res = validate(k.id, Object.fromEntries(Object.entries(k.docs).filter(([, v]) => v)), reg);
  S.kyc = res;
  res.checks.forEach((c) => log("RULE", c.label, c.detail + (c.action ? `. Next: ${c.action}` : ""), c.status === "pass" ? "ok" : c.status === "info" ? "" : c.status === "warn" ? "warn" : "bad"));
  const gstBlocked = res.checks.some((c) => c.id === "gst.status" && c.status === "block");
  const otherBlocks = res.checks.filter((c) => c.status === "block" && c.id !== "gst.status");
  const docs = Object.keys(k.docs).filter((x) => k.docs[x]).map((x) => {
    const label = { gst_certificate: "GST certificate", udyam_certificate: "Udyam registration", address_proof: "Electricity bill", signatory_id: "Signatory ID" }[x];
    return `<div class="doc-row">${k.sample ? `<img src="kyc/${k.id}_${x}.jpg" alt="">` : ""}<span style="flex:1">${label}</span><span class="tag pass">fetched</span></div>`;
  }).join("");
  if (otherBlocks.length) {
    card(`<div class="msg bot" style="max-width:100%"><h3 style="margin:2px 0">One thing to fix</h3>${docs}${otherBlocks.map((b) => `<div class="note">${esc(b.label)}: ${esc(b.action)}</div>`).join("")}<button class="btn">Fix it now</button></div>`);
    return;
  }
  const extra = gstBlocked ? `<div class="note">GST is cancelled, so your plan skips GST-only products. We'll add them when it's active again.</div>` : "";
  const c = card(`<div class="msg bot" style="max-width:100%"><h3 style="margin:2px 0">Business verified</h3>${docs}${extra}<p style="font-size:14px;color:var(--ink-2)">The signatory gets an e-sign link on WhatsApp. No visit, no photocopies.</p><button class="btn">Continue to payment</button></div>`);
  log("API", "E-sign link sent to the signatory", "On WhatsApp. 53 leads were lost last quarter waiting for a signatory", "ok");
  $(".btn", c).onclick = () => { $(".btn", c).remove(); renderPay(); };
}

function renderPay() {
  S.step = "pay"; setProg();
  const q = S.quote;
  const c = card(`<div class="msg bot" style="max-width:100%"><h3 style="margin:2px 0">Set up AutoPay</h3>
    <div class="row"><span>Monthly, from your UPI app</span><b class="num">${inr(q.total)}</b></div>
    <div class="row"><span>Setup today</span><b class="num">${S.emi && q.emi ? `${inr(q.emi)} (1 of 6)` : inr(q.setup)}</b></div>
    <p class="trust">One UPI AutoPay mandate. If a payment fails we retry and remind you on WhatsApp; your service is never cut on the first miss.</p>
    <button class="btn">Approve in UPI app</button></div>`);
  $(".btn", c).onclick = () => {
    $(".btn", c).remove();
    log("API", "UPI AutoPay set up", `Up to ${inr(q.total * 1.2)} a month`, "ok");
    log("RULE", "Order sent for installation", "Engineer slot reserved", "ok");
    renderTrack();
  };
}

function renderTrack() {
  S.step = "track"; setProg();
  const items = S.bundle.filter((i) => !S.off.has(i.id));
  const pr = engine.promise(items, S.p);
  log("RULE", `Promised live date: ${fmtDate(pr.liveBy)}`, `${pr.days} days, worked out from install times and engineer load${pr.bridge ? ". 5G AirFiber keeps them online from day 2" : ""}`, "ok");
  const tl = pr.steps.map((s) => `<li class="${s.done ? "done" : ""}">${esc(s.t)}<small>${fmtDate(s.date)}</small></li>`).join("");
  card(`<div class="msg bot" style="max-width:100%"><div class="done-check"><svg viewBox="0 0 46 46" aria-hidden="true"><circle cx="23" cy="23" r="23"/><path d="M14 23.5l6 6 12-13"/></svg><h3 style="margin:0">Order placed. You're live by ${fmtDate(pr.liveBy)}.</h3></div>
    <ul class="tl">${tl}</ul>
    <div class="wa"><b>WhatsApp, ${fmtDate(pr.steps[2].date)} 9:02 am</b><br>Ravi from Airtel will reach at 11 am. Track him live: airtel.in/t/4F2K</div>
    ${pr.bridge ? `<div class="wa"><b>WhatsApp, ${fmtDate(pr.steps.find((s) => s.t.startsWith("Day-1")).date)}</b><br>Your AirFiber is on. Fibre installation is booked for ${fmtDate(pr.liveBy)}; you're online until then.</div>` : ""}
    <p class="trust">Status updates come to you, so you never have to call us. Today, customers chase 3 times on average, and those who chase 5 times churn at 28%.</p></div>`);
  $("#phStatusText").textContent = "Order UD-26071542 is on track";
  const secs = ((performance.now() - S.t0) / 1000).toFixed(0);
  log("DATA", "Signed up", `${secs} seconds on the phone. No visit, no uploads, no calls`, "ok");
  confetti();
  const rows = [
    ["Lead to live", `${D.ins.kpis.days} days`, `${pr.days} day${pr.days > 1 ? "s" : ""}${pr.bridge ? ", online on day 2" : ""}`],
    ["Sales visits", "1–2", "0"],
    ["Papers collected", "4 photocopies", "0 uploads"],
    ["Calls asking “when?”", `${D.ins.kpis.calls}`, "0"],
    ["Quote arrives in", "3–5 days", `${secs} seconds`],
  ];
  $("#log").insertAdjacentHTML("beforeend", `<div class="compare"><h3>Today vs Udyam Saathi</h3><div class="cmp-grid"><span></span><span class="h">Today</span><span class="h">Udyam Saathi</span>${rows.map(([k, a, b]) => `<span>${k}</span><span class="old">${a}</span><span class="new">${b}</span>`).join("")}</div></div>`);
  setTimeout(() => ($("#log").scrollTop = $("#log").scrollHeight), 60);
}
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const host = $(".phone"); const box = document.createElement("div"); box.className = "confetti";
  const cols = ["#FF1F2D", "#FFB648", "#3EE09A", "#7AA8FF", "#BB98FF", "#FFFFFF"];
  box.innerHTML = Array.from({ length: 46 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${Math.random() * 0.5}s;animation-duration:${1.6 + Math.random() * 1.2}s;--r:${Math.random() * 720 - 360}deg;--x:${Math.random() * 80 - 40}px"></i>`).join("");
  host.appendChild(box); setTimeout(() => box.remove(), 3400);
}

// free text: AI advisor or keyword fallback
const KW = { payments: /upi|bill|pos|payment|counter|बिल|पेमेंट/i, whatsapp: /whats ?app|व्हाट्सएप/i, cctv: /cctv|camera|कैमरा/i, wifi: /wi-?fi|guest|वाईफाई/i, email: /email|mail|office|docs/i, security: /secur|virus|ransom|सुरक्षा/i, backup: /backup internet|never.*offline|failover|down/i, calls: /ivr|phone line|landline|call centre|toll/i, website: /website|site|वेबसाइट/i, storage: /storage|cloud backup|files/i, manage: /branches|sd-?wan|central/i, machines: /machine|plant|iot/i, fleet: /vehicle|fleet|truck|gps|गाड़ी/i };

async function onFree(text) {
  me(text);
  const g = text.toUpperCase().match(/\b\d{2}[A-Z0-9]{13}\b/);
  if (g && ["welcome", "gst"].includes(S.step)) { $(".cardwrap:last-child")?.remove(); $(".chips")?.remove(); if (S.step === "welcome") await startAuth(); return onGst(g[0], true); }
  if (S.step === "welcome") { const mine = ph().lastElementChild; await startAuth(); ph().appendChild(mine); }  // typing on the welcome screen = "Continue"
  if (sample) return aiTurn(text);
  if (svc.MODE.ai) return apiTurn(text);
  const found = Object.entries(KW).filter(([, re]) => re.test(text)).map(([k]) => k);
  const n = text.match(/(\d+)\s*(people|staff|employees|log|लोग)/i);
  if (n) S.p && (S.p.employees = +n[1]);
  if (found.length && S.p) {
    S.p.needs = [...new Set([...(S.p.needs || []), ...found])];
    log("DATA", "Needs picked up from the message", found.map((f) => NEEDS.find((x) => x.id === f).en).join(", "));
    await typing(); bot(`Got it: ${found.map((f) => NEEDS.find((x) => x.id === f).en.toLowerCase()).join(", ")}. I'll include that.`);
    if (S.step === "needs" || S.step === "bundle") { $(".chips")?.remove(); showBundle(); }
  } else { await typing(); bot("I can help with internet, business SIMs, billing, WhatsApp, CCTV, email and security. Tap an option above, or tell me what you need."); }
}

function aiTools() {
  return [
    { name: "lookup_gstin", description: "Look up a GSTIN in the GST registry. Returns legal name, trade name, city, state, status.", inputSchema: { type: "object", properties: { gstin: { type: "string" } }, required: ["gstin"] },
      execute: ({ gstin }) => { const c = gstinCandidates(gstin.toUpperCase()).filter(gstinFormatOk).find((x) => reg.gst[x]); log("AI", "Tool call: lookup_gstin", mask(gstin)); if (!c) return { found: false }; const r = reg.gst[c]; return { found: true, gstin: c, legal: r[0], trade: r[1], address: r[3], state: r[4], status: r[6] }; } },
    { name: "update_profile", description: "Save facts the owner told you. Only include fields you learned.", inputSchema: { type: "object", properties: {
        business_type: { type: "string", description: "One of: " + Object.values(D.ref.businessTypes).flat().join(", ") },
        city: { type: "string", description: "One of: " + Object.keys(D.ref.cities).join(", ") },
        employees: { type: "integer" }, sites: { type: "integer" }, monthly_spend_inr: { type: "integer" }, has_active_gstin: { type: "boolean" },
        needs: { type: "array", items: { type: "string", enum: NEEDS.map((n) => n.id) } } } },
      execute: (a) => {
        const p = S.p;
        if (a.business_type) { p.type = a.business_type; p.segment = engine.segmentOf(a.business_type); }
        if (a.city && D.ref.cities[a.city]) { p.city = a.city; p.tier = D.ref.cities[a.city]; p.state = D.ref.cityState[a.city]; }
        if (a.employees) p.employees = a.employees; if (a.sites) { p.sites = a.sites; if (a.sites > 1 && p.segment !== "mfg") p.segment = "multi"; }
        if (a.monthly_spend_inr) p.spend = a.monthly_spend_inr; if (a.has_active_gstin === false) dropGstMatch(p);
        if (a.needs) p.needs = [...new Set([...(p.needs || []), ...a.needs])];
        log("AI", "Tool call: update_profile", JSON.stringify(a));
        const missing = ["type", "city", "employees"].filter((k) => !p[k]);
        return { saved: true, missing, profile: { type: p.type, segment: p.segment, city: p.city, tier: p.tier, employees: p.employees, sites: p.sites || 1, gst_active: p.gstActive, needs: p.needs } };
      } },
    { name: "recommend_bundle", description: "Build the eligible bundle with the rules engine. Never quote products or prices that are not in this result.", inputSchema: { type: "object", properties: {} },
      execute: () => {
        if (!S.p.sites) S.p.sites = 1; if (!S.p.employees) S.p.employees = 2;
        const r = engine.recommend(S.p); S.pendingBundle = r;
        log("AI", "Tool call: recommend_bundle", `${r.items.length} items, ${r.notes.length} notes`);
        return { items: r.items.map((i) => ({ product: engine.cat[i.id].name, qty: i.qty, monthly_inr: engine.cat[i.id].pmin * i.qty, why: i.why })), not_possible: r.notes };
      } },
  ];
}

// advisor via server/app.py
async function apiTurn(text) {
  if (!S.p) S.p = newProfile();
  S.history.push({ role: "user", content: text });
  ph().insertAdjacentHTML("beforeend", `<div class="msg bot typing" id="aiTyping"><span class="dots"><i></i><i></i><i></i></span></div>`); scroll();
  log("AI", "Advisor turn (server)", `Owner: “${text.slice(0, 80)}”`);
  try {
    const p = S.p;
    const { reply, updates: u } = await svc.advisorTurn(S.history, { business_name: p.name, type: p.type, city: p.city, employees: p.employees, sites: p.sites, monthly_spend_inr: p.spend, gstin_on_file: !!p.gstin, gst_active: p.gstActive, needs: p.needs });
    $("#aiTyping")?.remove(); bot(reply); S.history.push({ role: "assistant", content: reply });
    if (Object.keys(u).length) log("AI", "Understood (checked by server)", JSON.stringify(u));
    if (u.gstin && !p.gstin) await onGst(u.gstin, true);
    if (u.business_type) { p.type = u.business_type; p.segment = engine.segmentOf(u.business_type); }
    if (u.city) Object.assign(p, { city: u.city, tier: D.ref.cities[u.city], state: D.ref.cityState[u.city] });
    if (u.city_other) setOtherCity(p, u.city_other);
    if (u.employees) p.employees = u.employees;
    if (u.sites) { p.sites = u.sites; if (u.sites > 1 && p.segment !== "mfg") p.segment = "multi"; }
    if (u.monthly_spend_inr) p.spend = u.monthly_spend_inr;
    if (u.has_active_gstin === false) dropGstMatch(p);
    if (u.needs?.length) p.needs = [...new Set([...(p.needs || []), ...u.needs])];
    if (p.type && p.city && p.needs?.length && !S.bundle) { p.sites ||= 1; p.employees ||= 2; $(".chips")?.remove(); await showBundle(); }
  } catch (e) {
    $("#aiTyping")?.remove();
    log("AI", "AI unavailable, switched to guided mode", String(e.code || e.message), "warn");
    if (e.code === 503) { svc.MODE.ai = false; setBadge(); }
    bot("Let me help you with a few quick taps instead.");
  }
}

async function aiTurn(text) {
  if (!S.p) S.p = newProfile();
  S.history.push({ role: "user", content: text });
  const sys = `You are Udyam Saathi, Airtel Business's onboarding advisor for small Indian businesses, chatting on WhatsApp-style mobile UI.
Rules: reply in the same language and script the owner uses (Hindi, Hinglish, Tamil, etc.). Max 3 short sentences, warm, plain words, no product codes, no markdown.
Collect business type, city, employees, number of sites and needs. Call update_profile whenever you learn something. If they give a GSTIN, call lookup_gstin.
When you know type, city and at least one need, call recommend_bundle and summarise it in one or two sentences; the app shows the full plan card. Never invent products, prices or discounts: only use tool results. If something is not possible, say why kindly and give the alternative from the tool.
Current profile: ${JSON.stringify({ business_name: S.p.name, type: S.p.type, city: S.p.city, employees: S.p.employees, sites: S.p.sites, monthly_spend_inr: S.p.spend, gstin_on_file: !!S.p.gstin, gst_active: S.p.gstActive, needs: S.p.needs })}
Never ask again for anything already in the current profile.`;
  const msgs = [{ role: "user", content: sys + "\n\nConversation so far:\n" + S.history.slice(-10).map((m) => `${m.role === "user" ? "Owner" : "Saathi"}: ${m.content}`).join("\n") + "\n\nReply as Saathi to the owner's last message." }];
  ph().insertAdjacentHTML("beforeend", `<div class="msg bot typing" id="aiTyping"><span class="dots"><i></i><i></i><i></i></span></div>`); scroll();
  log("AI", "AI advisor turn", `Owner: “${text.slice(0, 80)}”`);
  S.pendingBundle = null;
  try {
    const res = await sample(msgs, { tools: aiTools(), cache: false, onText: ({ text: tx }) => { const el = $("#aiTyping"); if (el && tx) { el.classList.remove("typing"); el.textContent = tx; scroll(); } } });
    const el = $("#aiTyping"); if (el) { el.removeAttribute("id"); el.classList.remove("typing"); el.textContent = res.text; }
    S.history.push({ role: "assistant", content: res.text });
    if (S.pendingBundle) { $(".chips")?.remove(); S.bundle = S.pendingBundle.items; S.notes = S.pendingBundle.notes; log("RULE", "Rules engine validated AI's bundle", "Final gate passed: every product eligible ✓", "ok"); renderBundle(S.pendingBundle); }
  } catch (e) {
    $("#aiTyping")?.remove();
    log("AI", "AI unavailable, switched to guided mode", e?.code || e?.message || "", "warn");
    if (e?.code === "not_granted") { sample = null; setBadge(); }
    bot("Let me help you with a few quick taps instead.");
  }
}

// demo presets (owner taps, scripted)
const PRESETS = [
  { label: "Ramesh’s kirana", sub: "Ludhiana, no GST", color: "red", gst: null, type: "Kirana store", city: "Ludhiana", emp: 2, net: "Phone hotspot", spend: 1350, needs: ["payments", "whatsapp", "cctv"] },
  { label: "Harmony Dental", sub: "Clinic in Kolkata", color: "blue", gst: "19EOGXH4115Y1ZL", emp: 6, sites: 1, net: "Home broadband", spend: 3000, needs: ["email", "security", "storage", "calls"] },
  { label: "Ganesh Woodcraft", sub: "Furniture unit, Nagpur", color: "amber", gst: "27XUIXG0767D1ZP", emp: 15, sites: 1, net: "Business broadband", spend: 5000, needs: ["machines", "cctv", "security", "backup"] },
  { label: "Navkar Kitchens", sub: "8 restaurants, Mumbai", color: "green", gst: "27DIDXN3795G1ZF", emp: 45, sites: 8, net: "Different per site", spend: 10000, needs: ["payments", "cctv", "wifi", "manage", "backup"] },
  { label: "Vindhya Tours", sub: "GST cancelled", color: "violet", gst: "37IHKXV5167L1ZS", type: "Travel agency", emp: 6, sites: 1, net: "Mobile hotspot", spend: 2000, needs: ["whatsapp", "email", "website"] },
];
async function runPreset(pr) {
  if (S.busy) return; S.busy = true;
  S.lang = $("#lang").value || "en";
  resetJourney(); await sleep(300);
  const clickChip = async (match) => { await sleep(650); const b = [...ph().querySelectorAll(".chips .chip")].find((x) => match(x)); b?.click(); await sleep(200); };
  await startAuth(); await sleep(500);
  if (pr.gst) { const f = $("#gstIn"); f.value = pr.gst; await sleep(500); $("#gstForm").requestSubmit(); await sleep(1300); await clickChip((x) => x.textContent === t("yes")); if (pr.type) { await sleep(500); await clickChip((x) => x.textContent === pr.type); } }
  else { await clickChip((x) => x.textContent === t("noGst")); await sleep(500); await clickChip((x) => x.textContent === pr.type); await clickChip((x) => x.textContent === pr.city); }
  await clickChip((x) => EMP.find(([l, v]) => l === x.textContent && v >= pr.emp) && true);
  if (pr.sites) await clickChip((x) => SITES.find(([l, v]) => l === x.textContent && v >= pr.sites));
  await clickChip((x) => x.textContent === pr.net || (pr.net === "Mobile hotspot" && x.textContent === "Phone hotspot"));
  await clickChip((x) => { const s = SPEND.find(([l]) => l === x.textContent); return s && s[1] >= pr.spend * 0.6; });
  await sleep(600);
  const ch = [...ph().querySelectorAll(".chips .chip")];
  for (const id of pr.needs) { const n = NEEDS.find((x) => x.id === id); const b = ch.find((x) => x.textContent === (n[S.lang] || n.en)); b?.click(); await sleep(180); }
  await sleep(400); ph().querySelector(".chips .chip.primary")?.click();
  S.busy = false;
}

// autoplay demo with captions
const CAPS = [
  "Ramesh opens the link. Airtel’s network confirms his number, so there’s no OTP.",
  "No GST yet? No problem. He picks his business, city and size with a few taps.",
  "He says what he needs. The advisor builds a plan and the rules engine checks every product.",
  "One monthly price, with savings against today’s bill.",
  "Consent first, then verification. Nothing to photocopy, no visit.",
  "UPI AutoPay, and an honest go-live date. Status updates come on WhatsApp.",
];
function caption(i) {
  const c = $("#caption");
  c.innerHTML = `<span class="cap-n">${i + 1}/${CAPS.length}</span><span class="cap-t">${CAPS[i]}</span><span class="cap-dots">${CAPS.map((_, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("")}</span>`;
  c.classList.add("on");
}
async function waitBtn(match, ms = 20000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const b = [...ph().querySelectorAll(".btn")].reverse().find((x) => match.test(x.textContent));
    if (b) return b;
    await sleep(200);
  }
  return null;
}
async function playDemo() {
  if (S.busy) return;
  const btn = $("#playDemo"); btn.disabled = true; btn.classList.add("playing");
  document.querySelectorAll("#presets button").forEach((x) => x.classList.toggle("on", x.dataset.i === "0"));
  $("#stage3d").scrollIntoView({ behavior: "smooth", block: "start" });
  caption(0);
  const run = runPreset(PRESETS[0]);
  setTimeout(() => caption(1), 2600);
  setTimeout(() => caption(2), 7600);
  await run;
  const steps = [[/See my monthly price|मेरा मासिक खर्च देखें/, 3], [/Looks good/, 4], [/I agree/, 4], [/Continue to payment/, 5], [/Approve in UPI/, 5]];
  const t0 = performance.now();
  while (S.step !== "track" && performance.now() - t0 < 60000) {
    const btns = [...ph().querySelectorAll(".btn")].reverse();
    const hit = steps.map(([re, cap]) => [btns.find((x) => re.test(x.textContent)), cap]).find(([b]) => b);
    if (hit) { await sleep(1900); caption(hit[1]); hit[0].click(); await sleep(400); }
    else await sleep(250);
  }
  await sleep(4200);
  $("#caption").classList.remove("on");
  btn.disabled = false; btn.classList.remove("playing");
}

// KYC lab
function renderKycLab() {
  const res = Object.fromEntries(Object.keys(D.kycExt).sort().map((k) => [k, validate(k, D.kycExt[k], reg)]));
  const caught = Object.values(res).filter((r) => r.verdict !== "Approved").length;
  const repaired = Object.values(res).filter((r) => r.verdict === "Approved" && r.checks.some((c) => c.status === "info")).length;
  $("#kycScore").innerHTML = `<div class="fig red"><b>${caught + repaired} of 7</b><span>hidden problems caught</span></div>
    <div class="fig"><b>${caught}</b><span>applicants paused, each told exactly what to fix</span></div>
    <div class="fig"><b>${repaired}</b><span>fixed without asking: a tilted photo, a missing Udyam</span></div>
    <div class="fig green"><b>${12 - caught - repaired}</b><span>clean applicants approved straight away</span></div>`;
  $("#apps").innerHTML = Object.entries(res).map(([k, r]) => `<button class="app ${r.verdict === "Approved" || r.verdict === "Approved with notes" ? "v-ok" : r.verdict === "Retake photo" ? "v-warn" : "v-bad"}" data-k="${k}" aria-pressed="false"><b>${k}</b><small>${esc(r.business || "Unreadable")}</small><span class="tag ${r.verdict.split(" ")[0]}">${esc({ "Rejected for now": "Paused", "Retake photo": "Retake photo", Approved: "Approved", "Approved with notes": "Approved" }[r.verdict])}</span></button>`).join("");
  $("#apps").onclick = (e) => { const b = e.target.closest(".app"); if (b) showApp(b.dataset.k, res[b.dataset.k]); };
  showApp("K06", res.K06);
}
function showApp(k, r) {
  document.querySelectorAll(".app").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k));
  $("#kycTitle").textContent = `${k}: ${r.business || "documents"}`;
  const names = { gst_certificate: "GST certificate", udyam_certificate: "Udyam", address_proof: "Address proof", signatory_id: "Signatory ID" };
  $("#docs").innerHTML = Object.keys(names).map((d) => D.kycExt[k][d] ? `<figure><img src="kyc/${k}_${d}.jpg" alt="${names[d]} for ${k}" data-zoom><figcaption>${names[d]}${D.kycExt[k][d].deskewed ? " · straightened" : ""}${!D.kycExt[k][d].readable ? " · too blurred" : ""}</figcaption></figure>` : `<figure><div style="aspect-ratio:3/4;border:1.5px dashed var(--line);border-radius:6px;display:grid;place-items:center;color:var(--ink-3);font-size:13px">missing</div><figcaption>${names[d]}</figcaption></figure>`).join("");
  $("#checks").innerHTML = r.checks.map((c) => `<li><span><span class="tag ${c.status}">${{ pass: "OK", block: "Stop", warn: "Check", info: "Fixed" }[c.status]}</span></span><span><b>${esc(c.label)}</b><span class="det">${esc(c.detail)}</span>${c.action ? `<span class="act">Next: ${esc(c.action)}</span>` : ""}</span></li>`).join("");
}
// phone photos can be huge: shrink to at most 2000px before sending
function shrink(file, max = 2000) {
  if (file.size < 2.5e6 && /^image\/(jpeg|png)$/.test(file.type)) {  // small enough: send as-is, re-encoding hurts OCR
    return new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => bad(new Error("Couldn't open the file")); fr.readAsDataURL(file); });
  }
  return new Promise((ok, bad) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => bad(new Error("That file isn't an image"));
    img.src = url;
  });
}
const TAG = { pass: "OK", block: "Stop", warn: "Check", info: "Fixed" };
const checkList = (v) => `<ul class="checks" style="margin-top:10px">${v.map((c) => `<li><span><span class="tag ${c.status}">${TAG[c.status]}</span></span><span><b>${esc(c.label)}</b><span class="det">${esc(c.detail)}</span>${c.action ? `<span class="act">Next: ${esc(c.action)}</span>` : ""}</span></li>`).join("")}</ul>`;

async function onUpload(file) {
  const out = $("#uplOut");
  if (svc.MODE.ocr) {
    out.innerHTML = `<p style="color:var(--ink-3)">Checking sharpness, straightening and reading the certificate…</p>`;
    try {
      const r = await svc.readGstPhoto(await shrink(file));
      log("API", "Uploaded GST certificate read by our OCR", `Sharpness ${Math.round(r.blur)}${r.deskewed ? `, straightened ${Math.abs(r.skew)}°` : ""}`, r.readable ? "ok" : "bad");
      out.innerHTML = checkList(r.checks);
    } catch (e) { out.innerHTML = `<p class="note">Couldn't read it: ${esc(e.message)}. Try a sharper, straight photo of a GST certificate.</p>`; }
    return;
  }
  if (!sample) { out.innerHTML = `<p class="note">Reading a photo needs our server. Start the app with <b>python server/app.py</b> (with Tesseract installed) and try again.</p>`; return; }
  out.innerHTML = `<p style="color:var(--ink-3)">Reading the document…</p>`;
  try {
    const res = await sample.json(`Extract fields from this Indian GST registration certificate image. Return JSON with keys gstin, legal_name, trade_name, address, readable (false if blurred or not a GST certificate). Copy text exactly as printed.`, { images: [file], modelTier: "default" });
    const docs = { gst_certificate: { readable: res.readable !== false, blur: res.readable === false ? 0 : 999, fields: res } };
    const v = validate("Upload", docs, reg).checks.filter((c) => c.id.startsWith("gst"));
    out.innerHTML = checkList(v);
  } catch (e) { out.innerHTML = `<p class="note">Couldn't read it: ${esc(e.message || e.code || "error")}. Try a sharper photo.</p>`; }
}

// partner console
let pLimit = 50;
function renderPartners() {
  const { cols, rows } = D.leads;
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const m = D.metrics;
  const hot = rows.filter((r) => r[ix.band] === "Hot").length;
  $("#pKpis").innerHTML = `<div class="fig"><b class="num">${rows.length.toLocaleString("en-IN")}</b><span>leads lost last quarter</span></div>
    <div class="fig red"><b class="num">${hot.toLocaleString("en-IN")}</b><span>scored Hot: call these first</span></div>
    <div class="fig"><b>${Math.round(m.capture.top20 * 100)}%</b><span>of all sign-ups came from the top fifth of scores</span></div>
    <div class="fig"><b>${m.auc_cv5}</b><span>model AUC, checked on 5 held-out folds</span></div>`;
  const fill = (sel, key) => { const s = $(sel); if (s.options.length > 1) return; [...new Set(rows.map((r) => r[ix[key]]))].sort().forEach((v) => s.add(new Option(v, v))); };
  fill("#fStage", "stage_reached"); fill("#fSource", "lead_source");
  const b = $("#fBand").value, st = $("#fStage").value, so = $("#fSource").value, q = $("#fQ").value.toLowerCase();
  const f = rows.filter((r) => (!b || r[ix.band] === b) && (!st || r[ix.stage_reached] === st) && (!so || r[ix.lead_source] === so) && (!q || (r[ix.business_name] + " " + r[ix.city]).toLowerCase().includes(q)));
  $("#pCount").textContent = `${f.length.toLocaleString("en-IN")} leads match`;
  $("#pTable").innerHTML = `<thead><tr><th>Business</th><th>City</th><th>Dropped at</th><th>Reason</th><th class="n">Score</th><th>What to send them</th><th></th></tr></thead><tbody>${f.slice(0, pLimit).map((r) => `<tr>
    <td><b>${esc(r[ix.business_name])}</b><br><small style="color:var(--ink-3)">${esc(r[ix.business_type])}, via ${esc(r[ix.lead_source].toLowerCase())}</small></td>
    <td>${esc(r[ix.city])}</td><td>${esc(r[ix.stage_reached])}</td><td>${esc(r[ix.drop_reason])}</td>
    <td class="n"><span class="tag ${r[ix.band]}">${r[ix.score]}</span></td><td>${esc(r[ix.action])}</td>
    <td><button class="mini" data-b="${esc(r[ix.business_name])}" data-a="${esc(r[ix.action])}">Send</button></td></tr>`).join("")}</tbody>`;
  $("#pMore").style.display = f.length > pLimit ? "" : "none";
}

// insights
const SIM_GROUPS = [
  { label: "Visit and quote problems", hint: "No time for a visit, visit never booked, quote slow or confusing", def: 0.5, reasons: ["Owner had no time for a visit", "Visit not scheduled by sales", "Quote too complex to understand", "Quote took too long to arrive"] },
  { label: "Paperwork and KYC", hint: "Missing documents, too much paperwork, signatory away, mismatches", def: 0.5, reasons: ["Missing GST or Udyam document", "Found paperwork too long", "Authorised signatory not available", "Document details did not match"] },
  { label: "Price", hint: "Too expensive, competitor cheaper", def: 0.2, reasons: ["Price too high", "Competitor offered cheaper plan"] },
  { label: "Installation and payment", hint: "Install delays, no fibre, failed payment, cancelled before install", def: 0.5, reasons: ["Installation delayed beyond 21 days", "Site not feasible for fibre", "First payment failed", "Customer cancelled before install"] },
  { label: "Couldn’t reach them", hint: "Unreachable after 3 calls", def: 0.15, reasons: ["Unreachable after 3 attempts"] },
];
function simulate() {
  const I = D.ins, st = I.funnel.map((f) => f.stage), n = Object.fromEntries(I.funnel.map((f) => [f.stage, f.n]));
  const down = {};
  st.slice(0, -1).forEach((s, i) => { let p = 1; for (let j = i + 1; j < st.length - 1; j++) p *= n[st[j + 1]] / n[st[j]]; down[s] = p; });
  const vals = [...document.querySelectorAll(".sliders input")].map((x) => +x.value / 100);
  let extra = 0;
  // each reason keeps its own recovery share; a slider scales its whole group up or down from our default
  I.drops.forEach((d) => { const g = SIM_GROUPS.findIndex((G) => G.reasons.includes(d.reason)); if (g >= 0) extra += d.n * Math.min(1, (d.recover || SIM_GROUPS[g].def) * vals[g] / SIM_GROUPS[g].def) * down[d.stage]; });
  const total = I.kpis.activated + extra;
  $("#simRate").textContent = `${((total / I.kpis.leads) * 100).toFixed(1)}%`;
  $("#simActs").textContent = `${Math.round(total)}`;
  $("#simCr").textContent = `₹${((extra * 4 * I.kpis.mrrMedian * 12) / 1e7).toFixed(1)} cr`;
  vals.forEach((v, i) => ($("#slv" + i).textContent = `${Math.round(v * 100)}%`));
  const pct = Math.min(1, total / I.kpis.leads / 0.3);
  $(".ring-out").style.setProperty("--p", `${pct * 360}deg`);
}
function renderInsights() {
  const I = D.ins, k = I.kpis;
  const maxF = I.funnel[0].n;
  const funnel = I.funnel.map((f, i) => `<div class="f"><span>${f.stage}</span><div class="track"><div class="bar ${i === I.funnel.length - 1 ? "red" : ""}" data-w="${(f.n / maxF) * 100}%"></div></div><span class="num" style="text-align:right">${f.n.toLocaleString("en-IN")}</span></div>`).join("");
  const maxD = Math.max(...I.drops.map((d) => d.n));
  const drops = I.drops.map((d) => `<tr><td>${esc(d.stage)}</td><td>${esc(d.reason)}</td><td class="n">${d.n}</td><td style="width:110px"><div class="bar ${d.recover ? "green" : "grey"}" data-w="${(d.n / maxD) * 100}%"></div></td><td>${esc(d.fix)}</td></tr>`).join("");
  const seg = I.segments.map((s) => `<tr><td>${esc(s.seg)}</td><td class="n">${s.share}%</td><td class="n">${s.rate}%</td><td class="n">${inr(s.cac)}</td><td class="n">${inr(s.mrr)}</td><td class="n">${s.churn}%</td></tr>`).join("");
  const maxC = Math.max(...I.chase.map((c) => c.churn));
  const chase = I.chase.map((c) => `<div class="f" style="grid-template-columns:110px 1fr 84px"><span>${c.calls} call${c.calls > 1 ? "s" : ""}</span><div class="track"><div class="bar red" data-w="${(c.churn / maxC) * 100}%"></div></div><span class="num" style="text-align:right">${c.churn}% left</span></div>`).join("");
  const src = I.sources.map((s) => `<tr><td>${esc(s.k)}</td><td class="n">${s.rate}%</td><td class="n">${inr(s.cac)}</td></tr>`).join("");
  const o = I.opportunity;
  const bad = Object.values(I.badGstinActivated).reduce((a, b) => a + b, 0);
  $("#ins").innerHTML = `
  <div class="figures">
    <div class="fig red"><b>${k.rate}%</b><span>of leads sign up</span></div>
    <div class="fig"><b>${k.days} days</b><span>from first contact to live</span></div>
    <div class="fig"><b>${k.calls} calls</b><span>made by each customer asking “when?”</span></div>
    <div class="fig"><b>${inr(k.cac)}</b><span>spent to win one customer</span></div>
    <div class="fig"><b>${k.churn}%</b><span>gone within six months</span></div>
  </div>
  <div class="grid-2">
    <div class="sheet"><h2>The funnel, April to June</h2><div class="funnel" style="margin-top:14px">${funnel}</div><p class="muted" style="margin:12px 0 0">827 leads were lost only because a salesperson couldn’t get there. Those are the first people the advisor helps.</p></div>
    <div class="opp"><span class="big">${o.newRate}%</span><p><strong>What sign-ups could look like</strong> if Udyam Saathi wins back a cautious share of each fixable drop: ${o.newTotal} new customers a quarter instead of 368, and about ₹${o.extraAnnualRevenueCr} crore more a year.</p><p style="font-size:13.5px">We assumed half the visit, quote and paperwork drops come back, a fifth of price drops, and very few of the unreachable, then applied the real stage-by-stage conversion after that. Median bundle ₹${k.mrrMedian.toLocaleString("en-IN")} a month.</p></div>
  </div>
  <div class="sheet sim" style="margin-top:24px"><h2>What if? Move the sliders</h2><p class="muted" style="text-align:center;margin:6px auto 16px;max-width:60ch">How much of each kind of drop-off Udyam Saathi wins back. Everything recalculates from the real funnel.</p>
    <div class="sim-grid"><div class="sliders">${SIM_GROUPS.map((g, i) => `<label class="sl"><span><b>${g.label}</b><em id="slv${i}">${Math.round(g.def * 100)}%</em></span><input type="range" min="0" max="100" value="${Math.round(g.def * 100)}" data-g="${i}" aria-label="${g.label}"><small>${g.hint}</small></label>`).join("")}</div>
    <div class="sim-out"><div class="ring-out"><b id="simRate">–</b><span>of leads would sign up</span></div><div class="sim-figs"><div><b id="simActs">–</b><span>customers a quarter</span></div><div><b id="simCr">–</b><span>more revenue a year</span></div></div></div></div></div>
  <div class="sheet" style="margin-top:24px"><h2>Every reason a lead dropped, and our answer to it</h2><div style="overflow-x:auto;margin-top:8px"><table><thead><tr><th>Stage</th><th>Reason</th><th class="n">Leads</th><th></th><th>What Udyam Saathi does</th></tr></thead><tbody>${drops}</tbody></table></div><p class="muted" style="margin:10px 0 0">Green bars are the drops we expect to win back; grey ones we don’t count on.</p></div>
  <div class="grid-2" style="margin-top:24px">
    <div class="sheet"><h2>Who to go after first</h2><table style="margin-top:8px"><thead><tr><th>Segment</th><th class="n">Leads</th><th class="n">Sign up</th><th class="n">Cost to win</th><th class="n">Median bill</th><th class="n">Leave</th></tr></thead><tbody>${seg}</tbody></table>
      <p class="muted" style="margin:12px 0 0">Clinics, CA firms and other offices first: the cheapest to win, with a healthy bill. Small shops are half the leads but cost ${inr(I.segments.find((s) => s.key === "micro").cac)} each to win on a ₹2,470 bill, so they get a fully self-serve path.</p></div>
    <div class="sheet"><h2>Every “when?” call raises the chance they leave</h2><div class="funnel" style="margin-top:14px">${chase}</div><p class="muted" style="margin:12px 0 0">Customers who had to call five times were nearly five times as likely to leave as those who called once. The tracker sends the update before they need to ask.</p></div>
  </div>
  <div class="grid-2" style="margin-top:24px">
    <div class="sheet"><h2>Things the data was hiding</h2>
      <div class="finding"><b>${I.violations.leads}</b><p>customers were sold products they weren’t eligible for, most often 1 Gbps fibre in tier-2 cities where it isn’t sold. Our rules engine can’t make that mistake.</p></div>
      <div class="finding"><b>${bad}</b><p>customers were switched on with a cancelled or suspended GSTIN. Our KYC checks the live registry status first.</p></div>
      <div class="finding"><b>${I.boughtNoneAsked}%</b><p>of customers ended up with none of the products they first asked about. The sale followed targets, not needs; the advisor starts from needs.</p></div>
      <div class="finding"><b>9.6 vs 2.0</b><p>sign-up rate (%) with and without a GSTIN. Businesses without GST get a bundle that doesn’t need it, instead of being dropped.</p></div></div>
    <div class="sheet"><h2>Cost to win a customer, by source</h2><table style="margin-top:8px"><thead><tr><th>Source</th><th class="n">Sign up</th><th class="n">Cost per customer</th></tr></thead><tbody>${src}</tbody></table>
      <p class="muted" style="margin:12px 0 0">Field visits are the most expensive way to win a customer. With Udyam Saathi they’re kept for the Hot leads the advisor couldn’t close, and for jobs that need a site visit anyway.</p></div>
  </div>`;
}

// startup
function countUp(el) {
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const final = el.dataset.final || el.textContent; el.dataset.final = final;
  const m = final.match(/\d[\d,]*(\.\d+)?/); if (!m) return;
  const target = parseFloat(m[0].replace(/,/g, "")), dec = (m[1] || "").length ? m[1].length - 1 : 0, comma = m[0].includes(",");
  const t0 = performance.now(), dur = 900;
  const fmt = (v) => comma ? Math.round(v).toLocaleString("en-IN") : v.toFixed(dec);
  const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = final.replace(m[0], fmt(target * e)); if (k < 1) requestAnimationFrame(step); else el.textContent = final; };
  requestAnimationFrame(step);
}
function growBars(root) {
  const bars = root.querySelectorAll("[data-w]");
  bars.forEach((b) => (b.style.width = "0"));
  requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach((b) => (b.style.width = b.dataset.w))));
}
function animateView(id) {
  const v = $("#v-" + id); if (!v) return;
  v.querySelectorAll(".fig b").forEach(countUp);
  growBars(v);
}
function setup3d() {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  const stage = $("#stage3d"), phone = $("#phone3d");
  let raf = 0;
  stage.addEventListener("pointermove", (ev) => {
    if (innerWidth < 1180 || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; tiltStage(ev); });
  });
  const tiltStage = (e) => {
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    phone.style.setProperty("--ry", `${-10 + x * 16}deg`);
    phone.style.setProperty("--rx", `${4 - y * 10}deg`);
    stage.style.setProperty("--mx", `${(x + 0.5) * 100}%`); stage.style.setProperty("--my", `${(y + 0.5) * 100}%`);
  };
  stage.addEventListener("pointerleave", () => { phone.style.setProperty("--ry", "-10deg"); phone.style.setProperty("--rx", "4deg"); });
  let cur = null, raf2 = 0;
  // pause decorative animations while the page scrolls
  let st = 0;
  addEventListener("scroll", () => { document.body.classList.add("is-scrolling"); clearTimeout(st); st = setTimeout(() => document.body.classList.remove("is-scrolling"), 160); }, { passive: true, capture: true });
  document.addEventListener("pointermove", (ev) => { if (!raf2) raf2 = requestAnimationFrame(() => { raf2 = 0; tiltCard(ev); }); }, { passive: true });
  const tiltCard = (e) => {
    const el = e.target.closest(".fig,.app,.opp");
    if (cur && cur !== el) { cur.style.setProperty("--tx", "0deg"); cur.style.setProperty("--ty", "0deg"); }
    cur = el;
    if (!el) return;
    el.classList.add("tilt");
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    const k = el.classList.contains("opp") ? 5 : 10;
    el.style.setProperty("--ty", `${x * k}deg`);
    el.style.setProperty("--tx", `${-y * k}deg`);
  };
}
function toast(m) { const t_ = $("#toast"); t_.textContent = m; t_.classList.add("on"); setTimeout(() => t_.classList.remove("on"), 2400); }
function setBadge() { const ai = !!sample || svc.MODE.ai; $("#aiDot").classList.toggle("on", ai); if (S.step === "welcome") $("#phStatusText").textContent = ai ? "AI advisor online" : "Business sign-up"; }
function route() {
  const v = (location.hash || "#journey").slice(1);
  const id = ["journey", "kyc-lab", "partners", "insights"].includes(v) ? v : "journey";
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s.id === "v-" + id));
  document.querySelectorAll("nav.tabs a").forEach((a) => (a.dataset.v === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (D) animateView(id);
}

async function init() {
  const [catalogue, ref, gst, udyam, kycExt, leads, ins, metrics] = await Promise.all(
    ["catalogue.json", "reference.json", "gstin_registry.json", "udyam_registry.json", "kyc_extracted.json", "leads.json", "insights.json", "metrics.json"].map(load));
  D = { catalogue, ref, kycExt, leads, ins, metrics };
  engine = new Engine(catalogue, ref);
  reg = new Registry(gst, udyam);
  $("#presets").innerHTML = PRESETS.map((p, i) => `<button type="button" class="c-${p.color}" data-i="${i}"><i>${esc(p.label[0])}</i><span><b>${esc(p.label)}</b><small>${esc(p.sub)}</small></span></button>`).join("") + `<button type="button" class="reset" data-i="reset"><span class="reset-ic" aria-hidden="true">↺</span>Start over</button>`;
  $("#presets").onclick = (e) => {
    const b = e.target.closest("button"); if (!b || S.busy) return;
    document.querySelectorAll("#presets button").forEach((x) => x.classList.toggle("on", x === b && b.dataset.i !== "reset"));
    b.dataset.i === "reset" ? resetJourney() : runPreset(PRESETS[+b.dataset.i]);
  };
  $("#phForm").onsubmit = (e) => { e.preventDefault(); const v = $("#phIn").value.trim(); if (!v) return; $("#phIn").value = ""; onFree(v); };
  $("#lang").onchange = (e) => { S.lang = e.target.value; if (S.step === "welcome") resetJourney(); };
  ["#fBand", "#fStage", "#fSource"].forEach((s) => ($(s).onchange = () => { pLimit = 50; renderPartners(); }));
  $("#fQ").oninput = () => { pLimit = 50; renderPartners(); };
  $("#pMore").onclick = () => { pLimit += 100; renderPartners(); };
  $("#pTable").onclick = (e) => { const b = e.target.closest("button[data-b]"); if (b) { b.textContent = "Sent ✓"; b.disabled = true; toast(`${b.dataset.a}: sent to ${b.dataset.b} on WhatsApp (mock)`); } };
  $("#upl").onchange = (e) => e.target.files[0] && onUpload(e.target.files[0]);
  document.addEventListener("click", (e) => { const z = $("#zoom"); if (e.target.matches("[data-zoom]")) { z.querySelector("img").src = e.target.src; z.classList.add("on"); } else if (e.target.closest("#zoom")) z.classList.remove("on"); });
  window.addEventListener("hashchange", route); route();
  setup3d();
  resetJourney(); renderKycLab(); renderPartners(); renderInsights();
  document.querySelectorAll(".sliders input").forEach((x) => (x.oninput = simulate)); simulate();
  $("#playDemo").onclick = playDemo;
  animateView((location.hash || "#journey").slice(1));
  setBadge();
  try {
    await svc.detectApi(); setBadge();
    $("#dropHint").textContent = svc.MODE.ocr ? "Upload a photo: we check sharpness, straighten it, read it with OCR and match it against the GST registry." : "Works when the app runs on our server with OCR installed.";
    if (window.claude?.use) { sample = await window.claude.use("sample"); setBadge(); if (sample) $("#dropHint").textContent = "AI reads it, then the same checks run."; }
  } catch { sample = null; setBadge(); }
}
init();
