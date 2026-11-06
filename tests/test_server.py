"""API server tests."""
import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import app  # noqa: E402

srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}"


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"content-type": "application/json"}, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_health_and_static():
    assert call("/api/health")[0] == 200
    with urllib.request.urlopen(BASE + "/index.html") as r:
        assert b"Udyam Saathi" in r.read()


def test_gstin_lookup_fixes_ocr_lookalikes():
    code, rec = call("/api/gstin/27XUIXGO767D1ZP")          # letter O where a zero belongs
    assert code == 200 and rec["gstin"] == "27XUIXG0767D1ZP" and rec["trade_name"] == "Ganesh Woodcraft"
    assert call("/api/gstin/08YKZXS8189L1ZO")[0] == 404      # tampered digit: checksum fails


def test_udyam_lookup():
    code, rec = call("/api/udyam?name=Balaji%20Realty%20LLP&state=Kerala")
    assert code == 200 and rec["udyam_number"] == "UDYAM-KL-00-5521886"


def test_kyc_validate_matches_pipeline():
    ext = json.loads((ROOT / "web/data/kyc_extracted.json").read_text())
    code, res = call("/api/kyc/validate", {"applicant": "K11", "docs": ext["K11"]})
    assert code == 200 and res["verdict"] == "Rejected for now"
    assert call("/api/kyc/validate", {"docs": "nope"})[0] == 400


def test_advisor_off_without_key():
    if not app.API_KEY:
        assert call("/api/advisor", {"history": [{"role": "user", "content": "hi"}]})[0] == 503


def test_model_output_is_never_trusted():
    out = app.parse_model_json('Sure! {"reply": "Namaste", "updates": {"business_type": "Rocket factory", '
                               '"city": "Mumbai", "employees": -4, "sites": 3, "needs": ["cctv", "free iPhone"], '
                               '"gstin": "27XUIXG0767D1ZP", "discount": 90}}')
    assert out["reply"] == "Namaste"
    assert out["updates"] == {"city": "Mumbai", "sites": 3, "needs": ["cctv"], "gstin": "27XUIXG0767D1ZP"}
    assert app.parse_model_json("not json at all")["updates"] == {}


def test_masking():
    assert app.mask("27XUIXG0767D1ZP") == "27XUIX*****D1ZP"


def test_reads_openai_and_anthropic_replies():
    groq = {"choices": [{"message": {"content": '{"reply": "Ho jayega", "updates": {}}'}}]}
    claude = {"content": [{"type": "text", "text": '{"reply": "Ho jayega", "updates": {}}'}]}
    assert app.parse_model_json(app.reply_text(groq))["reply"] == "Ho jayega"
    assert app.parse_model_json(app.reply_text(claude))["reply"] == "Ho jayega"


def test_env_file_is_read(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text('# comment\nUS_TEST_KEY="abc123"\n\nBROKEN LINE\n')
    monkeypatch.delenv("US_TEST_KEY", raising=False)
    app.load_env(f)
    assert app.os.environ["US_TEST_KEY"] == "abc123"


def test_reply_language_follows_the_owner():
    assert app.detect_lang("why are u replying in hindi ?") == "English"
    assert app.detect_lang("how are you ?") == "English"
    assert app.detect_lang("main kirana chalata hoon, UPI chahiye").startswith("Hinglish")
    assert app.detect_lang("मुझे वाईफाई चाहिए").startswith("Hindi")
    assert app.detect_lang("எனக்கு இணையம் வேண்டும்") == "Tamil"


def test_unknown_city_is_kept_but_marked():
    assert app.clean_updates({"city": "Patiala"}) == {}
    assert app.clean_updates({"city_other": "patiala"}) == {"city_other": "Patiala"}
    assert app.clean_updates({"city_other": "<script>"}) == {}
    assert app.clean_updates({"city": "Ludhiana", "city_other": "Patiala"}) == {"city": "Ludhiana"}


def test_personal_numbers_never_reach_the_model():
    out = app.redact("Aadhaar 1234 5678 9012, call 9876543210 or +91-9876543210, mail a.b@x.com, GSTIN 27DIDXN3795G1ZF")
    assert "1234" not in out and "9876543210" not in out and "a.b@x.com" not in out
    assert "27DIDXN3795G1ZF" in out


def test_messy_model_output_never_shows_json():
    out = app.parse_model_json('Great! Which city is your hotel located in? {"updates":{}}')
    assert out["reply"] == "Great! Which city is your hotel located in?"
    out = app.parse_model_json('Thanks! How many sites? {"updates": {"employees": 4}}')
    assert out["reply"] == "Thanks! How many sites?" and out["updates"] == {"employees": 4}
    assert app.parse_model_json('{"reply": "Namaste", "updates": {}}')["reply"] == "Namaste"
    assert app.parse_model_json("")["reply"]


def test_uploaded_gst_photo_is_read_and_checked():
    import base64
    import pytest
    if not app.OCR:
        pytest.skip("Tesseract not installed")
    def read(k):
        img = (Path(__file__).resolve().parents[1] / "web" / "kyc" / f"{k}_gst_certificate.jpg").read_bytes()
        return call("/api/kyc/read", {"image": "data:image/jpeg;base64," + base64.b64encode(img).decode()})[1]
    tilted = read("K02")
    assert tilted["deskewed"] and all(c["status"] in ("pass", "info") for c in tilted["checks"])
    assert any(c["status"] == "block" for c in read("K06")["checks"])  # edited GSTIN
    assert not read("K04")["readable"]  # blurred
