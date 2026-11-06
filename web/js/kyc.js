// Same checks as kyc/validators.py (tests/kyc_parity.mjs compares them).
export const KYC_TODAY = new Date("2026-07-15");
const CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const UDYAM_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const STATE_CODES = { "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "19": "West Bengal", "23": "Madhya Pradesh", "24": "Gujarat", "27": "Maharashtra", "29": "Karnataka", "32": "Kerala", "33": "Tamil Nadu", "36": "Telangana", "37": "Andhra Pradesh" };
const DIGIT_POS = [0, 1, 7, 8, 9, 10], LETTER_POS = [2, 3, 4, 5, 6, 11];
const TO_DIGIT = { O: "0", I: "1", S: "5", B: "8", Z: "2", L: "1" };
const TO_LETTER = { 0: "O", 1: "I", 5: "S", 8: "B", 2: "Z" };
const LETTER_SWAP = { I: "J", J: "I", O: "Q", Q: "O" };

export function gstinChecksumOk(g) {
  if (!g || g.length !== 15 || [...g].some((c) => !CH.includes(c))) return false;
  let s = 0;
  for (let i = 0; i < 14; i++) { const v = CH.indexOf(g[i]) * (i % 2 ? 2 : 1); s += Math.floor(v / 36) + (v % 36); }
  return CH[(36 - (s % 36)) % 36] === g[14];
}
export function gstinFormatOk(g) { return GSTIN_RE.test(g || "") && gstinChecksumOk(g); }

export function gstinCandidates(raw) {
  const b = [...(raw || "").toUpperCase().replace(/\s/g, "")];
  DIGIT_POS.forEach((i) => { if (i < b.length) b[i] = TO_DIGIT[b[i]] ?? b[i]; });
  LETTER_POS.forEach((i) => { if (i < b.length) b[i] = TO_LETTER[b[i]] ?? b[i]; });
  if (b.length > 13 && b[13] === "2") b[13] = "Z";  // 14th character of a GSTIN is always Z
  const base = b.join("");
  const c = new Set([base]);
  LETTER_POS.forEach((i) => { if (i < base.length && LETTER_SWAP[base[i]]) c.add(base.slice(0, i) + LETTER_SWAP[base[i]] + base.slice(i + 1)); });
  if (base.length === 15) [...c].forEach((x) => { const alt = TO_DIGIT[x[14]] ?? TO_LETTER[x[14]]; if (alt) c.add(x.slice(0, 14) + alt); });  // check digit: letter or digit
  return [...c].sort();
}

const norm = (s) => (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "").trim();
// string similarity, same idea as Python difflib
export function similar(a, b) {
  a = norm(a); b = norm(b);
  if (!a.length && !b.length) return 1;
  const m = (x, y) => {
    if (!x.length || !y.length) return 0;
    let best = 0, bi = 0, bj = 0;
    for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
      let k = 0; while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
      if (k > best) { best = k; bi = i; bj = j; }
    }
    if (!best) return 0;
    return best + m(x.slice(0, bi), y.slice(0, bj)) + m(x.slice(bi + best), y.slice(bj + best));
  };
  return (2 * m(a, b)) / (a.length + b.length);
}
const hamming = (a, b) => { let d = Math.abs(a.length - b.length); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++; return d; };
const days = (a, b) => Math.round((a - b) / 86400000);

function check(id, label, ok, detail, action = "", severity = "block") {
  const status = severity === "info" ? "info" : ok ? "pass" : severity;
  return { id, label, status, detail, action: ok ? "" : action };
}

export class Registry {
  constructor(gst, udyam) { this.gst = gst; this.udyam = udyam; }
  nearestGstin(g) { let best = null, d = 99; for (const k in this.gst) { const h = hamming(k, g); if (h < d) { d = h; best = k; } } return [best, d]; }
  findUdyam(name, city) {
    const hits = Object.entries(this.udyam).filter(([, v]) => v[5] === city && similar(v[0], name) > 0.95);
    return hits.length === 1 ? hits[0][0] : null;
  }
  findUdyamByState(name, state) {
    return Object.entries(this.udyam).find(([, v]) => v[4] === state && similar(v[0], name) > 0.95) || null;
  }
}

export function validate(appId, docs, reg) {
  const out = [];
  const g = docs.gst_certificate;
  let gstRec = null, gstin = null;
  if (!g) out.push(check("gst.present", "GST certificate uploaded", false, "Not provided", "Fetch from Entity Locker or enter GSTIN to look it up"));
  else if (!g.readable) out.push(check("gst.quality", "GST certificate readable", false, `Image too blurred (sharpness ${Math.round(g.blur || 0)}, need 300+)`, "Ask owner to retake the photo, with live camera guide"));
  else {
    if (g.deskewed) out.push(check("gst.skew", "Tilted photo straightened", true, `Auto-rotated ${Math.round(g.skew)}° before reading`, "", "info"));
    const f = g.fields, raw = f.gstin || "";
    const valid = gstinCandidates(raw).filter(gstinFormatOk);
    const inReg = valid.filter((c) => reg.gst[c]);
    if (inReg.length) {
      gstin = inReg[0];
      out.push(check("gst.format", "GSTIN format and checksum", true, gstin + (gstin === raw ? "" : ` (OCR read '${raw}', corrected look-alike characters)`)));
    } else {
      const [near, dist] = reg.nearestGstin(valid[0] || gstinCandidates(raw)[0]);
      let detail = `'${raw}' fails the GSTIN checksum`;
      if (dist <= 2) detail += `; registry has ${near} (${dist} character${dist > 1 ? "s" : ""} different) for ${reg.gst[near][1]}`;
      out.push(check("gst.format", "GSTIN format and checksum", false, detail, "Possible typo or edited document: confirm GSTIN with owner, route to manual review"));
    }
    if (gstin) {
      gstRec = reg.gst[gstin];
      const [legal, trade, , address, state, , status] = gstRec;
      out.push(check("gst.status", "GSTIN active in registry", status === "Active", `Registry status: ${status}`, "Cannot sell GST-only products; offer non-GST bundle and help re-activate GST"));
      out.push(check("gst.state", "State code matches registry", STATE_CODES[gstin.slice(0, 2)] === state, `${gstin.slice(0, 2)} = ${STATE_CODES[gstin.slice(0, 2)] || "?"}; registry: ${state}`, "Flag for review"));
      out.push(check("gst.legal", "Legal name matches registry", similar(f.legal_name, legal) > 0.9, `Doc: ${f.legal_name} | Registry: ${legal}`, "Name on certificate differs from GST registry: request fresh copy via Entity Locker"));
      out.push(check("gst.trade", "Trade name matches registry", similar(f.trade_name, trade) > 0.9, `Doc: ${f.trade_name} | Registry: ${trade}`, "Request fresh copy via Entity Locker"));
      out.push(check("gst.address", "Address matches registry", similar(f.address, address) > 0.85, `Registry: ${address}`, "Confirm installation address", "warn"));
    }
  }
  const u = docs.udyam_certificate;
  const biz = gstRec ? gstRec[1] : u?.fields?.enterprise_name || "";
  let city = "";
  if (gstRec) { const m = gstRec[3].match(/,\s*([A-Za-z ]+),\s*[A-Za-z ]+\s*-\s*\d{6}$/); city = m ? m[1].trim() : ""; }
  if (!u || !u.fields?.udyam_number) {
    const auto = biz && city ? reg.findUdyam(biz, city) : null;
    if (auto) out.push(check("udyam.present", "Udyam registration", true, `${!u ? "Certificate missing" : "Number blank on certificate"}: auto-fetched ${auto} from registry (name + city match)`, "", "info"));
    else out.push(check("udyam.present", "Udyam registration", false, !u ? "Certificate missing" : "Udyam number is blank on the certificate", "Ask for Udyam number, or skip: Udyam is optional for most products", "warn"));
  } else {
    const num = u.fields.udyam_number, rec = reg.udyam[num];
    out.push(check("udyam.registry", "Udyam number found in registry", UDYAM_RE.test(num) && !!rec, rec ? num : `${num} not found`, "Ask owner to re-enter Udyam number", "warn"));
    if (rec) out.push(check("udyam.name", "Udyam name matches", similar(rec[0], u.fields.enterprise_name) > 0.9, `Registry: ${rec[0]}`, "Flag for review", "warn"));
  }
  const a = docs.address_proof;
  if (a && a.readable) {
    const f = a.fields, bd = new Date(f.bill_date || "x"), age = isNaN(bd) ? null : days(KYC_TODAY, bd);
    out.push(check("addr.age", "Address proof not older than 90 days", age !== null && age <= 90, age !== null ? `Bill dated ${f.bill_date} (${age} days old)` : "No bill date found", "Fetch latest bill via DigiLocker / ask for a bill from the last 90 days"));
    if (gstRec) {
      out.push(check("addr.name", "Bill is in the business name", similar(f.billed_to, gstRec[1]) > 0.9 || similar(f.billed_to, gstRec[0]) > 0.9, `Billed to: ${f.billed_to}`, "Ask for a bill in the business name", "warn"));
      out.push(check("addr.match", "Bill address = GST address", similar(f.address, gstRec[3]) > 0.85, `Bill: ${f.address}`, "Confirm installation address", "warn"));
    }
  } else out.push(check("addr.present", "Address proof", false, "Missing or unreadable", "Upload a recent utility bill"));
  const s = docs.signatory_id;
  if (s && s.readable) {
    const f = s.fields, vt = new Date(f.valid_till || "x");
    out.push(check("sig.valid", "Signatory ID valid", !isNaN(vt) && vt >= KYC_TODAY, `Valid till ${f.valid_till}`, "Ask for a valid ID"));
    if (gstRec) {
      out.push(check("sig.biz", "Signatory belongs to this business", similar(f.business, gstRec[1]) > 0.9, `ID for: ${f.business}`, "Ask for correct signatory", "warn"));
      if (gstRec[2] === "Proprietorship") {
        const prop = gstRec[0].split(" (Prop.")[0];
        out.push(check("sig.prop", "Signatory is the proprietor", similar(f.name, prop) > 0.9, `ID: ${f.name} | Proprietor: ${prop}`, "Proprietor must e-sign remotely", "warn"));
      }
    }
  } else out.push(check("sig.present", "Signatory ID", false, "Missing or unreadable", "Upload signatory ID"));
  const blocks = out.filter((c) => c.status === "block"), warns = out.filter((c) => c.status === "warn");
  let verdict = blocks.length ? "Rejected for now" : warns.length ? "Approved with notes" : "Approved";
  if (blocks.length === 1 && blocks[0].id === "gst.quality") verdict = "Retake photo";
  return { applicant: appId, gstin, business: biz, verdict, blocking: blocks.map((c) => c.label), checks: out };
}
