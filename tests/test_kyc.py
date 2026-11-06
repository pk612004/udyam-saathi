"""KYC should catch every planted problem and pass the clean applicants."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "kyc"))
from validators import Registry, gstin_checksum_ok, validate  # noqa: E402

EXPECTED = {
    "K01": ("Rejected for now", "gst.status"),       # GSTIN cancelled (+ Udyam number blank)
    "K02": ("Approved", None),                        # tilted photo, straightened then read
    "K03": ("Approved", None),
    "K04": ("Retake photo", "gst.quality"),           # blurred GST certificate
    "K05": ("Approved", None),                        # Udyam missing -> auto-fetched
    "K06": ("Rejected for now", "gst.format"),        # one digit changed, checksum fails
    "K07": ("Rejected for now", "gst.legal"),         # legal name differs from registry
    "K08": ("Approved", None),
    "K09": ("Approved", None),
    "K10": ("Approved", None),                        # OCR I/J look-alike corrected
    "K11": ("Rejected for now", "addr.age"),          # bill 257 days old
    "K12": ("Approved", None),
}


def results():
    reg = Registry()
    ext = json.loads((ROOT / "web" / "data" / "kyc_extracted.json").read_text())
    return {k: validate(k, v, reg) for k, v in ext.items()}


def test_verdicts():
    res = results()
    for app, (verdict, blocking_id) in EXPECTED.items():
        r = res[app]
        assert r["verdict"] == verdict, (app, r["verdict"])
        if blocking_id:
            assert any(c["id"] == blocking_id and c["status"] == "block" for c in r["checks"]), app


def test_side_findings():
    res = results()
    k01 = {c["id"]: c for c in res["K01"]["checks"]}
    assert k01["udyam.present"]["status"] == "warn"
    k05 = {c["id"]: c for c in res["K05"]["checks"]}
    assert "UDYAM-KL-00-5521886" in k05["udyam.present"]["detail"]
    k02 = {c["id"]: c for c in res["K02"]["checks"]}
    assert k02["gst.skew"]["status"] == "info"


def test_checksum():
    assert gstin_checksum_ok("27XUIXG0767D1ZP")
    assert not gstin_checksum_ok("08YKZXS8189L1ZO")
