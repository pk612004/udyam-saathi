"""KYC checks against the GST / Udyam registries. Every failed check says what to do next.
The browser version is web/js/kyc.js; tests/kyc_parity.mjs keeps them in sync."""
import json
import re
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TODAY = date(2026, 7, 15)          # "today" fixed by the data pack README
MAX_PROOF_AGE = 90
CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
UDYAM_RE = re.compile(r"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")
STATE_CODES = {"01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
               "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar",
               "19": "West Bengal", "23": "Madhya Pradesh", "24": "Gujarat", "27": "Maharashtra",
               "29": "Karnataka", "32": "Kerala", "33": "Tamil Nadu", "36": "Telangana", "37": "Andhra Pradesh"}
# OCR look-alikes, applied only where the GSTIN position allows that character class
DIGIT_POS = {0, 1, 7, 8, 9, 10}
LETTER_POS = {2, 3, 4, 5, 6, 11}
TO_DIGIT = {"O": "0", "I": "1", "S": "5", "B": "8", "Z": "2", "L": "1"}
TO_LETTER = {"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z"}
LETTER_SWAP = {"I": "J", "J": "I", "O": "Q", "Q": "O"}


def gstin_checksum_ok(g):
    if len(g) != 15 or any(c not in CH for c in g):
        return False
    s = 0
    for i, c in enumerate(g[:14]):
        v = CH.index(c) * (2 if i % 2 else 1)
        s += v // 36 + v % 36
    return CH[(36 - s % 36) % 36] == g[14]


def gstin_candidates(raw):
    """Readings of an OCR'd GSTIN that differ only by known OCR look-alikes."""
    base = list(raw)
    for i in DIGIT_POS:
        if i < len(base):
            base[i] = TO_DIGIT.get(base[i], base[i])
    for i in LETTER_POS:
        if i < len(base):
            base[i] = TO_LETTER.get(base[i], base[i])
    if len(base) > 13 and base[13] == "2":  # 14th character of a GSTIN is always Z
        base[13] = "Z"
    base = "".join(base)
    cands = {base}
    for i in LETTER_POS:
        if i < len(base) and base[i] in LETTER_SWAP:
            cands.add(base[:i] + LETTER_SWAP[base[i]] + base[i + 1:])
    if len(base) == 15:  # the check digit can be a letter or a digit: try both readings
        for c in list(cands):
            alt = TO_DIGIT.get(c[14]) or TO_LETTER.get(c[14])
            if alt:
                cands.add(c[:14] + alt)
    return sorted(cands)


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower().replace("&", "and")).strip()


def similar(a, b):
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def hamming(a, b):
    return sum(x != y for x, y in zip(a, b)) + abs(len(a) - len(b))


class Registry:
    def __init__(self):
        d = ROOT / "web" / "data"
        self.gst = json.loads((d / "gstin_registry.json").read_text())
        self.udyam = json.loads((d / "udyam_registry.json").read_text())

    def nearest_gstin(self, g):
        best = min(self.gst, key=lambda k: hamming(k, g))
        return best, hamming(best, g)

    def find_udyam(self, name, city):
        hits = [k for k, v in self.udyam.items() if similar(v[0], name) > 0.95 and v[5] == city]
        return hits[0] if len(hits) == 1 else None


def check(rid, label, ok, detail, action="", severity="block"):
    status = "info" if severity == "info" else ("pass" if ok else severity)
    return {"id": rid, "label": label, "status": status, "detail": detail,
            "action": "" if ok else action}


def validate(app_id, docs, reg):
    """docs: {doc_type: {readable, deskewed, fields}} -> verdict dict."""
    out = []
    g = docs.get("gst_certificate")
    gst_rec = None
    gstin = None

    # ---------- GST certificate ----------
    if not g:
        out.append(check("gst.present", "GST certificate uploaded", False, "Not provided",
                         "Fetch from Entity Locker or enter GSTIN to look it up"))
    elif not g["readable"]:
        out.append(check("gst.quality", "GST certificate readable", False,
                         f"Image too blurred (sharpness {g.get('blur', 0):.0f}, need 300+)",
                         "Ask owner to retake the photo, with live camera guide"))
    else:
        if g.get("deskewed"):
            out.append(check("gst.skew", "Tilted photo straightened", True,
                             f"Auto-rotated {g.get('skew', 0):.0f}° before reading", severity="info"))
        f = g["fields"]
        raw = f.get("gstin", "")
        valid = [c for c in gstin_candidates(raw) if GSTIN_RE.match(c) and gstin_checksum_ok(c)]
        in_reg = [c for c in valid if c in reg.gst]
        if in_reg:
            gstin = in_reg[0]
            note = "" if gstin == raw else f" (OCR read '{raw}', corrected look-alike characters)"
            out.append(check("gst.format", "GSTIN format and checksum", True, gstin + note))
        else:
            near, dist = reg.nearest_gstin(valid[0] if valid else gstin_candidates(raw)[0])
            detail = f"'{raw}' fails the GSTIN checksum"
            if dist <= 2:
                detail += f"; registry has {near} ({dist} character{'s' if dist > 1 else ''} different) for {reg.gst[near][1]}"
            out.append(check("gst.format", "GSTIN format and checksum", False, detail,
                             "Possible typo or edited document: confirm GSTIN with owner, route to manual review"))
        if gstin:
            gst_rec = reg.gst[gstin]
            legal, trade, constitution, address, state, _, status = gst_rec
            out.append(check("gst.status", "GSTIN active in registry", status == "Active", f"Registry status: {status}",
                             "Cannot sell GST-only products; offer non-GST bundle and help re-activate GST"))
            out.append(check("gst.state", "State code matches registry", STATE_CODES.get(gstin[:2]) == state,
                             f"{gstin[:2]} = {STATE_CODES.get(gstin[:2], '?')}; registry: {state}",
                             "Flag for review"))
            ok_l = similar(f.get("legal_name"), legal) > 0.9
            out.append(check("gst.legal", "Legal name matches registry", ok_l,
                             f"Doc: {f.get('legal_name')} | Registry: {legal}",
                             "Name on certificate differs from GST registry: request fresh copy via Entity Locker"))
            ok_t = similar(f.get("trade_name"), trade) > 0.9
            out.append(check("gst.trade", "Trade name matches registry", ok_t,
                             f"Doc: {f.get('trade_name')} | Registry: {trade}", "Request fresh copy via Entity Locker"))
            ok_a = similar(f.get("address"), address) > 0.85
            out.append(check("gst.address", "Address matches registry", ok_a,
                             f"Registry: {address}", "Confirm installation address", severity="warn"))

    # ---------- Udyam ----------
    u = docs.get("udyam_certificate")
    biz = gst_rec[1] if gst_rec else (u or {}).get("fields", {}).get("enterprise_name", "")
    city = ""
    if gst_rec:
        m = re.search(r",\s*([A-Za-z ]+),\s*[A-Za-z ]+\s*-\s*\d{6}$", gst_rec[3])
        city = m.group(1).strip() if m else ""
    if not u or not u["fields"].get("udyam_number"):
        auto = reg.find_udyam(biz, city) if biz and city else None
        if auto:
            out.append(check("udyam.present", "Udyam registration", True,
                             f"{'Certificate missing' if not u else 'Number blank on certificate'}: auto-fetched {auto} from registry (name + city match)",
                             severity="info"))
        else:
            out.append(check("udyam.present", "Udyam registration", False,
                             "Certificate missing" if not u else "Udyam number is blank on the certificate",
                             "Ask for Udyam number, or skip: Udyam is optional for most products", severity="warn"))
    else:
        num = u["fields"]["udyam_number"]
        ok_f = bool(UDYAM_RE.match(num))
        rec = reg.udyam.get(num)
        out.append(check("udyam.registry", "Udyam number found in registry", ok_f and rec is not None,
                         num if rec else f"{num} not found", "Ask owner to re-enter Udyam number", severity="warn"))
        if rec:
            out.append(check("udyam.name", "Udyam name matches", similar(rec[0], u["fields"].get("enterprise_name")) > 0.9,
                             f"Registry: {rec[0]}", "Flag for review", severity="warn"))

    # ---------- Address proof ----------
    a = docs.get("address_proof")
    if a and a["readable"]:
        f = a["fields"]
        try:
            age = (TODAY - date.fromisoformat(f.get("bill_date", ""))).days
        except ValueError:
            age = None
        out.append(check("addr.age", "Address proof not older than 90 days", age is not None and age <= MAX_PROOF_AGE,
                         f"Bill dated {f.get('bill_date')} ({age} days old)" if age is not None else "No bill date found",
                         "Fetch latest bill via DigiLocker / ask for a bill from the last 90 days"))
        if gst_rec:
            out.append(check("addr.name", "Bill is in the business name",
                             similar(f.get("billed_to"), gst_rec[1]) > 0.9 or similar(f.get("billed_to"), gst_rec[0]) > 0.9,
                             f"Billed to: {f.get('billed_to')}", "Ask for a bill in the business name", severity="warn"))
            out.append(check("addr.match", "Bill address = GST address", similar(f.get("address"), gst_rec[3]) > 0.85,
                             f"Bill: {f.get('address')}", "Confirm installation address", severity="warn"))
    else:
        out.append(check("addr.present", "Address proof", False, "Missing or unreadable", "Upload a recent utility bill"))

    # ---------- Signatory ----------
    s = docs.get("signatory_id")
    if s and s["readable"]:
        f = s["fields"]
        try:
            valid_till = date.fromisoformat(f.get("valid_till", ""))
        except ValueError:
            valid_till = None
        out.append(check("sig.valid", "Signatory ID valid", valid_till is not None and valid_till >= TODAY,
                         f"Valid till {f.get('valid_till')}", "Ask for a valid ID"))
        if gst_rec:
            out.append(check("sig.biz", "Signatory belongs to this business", similar(f.get("business"), gst_rec[1]) > 0.9,
                             f"ID for: {f.get('business')}", "Ask for correct signatory", severity="warn"))
            if gst_rec[2] == "Proprietorship":
                prop = gst_rec[0].split(" (Prop.")[0]
                out.append(check("sig.prop", "Signatory is the proprietor", similar(f.get("name"), prop) > 0.9,
                                 f"ID: {f.get('name')} | Proprietor: {prop}",
                                 "Proprietor must e-sign remotely", severity="warn"))
    else:
        out.append(check("sig.present", "Signatory ID", False, "Missing or unreadable", "Upload signatory ID"))

    blocks = [c for c in out if c["status"] == "block"]
    warns = [c for c in out if c["status"] == "warn"]
    verdict = "Rejected for now" if blocks else ("Approved with notes" if warns else "Approved")
    if blocks and any(c["id"] == "gst.quality" for c in blocks) and len(blocks) == 1:
        verdict = "Retake photo"
    return {"applicant": app_id, "gstin": gstin, "business": biz, "verdict": verdict,
            "blocking": [c["label"] for c in blocks], "checks": out}


def main():
    reg = Registry()
    ext = json.loads((ROOT / "web" / "data" / "kyc_extracted.json").read_text())
    res = {k: validate(k, v, reg) for k, v in sorted(ext.items())}
    (ROOT / "web" / "data" / "kyc_results.json").write_text(json.dumps(res, indent=1))
    for k, r in res.items():
        print(k, r["verdict"], "|", "; ".join(r["blocking"]) or "-")


if __name__ == "__main__":
    main()
