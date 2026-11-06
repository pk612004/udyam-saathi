"""API + static server for Udyam Saathi. Standard library only.

Run: python server/app.py   (put LLM_API_KEY in a .env file to turn on the AI advisor)
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]


def load_env(path):
    # tiny .env reader: KEY=value per line, # for comments; real env vars win
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env(ROOT / ".env")
WEB = ROOT / "web"
sys.path.insert(0, str(ROOT / "kyc"))
from validators import Registry, gstin_candidates, gstin_checksum_ok, validate  # noqa: E402

try:  # our own OCR (OpenCV + Tesseract); optional, the app runs without it
    import base64
    import shutil
    import numpy as np
    import cv2
    import pytesseract
    from ocr_extract import read_image
    _win = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if not shutil.which("tesseract") and os.path.exists(_win):
        pytesseract.pytesseract.tesseract_cmd = _win
    pytesseract.get_tesseract_version()
    OCR = True
except Exception:  # missing package or Tesseract binary
    OCR = False

MAX_BODY = 64 * 1024
MAX_IMAGE_BODY = 4 * 1024 * 1024  # uploads for /api/kyc/read
# LLM_PROVIDER: groq (free, default), gemini (free), anthropic, or openai (any OpenAI-style endpoint)
PROVIDERS = {
    "groq": ("https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-2.5-flash"),
    "anthropic": ("https://api.anthropic.com/v1/messages", "claude-sonnet-5-5"),
    "openai": ("", ""),
}
PROVIDER = os.environ.get("LLM_PROVIDER", "groq").lower()
if PROVIDER not in PROVIDERS:
    PROVIDER = "groq"
LLM_URL = os.environ.get("LLM_URL") or PROVIDERS[PROVIDER][0]
MODEL = os.environ.get("LLM_MODEL") or PROVIDERS[PROVIDER][1]
API_KEY = os.environ.get("LLM_API_KEY", "")
RATE = (20, 60)  # 20 advisor calls per 60 s per IP

REG = Registry()
REF = json.loads((WEB / "data" / "reference.json").read_text())
BUSINESS_TYPES = sorted({t for ts in REF["businessTypes"].values() for t in ts})
CITIES = sorted(REF["cities"])
NEEDS = ["payments", "whatsapp", "cctv", "wifi", "email", "security", "backup", "calls",
         "website", "storage", "manage", "machines", "fleet"]
_hits = defaultdict(deque)


def mask(g):
    return g[:6] + "*****" + g[11:] if isinstance(g, str) and len(g) == 15 else g


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ------------------------------------------------------------------ business logic
def lookup_gstin(raw):
    raw = re.sub(r"\s", "", raw.upper())[:20]
    for c in gstin_candidates(raw):
        if c in REG.gst and gstin_checksum_ok(c):
            legal, trade, constitution, address, state, reg_date, status = REG.gst[c]
            return {"gstin": c, "legal_name": legal, "trade_name": trade, "constitution": constitution,
                    "address": address, "state": state, "registration_date": reg_date, "status": status}
    return None


def lookup_udyam(name, state):
    from validators import similar
    for num, v in REG.udyam.items():
        if v[4] == state and similar(v[0], name) > 0.95:
            return {"udyam_number": num, "enterprise_name": v[0], "enterprise_type": v[1],
                    "major_activity": v[2], "nic_description": v[3], "state": v[4], "city": v[5]}
    return None


def clean_updates(u):
    # keep only fields/values we recognise - model output is never used as-is
    out = {}
    if not isinstance(u, dict):
        return out
    if u.get("business_type") in BUSINESS_TYPES:
        out["business_type"] = u["business_type"]
    if u.get("city") in CITIES:
        out["city"] = u["city"]
    for k, lo, hi in (("employees", 1, 5000), ("sites", 1, 500), ("monthly_spend_inr", 0, 10_000_000)):
        v = u.get(k)
        if isinstance(v, (int, float)) and lo <= v <= hi:
            out[k] = int(v)
    if isinstance(u.get("has_active_gstin"), bool):
        out["has_active_gstin"] = u["has_active_gstin"]
    if isinstance(u.get("needs"), list):
        out["needs"] = [n for n in u["needs"] if n in NEEDS][:13]
    oc = u.get("city_other")
    if isinstance(oc, str) and "city" not in out and re.fullmatch(r"[A-Za-z][A-Za-z .-]{1,39}", oc.strip()):
        out["city_other"] = oc.strip().title()
    g = u.get("gstin")
    if isinstance(g, str) and lookup_gstin(g):
        out["gstin"] = lookup_gstin(g)["gstin"]
    return out


SYSTEM = f"""You are Udyam Saathi, Airtel Business's onboarding advisor for small Indian businesses.
Reply in the same language and script the owner uses (Hindi, Hinglish, Tamil, English...). At most 3 short, warm sentences. No markdown, no product names or prices: the app shows the plan.
Your job is to understand the business: type, city, number of people, number of sites, monthly phone+internet spend, GST status and needs. Ask for what is missing, one or two things at a time.
Return ONLY a JSON object, with your message inside "reply" and nothing outside the JSON: {{"reply": "...", "updates": {{...}}}} where updates may contain
  business_type: one of {json.dumps(BUSINESS_TYPES)}. Pick the closest match to what the owner says
    (e.g. hotel or lodge -> "Budget hotel group", dhaba or cafe -> "Restaurant chain"). If nothing is close, leave it out and ask.
  city: one of {json.dumps(CITIES)}
  city_other: the city name, only if the owner's city is not in that list
  employees, sites, monthly_spend_inr: integers
  has_active_gstin: true/false
  gstin: 15-character GSTIN if the owner typed one
  needs: list from {json.dumps(NEEDS)}
Only include fields the owner actually told you. Never invent facts.
Never ask again for anything already in the known profile. If gstin_on_file is true, do not ask for a GSTIN.
If the owner says they have no GST (or no active GST), set has_active_gstin to false."""


HINGLISH = set("hai hain hoon hu kya kyu kyun mein mai main mera meri mere mujhe chahiye nahi nhi haan han bhai "
                "kaise kaisa aap aapka tum tumhara karo kro krna karna kitna kitne accha acha theek thik bhi aur "
                "dukaan dukan chalata chalati wala wali batao bataiye ji ka ki ke ko se yeh ye wo hamara hamari humara apna".split())
SCRIPTS = [("\u0900", "\u097f", "Hindi in Devanagari script"), ("\u0b80", "\u0bff", "Tamil"),
           ("\u0c00", "\u0c7f", "Telugu"), ("\u0c80", "\u0cff", "Kannada"), ("\u0980", "\u09ff", "Bengali"),
           ("\u0a00", "\u0a7f", "Punjabi in Gurmukhi script"), ("\u0a80", "\u0aff", "Gujarati"),
           ("\u0d00", "\u0d7f", "Malayalam"), ("\u0b00", "\u0b7f", "Odia")]


def detect_lang(text):
    for lo, hi, name in SCRIPTS:
        if any(lo <= ch <= hi for ch in text):
            return name
    words = re.findall(r"[a-z]+", text.lower())
    hits = sum(w in HINGLISH for w in words)
    if hits >= 2 or (words and hits / len(words) >= 0.3):
        return "Hinglish (Hindi written in English letters, no Devanagari)"
    return "English"


def redact(text):
    # personal numbers never leave our server; GSTINs stay (public business registry data)
    text = re.sub(r"(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)", "[aadhaar removed]", text)
    text = re.sub(r"(?<![\dA-Z])(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)", "[phone removed]", text)
    text = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "[email removed]", text)
    return text


def call_llm(history, profile):
    msgs = [{"role": m["role"], "content": redact(str(m["content"])[:2000])} for m in history[-12:]
            if m.get("role") in ("user", "assistant") and m.get("content")]
    if not msgs or msgs[-1]["role"] != "user":
        raise ValueError("conversation must end with the owner's message")
    lang = detect_lang(msgs[-1]["content"])
    msgs[-1]["content"] += (f"\n\n[Known profile so far: {json.dumps(profile)[:1500]}]"
                            f"\n[The owner wrote this message in {lang}. Your reply MUST be in {lang}.]")
    if PROVIDER == "anthropic":
        body = {"model": MODEL, "max_tokens": 400, "system": SYSTEM, "messages": msgs}
        headers = {"x-api-key": API_KEY, "anthropic-version": "2023-06-01"}
    else:
        body = {"model": MODEL, "max_tokens": 1200, "temperature": 0.3,
                "messages": [{"role": "system", "content": SYSTEM}] + msgs}
        body["response_format"] = {"type": "json_object"}
        if "gpt-oss" in MODEL:  # reasoning model: keep thinking short so the reply fits
            body["reasoning_effort"] = "low"
        headers = {"authorization": f"Bearer {API_KEY}"}
    headers["content-type"] = "application/json"
    headers["user-agent"] = "udyam-saathi/1.0"  # Groq's CDN blocks the default Python-urllib agent
    data = post_json(body, headers)
    text = reply_text(data)
    if not text.strip():
        raise ValueError("model returned an empty reply")
    return parse_model_json(text)


def post_json(body, headers):
    def send(b):
        req = urllib.request.Request(LLM_URL, data=json.dumps(b).encode(), method="POST", headers=headers)
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    try:
        return send(body)
    except urllib.error.HTTPError as e:
        if e.code != 400 or "response_format" not in body:
            raise
        log("advisor: provider refused JSON mode, retrying without it")
        return send({k: v for k, v in body.items() if k != "response_format"})


def reply_text(data):
    if "choices" in data:  # OpenAI-style (Groq, Gemini)
        return (data["choices"][0].get("message") or {}).get("content") or ""
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")


def parse_model_json(text):
    m = re.search(r"\{.*\}", text, re.S)
    try:
        obj = json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        obj = {}
    if not isinstance(obj, dict):
        obj = {}
    reply = obj.get("reply")
    if not isinstance(reply, str) or not reply.strip():
        # model wrote plain text and tacked JSON on: show only the text
        reply = (text[:m.start()] + text[m.end():]) if m else text
    reply = reply.strip() or "Sorry, could you say that again?"
    return {"reply": reply[:600], "updates": clean_updates(obj.get("updates", {}))}


def rate_ok(ip):
    q, now = _hits[ip], time.time()
    while q and now - q[0] > RATE[1]:
        q.popleft()
    if len(q) >= RATE[0]:
        return False
    q.append(now)
    return True


# ------------------------------------------------------------------ HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def log_message(self, fmt, *args):  # mask GSTINs
        log(re.sub(r"\b\d{2}[A-Z0-9]{13}\b", lambda m: mask(m.group(0)), fmt % args))

    def send_json(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(b)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def read_json(self):
        n = int(self.headers.get("content-length") or 0)
        if n > (MAX_IMAGE_BODY if self.path.startswith("/api/kyc/read") else MAX_BODY):
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/health":
            return self.send_json(200, {"ok": True, "ai": bool(API_KEY), "ocr": OCR})
        if u.path.startswith("/api/gstin/"):
            rec = lookup_gstin(unquote(u.path.rsplit("/", 1)[-1]))
            return self.send_json(200, rec) if rec else self.send_json(404, {"error": "GSTIN not found"})
        if u.path == "/api/udyam":
            q = parse_qs(u.query)
            rec = lookup_udyam(q.get("name", [""])[0][:120], q.get("state", [""])[0][:60])
            return self.send_json(200, rec) if rec else self.send_json(404, {"error": "No Udyam match"})
        if u.path.startswith("/api/"):
            return self.send_json(404, {"error": "unknown endpoint"})
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        try:
            body = self.read_json()
        except (ValueError, json.JSONDecodeError) as e:
            return self.send_json(400, {"error": str(e)})
        if u.path == "/api/kyc/validate":
            docs = body.get("docs")
            if not isinstance(docs, dict):
                return self.send_json(400, {"error": "docs must be an object"})
            return self.send_json(200, validate(str(body.get("applicant", "API"))[:20], docs, REG))
        if u.path == "/api/kyc/read":
            if not OCR:
                return self.send_json(501, {"error": "OCR not installed on this server"})
            try:
                raw = base64.b64decode(str(body.get("image", "")).split(",")[-1], validate=True)
                img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            except (ValueError, TypeError):
                img = None
            if img is None:
                return self.send_json(400, {"error": "not an image"})
            doc = read_image(img, "gst_certificate", ocr_scale=2.0 if img.shape[1] < 1600 else 1.0)
            res = validate("Upload", {"gst_certificate": doc}, REG)
            checks = [c for c in res["checks"] if c["id"].startswith("gst")]
            return self.send_json(200, {"blur": doc["blur"], "skew": doc["skew"], "deskewed": doc["deskewed"],
                                        "readable": doc["readable"], "checks": checks})
        if u.path == "/api/advisor":
            if not API_KEY:
                return self.send_json(503, {"error": "AI advisor not configured"})
            if not rate_ok(self.client_address[0]):
                return self.send_json(429, {"error": "too many requests"})
            try:
                return self.send_json(200, call_llm(body.get("history") or [], body.get("profile") or {}))
            except ValueError as e:
                log(f"advisor: {e}")
                return self.send_json(400, {"error": str(e)})
            except urllib.error.HTTPError as e:
                detail = e.read()[:300].decode("utf-8", "replace")
                hint = {401: "key galat hai - .env check karo", 403: "request blocked", 404: "model/URL galat hai",
                        429: "free limit poori - thodi der baad try karo"}.get(e.code, "")
                log(f"advisor upstream HTTP {e.code} {hint}: {detail}")
                return self.send_json(502, {"error": f"AI service error {e.code}"})
            except (urllib.error.URLError, TimeoutError) as e:
                log(f"advisor upstream error (internet?): {e}")
                return self.send_json(502, {"error": "AI service unavailable"})
            except Exception as e:  # bad/odd upstream payload
                log(f"advisor failed: {type(e).__name__}: {e}")
                return self.send_json(502, {"error": "AI service returned something unexpected"})
        return self.send_json(404, {"error": "unknown endpoint"})


def main(port=None):
    port = port or int(os.environ.get("PORT", 8000))
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    log(f"Udyam Saathi on http://localhost:{port}  (AI advisor {'on via ' + PROVIDER + ' / ' + MODEL if API_KEY else 'off: set LLM_API_KEY'})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
