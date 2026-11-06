# Udyam Saathi

Team **sync_x** (Prakash Kumar, Arshdeep Singh) · Thapar Institute of Engineering and Technology
Airtel Sync 2026, Digital Track

**▶ Live app:** https://udyam-saathi-9ib8.onrender.com

**🎬 Demo video (3:29):** https://youtu.be/-m-4reuhiA4

> The live app runs on a free server. If it takes a few seconds to open the first time, it's waking up. Everything works online except the photo upload in the KYC tab, which needs Tesseract and runs locally (see the video).

---

## The problem

A shop owner who wants Airtel Business today waits for a salesman, gets a quote days later, hands over four documents, and waits about two weeks to go live. In the data pack, only **7.4%** of 5,000 small-business leads became customers. 827 were lost only because a salesperson never reached them.

## What we built

Udyam Saathi lets the owner do all of it on one phone, in their own language: tell us about the shop, get the right plan with one monthly price, finish KYC without uploading anything, pay by UPI AutoPay, and track the install on WhatsApp.

| What the case asked for | What we built | Where |
|---|---|---|
| **Advisor** that asks about the business and recommends a bundle in plain language | Chat in English, Hindi, Hinglish or any Indian script. Every plan item says why it's there. | `server/app.py`, `web/js/app.js` |
| **Quote and checkout** with one monthly price and add-ons to toggle | One price, add-ons on/off, comparison with today's bill, setup on EMI | `web/js/engine.js` |
| **Smart KYC**: upload, extraction, validation, GSTIN/Udyam lookup, consent | Blur check, auto-straighten, OCR, GSTIN checksum, registry match, clear consent screen | `kyc/`, `server/app.py` |
| **Tracker** so the owner doesn't call support | Realistic go-live date, WhatsApp updates, AirFiber in the meantime if fibre is late | `web/js/app.js` |
| *Stretch:* back-office view of leads the advisor didn't close | "Leads to call": every lost lead with the next step that fits why they left | `web/js/app.js` |
| *Stretch:* propensity score for which leads to call | Gradient boosting model, AUC 0.69 | `model/propensity.py` |

## What's new about it

1. **The AI talks, the rules decide.** The language model only understands the owner. A rules engine checks every product against city tier, staff size, sites, GST status and product dependencies before anything is shown. Last quarter 48 customers were sold plans they weren't eligible for; this design can't do that. The model's output is allow-listed, so it can't invent products or fields.
2. **One GSTIN fills the form.** Type the GST number and the name, address, city and business type come from the registry.
3. **KYC that fixes instead of rejecting.** A tilted photo gets straightened, a missing Udyam is fetched from the registry, a cancelled GST gets a plan that doesn't need GST. Only real problems (an edited document, a name that doesn't match) stop the order, and each one says exactly what to do next.
4. **Nothing to upload.** Documents come from Entity Locker and the GST/Udyam registries; the signatory e-signs on WhatsApp.
5. **Price stops being a blocker.** The quote is compared with what the shop pays today, and the setup fee can be split into six payments with Airtel Money.
6. **No shop waits 17 days.** If fibre is slow, 5G AirFiber goes in first.
7. **Partners stay on side.** A partner who brought the lead keeps the commission even if it closes online.
8. **Every lost lead gets the right next step**, matched to why it dropped: paperwork too long → zero-upload KYC link; visit never booked → 4-minute advisor link; installation delayed → AirFiber offer.
9. **Privacy built in (DPDP).** Consent screen before any data, documents deleted 30 days after activation, GSTINs masked in logs, and Aadhaar numbers, phone numbers and emails removed before any text reaches the AI.

## Test results

All of these run on the data pack the organisers gave us.

### KYC: 12 sample applicants, 7 planted problems, all 7 caught

| Applicant | Problem | What we did | Result |
|---|---|---|---|
| K01 Vindhya Tours | GST cancelled | Stopped, offered a plan without GST | Paused |
| K02 Harmony Dental | Tilted photo | Straightened it automatically | ✅ Approved |
| K03 Ganesh Woodcraft | None | | ✅ Approved |
| K04 Saffron Dental | Blurry photo | Asked for a retake | Retake photo |
| K05 Balaji Realty | Udyam certificate missing | Fetched from the registry | ✅ Approved |
| K06 Saffron Salon | GSTIN edited | Checksum failed; registry shows the real number | Paused |
| K07 Neelgiri Physio | Legal name doesn't match | Stopped for review | Paused |
| K08 Green Leaf Legal | None | | ✅ Approved |
| K09 Kaveri Insurance | None | | ✅ Approved |
| K10 Kaveri Stays | None | | ✅ Approved |
| K11 Trinity Bake House | Electricity bill 257 days old (limit 90) | Asked for a recent bill | Paused |
| K12 Star Electronics | None | | ✅ Approved |

The same checks run in Python (server) and JavaScript (browser); all 12 verdicts match.

### Advisor rules: 14 of 14 edge cases pass

- Tier-2 clinic never gets 1 Gbps fibre; a tier-1 office can
- No GST → no WhatsApp Business API, and the owner is told why
- No GST → no bulk SMS, telephony or firewall
- SD-WAN refused for 2 sites, offered for 8
- No fibre at the address → AirFiber, without fibre-only add-ons
- Manufacturer with 30 staff → 100 Mbps leased line
- Small manufacturer with 6 staff → no machine IoT
- Kirana → lean bundle with an owner SIM
- Multi-site business → one line per site
- Firewall only for 10+ staff
- No needs given → sensible defaults from similar businesses
- Quote → one monthly price with the saving against today's bill

### Lead model

- 5-fold cross-validated AUC **0.69**
- The top 20% of leads by score contain **37%** of all sign-ups (random would be 20%)
- Strongest signals: current telecom spend, staff size, segment, referral source

### What the leads data showed

- **48** customers were sold products they weren't eligible for (mostly 1 Gbps fibre in tier-2 cities)
- **22** were switched on with a cancelled or suspended GSTIN
- **54%** ended up with none of the products they first asked about
- Customers who called **5 times** about their order churned at **28%**, against 6% for one call

### Impact (estimate)

**7.4% → about 15.8%** sign-ups: roughly 424 more customers a quarter and about **₹14 crore** more a year. We assumed only a careful share of each fixable drop comes back, and didn't count drops we can't fix (wrong number, not interested). The "The data" tab has sliders to change every assumption. Details in `analysis/build_assets.py`.

### Automated tests

- **17** Python tests (server, KYC, AI output handling, privacy)
- **14** advisor rule tests (JavaScript)
- **12** KYC parity checks (Python vs JavaScript)
- GitHub Actions runs them on every push

## Tech stack

| Part | Tools |
|---|---|
| App | HTML, CSS, JavaScript (ES modules), no framework |
| Server | Python standard library only |
| AI | Groq (`openai/gpt-oss-120b`, free tier); Gemini or Anthropic also supported |
| KYC | OpenCV, Tesseract OCR, GSTIN checksum, fuzzy name matching |
| Lead model | pandas, scikit-learn (gradient boosting) |
| Tests | pytest, Node, GitHub Actions |
| Hosting | Render |

Airtel and government services (number check, Entity Locker, Airtel Money, UPI AutoPay, fibre check, e-sign) are mocked and labelled in the app. GST and Udyam lookups use the registries in the data pack. `docs/integration.md` lists what each mock would be replaced with.

## Running it locally

Needs Python 3.10+. Nothing else for the app itself.

```bash
python server/app.py            # open http://localhost:8000
```

To turn on the AI advisor, get a free key and put it in a `.env` file in the project folder (copy `.env.example`):

```
LLM_API_KEY=gsk_your_key_here
```

| Provider | Free key from | Set |
|---|---|---|
| Groq (default) | console.groq.com → API Keys | `LLM_API_KEY` |
| Google Gemini | aistudio.google.com → Get API key | `LLM_PROVIDER=gemini` + `LLM_API_KEY` |

`.env` is in `.gitignore`, so the key never reaches GitHub. Without a key the app still works in tap-through mode.

**Photo upload in the KYC tab** uses our own OCR, not the AI:

```
python -m pip install opencv-python-headless pytesseract numpy
```

and install Tesseract (Windows: `winget install --id tesseract-ocr.tesseract -e`; Mac: `brew install tesseract`; Linux: `apt install tesseract-ocr`). The server finds it on its own.

Other commands:

```bash
make test     # Python tests + JS tests
make data     # rebuild web/data from data/ (pip install -r requirements.txt, and tesseract)
```

The live link runs `python server/app.py` on Render (free plan), with `LLM_API_KEY` set in Render's environment settings, not in the repo.

## Folders

```
web/        the app (index.html, js/, data/)
server/     API server: lookups, KYC check, AI advisor
kyc/        OCR + KYC validation
model/      lead scoring
analysis/   builds web/data from the data pack
tests/      tests
docs/       privacy note, integration notes, architecture
data/       the data pack from the organisers (synthetic)
```

More detail: `docs/privacy_note.md` (DPDP choices) and `docs/integration.md` (what each mock would be replaced with).