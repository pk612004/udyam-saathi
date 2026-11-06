# Udyam Saathi

Team **sync_x** (Prakash Kumar, Arshdeep Singh) · Thapar Institute of Engineering and Technology
Airtel Sync 2026, Digital Track

A shop owner should be able to get internet, business SIMs, billing and CCTV from Airtel on their phone, in one go, without waiting for a salesman. Right now only 7.4% of small-business leads in the data pack end up as customers. This is our attempt at fixing that.

## What it does

- **Advisor** – asks a few questions (or reads them from a GSTIN) and suggests a plan. Works in English and Hindi; with an API key it also understands free text in other languages.
- **Rules engine** (`web/js/engine.js`) – checks every product against city tier, staff size, sites, GST and dependencies. Whatever suggests the plan, this decides what can actually be sold.
- **Quote** – one monthly price, add-ons you can switch off, setup on EMI, and a comparison with what the shop pays today.
- **KYC** (`kyc/`) – blur check, auto-straighten, OCR, then GSTIN checksum and registry checks. If something is wrong it says how to fix it instead of just rejecting.
- **Tracker** – a realistic go-live date, AirFiber in the meantime if fibre is slow, updates on WhatsApp.
- **Leads to call** (`model/propensity.py`) – scores the leads that didn't close so sales calls the likely ones first.
- **The data** – where the 4,632 lost leads dropped off, and a what-if slider for the impact.

Airtel and government services (number verification, Entity Locker, Airtel Money, UPI AutoPay, fibre check) are mocked. GST and Udyam lookups use the registries in the data pack.

## Results

On the data pack we were given:

- KYC: caught all 7 planted problems in the 12 sample applicants, and approved the 5 clean ones.
- Advisor: passes our 14 edge-case tests (e.g. no 1 Gbps fibre in tier-2 cities, no WhatsApp API without GST).
- Lead model: AUC 0.69; the top 20% of leads by score contain 37% of all sign-ups.
- In the leads data: 48 customers were sold plans they weren't eligible for, 22 were activated on a cancelled/suspended GSTIN, and customers who called 5 times to ask about their order churned at 28% (vs 6% for one call).
- Estimate: 7.4% → about 15.8% conversion, roughly ₹14 crore a year more. The assumptions are in `analysis/build_assets.py`.

## Running it

Needs Python 3.10+. Nothing else for the app itself.

```bash
python server/app.py            # open http://localhost:8000
```

To turn on the free-text AI advisor, get a free key and set it before starting. Without a key the app still works in tap-through mode.

| Provider | Free key from | Set |
|---|---|---|
| Groq (default) | console.groq.com → API Keys | `LLM_API_KEY` |
| Google Gemini | aistudio.google.com → Get API key | `LLM_PROVIDER=gemini` + `LLM_API_KEY` |

Copy `.env.example` to `.env` in the project folder and paste your key:

```
LLM_API_KEY=gsk_your_key_here
```

Then run `python server/app.py` as usual. `.env` is in `.gitignore`, so the key never reaches GitHub.

`LLM_MODEL` and `LLM_URL` override the defaults. Never commit the key.

**Photo upload in the KYC tab** uses our own OCR (OpenCV + Tesseract), not the AI. To turn it on:

```
pip install opencv-python-headless pytesseract numpy
```

and install Tesseract (Windows: the UB Mannheim installer, default folder is fine; Mac: `brew install tesseract`; Linux: `apt install tesseract-ocr`). The server finds it on its own and logs nothing if it's missing; the upload box then says it needs the server.

Other commands:

```bash
make test     # Python tests + JS tests
make data     # rebuild web/data from data/ (pip install -r requirements.txt, and tesseract)
make demo     # static version, no server
```

For a public link, the `web/` folder can be hosted as-is on GitHub Pages; only the free-text advisor needs the server.

## Folders

```
web/        the app (index.html, js/, data/)
server/     small API server: lookups, KYC check, AI advisor
kyc/        OCR + KYC validation
model/      lead scoring
analysis/   builds web/data from the data pack
tests/      tests
docs/       privacy note, integration notes
data/       the data pack from the organisers (synthetic)
```

More detail: `docs/privacy_note.md` (DPDP choices) and `docs/integration.md` (what each mock would be replaced with).
