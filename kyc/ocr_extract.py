"""Reads the KYC images: blur check, deskew, Tesseract, then pulls out the labelled fields.
Writes web/data/kyc_extracted.json."""
import json
import re
from pathlib import Path

import cv2
import numpy as np
import pytesseract

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "data" / "kyc_documents"
BLUR_MIN = 300.0      # below this the photo is too blurred to trust
SKEW_MAX = 1.0        # degrees; above this we deskew before OCR

LABELS = {
    "gst_certificate": {
        "gstin": r"GSTIN", "legal_name": r"Legal name", "trade_name": r"Trade name",
        "constitution": r"Constitution", "address": r"Address of principal",
        "liability_date": r"Date of liability", "reg_type": r"Type of registration",
    },
    "udyam_certificate": {
        "udyam_number": r"Udyam reg\. number", "enterprise_name": r"Enterprise name",
        "major_activity": r"Major activity", "city": r"City", "state": r"State",
        "reg_date": r"Date of registration",
    },
    "address_proof": {
        "consumer_no": r"Consumer no\.", "billed_to": r"Billed to", "address": r"Supply address",
        "bill_date": r"Bill date",
    },
    "signatory_id": {},  # stacked label/value layout, parsed separately
}


def blur_score(gray):
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def skew_angle(gray):
    """Angle of the document's dark border, from the largest contour's min-area rectangle."""
    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return 0.0
    rect = cv2.minAreaRect(max(cnts, key=cv2.contourArea))
    ang = rect[-1] % 90
    if ang > 45:
        ang -= 90
    return float(ang)


def deskew(img, angle):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))


def fix_ocr(text):
    # Common OCR confusions inside IDs are fixed later per-field; here just tidy whitespace.
    return re.sub(r"[ \t]+", " ", text)


def parse_fields(kind, text):
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    out = {}
    if kind == "signatory_id":
        for key, lab in (("name", "Name"), ("designation", "Designation"), ("business", "For business"),
                         ("id_no", "ID no."), ("valid_till", "Valid till")):
            for i, l in enumerate(lines):
                if l == lab and i + 1 < len(lines):
                    out[key] = lines[i + 1]
                    break
        return out
    labels = LABELS[kind]
    for key, pat in labels.items():
        for i, l in enumerate(lines):
            m = re.match(pat + r"\s*(.*)$", l)
            if m:
                val = m.group(1).strip()
                # addresses wrap onto the next line ("...Andhra Pradesh" split)
                if key == "address" and i + 1 < len(lines):
                    nxt = lines[i + 1]
                    nxt = re.sub(r"^place of business\s*", "", nxt)
                    if not re.match(r"(Bill date|Date of|Units|Type of)", nxt):
                        if (re.search(r"[A-Za-z]$", val) and re.match(r"[a-z]", nxt)) or (re.search(r"\d$", val) and re.match(r"\d", nxt)):
                            val = val + nxt
                        else:
                            val = val + " " + nxt
                    val = re.sub(r"\s*-+\s*", " - ", val).strip()
                out[key] = val
                break
    if "gstin" in out:
        out["gstin"] = out["gstin"].replace(" ", "").upper()
    if "udyam_number" in out:
        out["udyam_number"] = out["udyam_number"].replace(" ", "").upper()
    return out


def normalise_gstin(g):
    """Tesseract confuses O/0 in GSTINs. Positions 0-1, 7-10 and 12 are digits; resolve accordingly."""
    if not g or len(g) != 15:
        return g
    g = list(g)
    for i in (0, 1, 7, 8, 9, 10):
        g[i] = {"O": "0", "I": "1", "S": "5"}.get(g[i], g[i])
    for i in (2, 3, 4, 5, 6, 11):
        g[i] = {"0": "O", "1": "I", "5": "S"}.get(g[i], g[i])
    return "".join(g)


def process(path):
    return read_image(cv2.imread(str(path)), re.sub(r"^K\d+_", "", path.stem), path.name)


def read_image(img, kind, name="upload", ocr_scale=1.0):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = blur_score(gray)
    ang = skew_angle(gray)
    deskewed = abs(ang) > SKEW_MAX
    if deskewed:
        img = deskew(img, ang)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if ocr_scale != 1.0:  # blur is judged on the original; only the OCR sees the enlarged copy
        gray = cv2.resize(gray, None, fx=ocr_scale, fy=ocr_scale, interpolation=cv2.INTER_CUBIC)
    text = fix_ocr(pytesseract.image_to_string(gray, config="--psm 4"))
    fields = parse_fields(kind, text) if blur >= BLUR_MIN else {}
    return {
        "doc": kind, "file": name, "blur": round(blur, 1), "skew": round(ang, 1),
        "deskewed": deskewed, "readable": blur >= BLUR_MIN, "fields": fields,
    }


def candidates_for_gstin(raw):
    """All O/0 readings of an OCR'd GSTIN, so the validator can pick the registry-consistent one."""
    return sorted({raw, normalise_gstin(raw)})


def main():
    out = {}
    for p in sorted(DOCS.glob("K*.png")):
        app = p.stem.split("_")[0]
        rec = process(p)
        if rec["doc"] == "gst_certificate" and rec["fields"].get("gstin"):
            rec["fields"]["gstin_ocr"] = rec["fields"]["gstin"]
        out.setdefault(app, {})[rec["doc"]] = rec
        print(app, rec["doc"], "blur", rec["blur"], "skew", rec["skew"], "fields", len(rec["fields"]))
    (ROOT / "web" / "data" / "kyc_extracted.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
