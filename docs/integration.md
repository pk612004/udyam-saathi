# From prototype to production: what's mocked and what replaces it

Every external call lives in `web/js/services.js` (browser) or `server/app.py` (API). Swapping a mock for the real system is a change in one function, not in the journey.

| Step in the journey | Prototype | Production system | Contract we need |
|---|---|---|---|
| Sign-in without OTP | `verifyNumber()` mock | Airtel IQ Silent Authentication (CAMARA Number Verification) | `POST /number-verification/verify {phoneNumber}` → `{devicePhoneNumberVerified: bool}` |
| Fraud check at sign-up | inside `verifyNumber()` | CAMARA SIM Swap (live with Indian banks) | `POST /sim-swap/check {phoneNumber, maxAge: 240}` → `{swapped: bool}` |
| GSTIN lookup | `/api/gstin/<id>` on the data-pack registry | GSTN via a GST Suvidha Provider | GSTIN → legal name, trade name, address, status |
| Udyam lookup | `/api/udyam` on the data-pack registry | Udyam portal / Entity Locker | name + state → Udyam number, activity |
| Documents | Entity Locker "pull" simulated from specimens | MeitY Entity Locker (business DigiLocker) | consented pull of GST, Udyam certificates |
| OCR fallback | Tesseract + deskew + blur gate (`kyc/ocr_extract.py`) | Same pipeline, or an Indic OCR service | image → fields, with a quality score |
| Fibre feasibility | `fibreFeasible(pin)` demo rule | Airtel network inventory / GIS | PIN + address → fibre yes/no, install days |
| Setup EMI | `emiEligibility()` mock | Airtel Money (NBFC licence, Feb 2026) + Account Aggregator GST data | profile + consent → limit, tenure |
| Payment | `upiMandate()` mock | NPCI UPI AutoPay | mandate create → status, reference |
| Updates | WhatsApp cards in the UI | Airtel IQ (WhatsApp, SMS, RCS in one platform) | template message + delivery status |
| AI advisor | Any LLM through `/api/advisor` (bundled adapter: Groq / Gemini free tiers or any OpenAI-style API, Anthropic too; set `LLM_API_KEY`) | Same, or Sarvam for voice in 11 Indian languages | conversation → whitelisted profile fields |

## Rules that do not move to the model

The model only turns what the owner says into profile fields. The server drops any field or value it does not recognise (`clean_updates` in `server/app.py`, tested in `tests/test_server.py`). Product eligibility, prices and discounts always come from `web/js/engine.js`, which is tested against 14 adversarial cases.

## Known limits of this prototype

* The browser build ships the mock GST and Udyam registries as JSON so the demo works on static hosting. With `server/app.py`, lookups go through the API; in production the registries never reach the client.
* "Today" is fixed at 2026-07-15, as the data pack specifies.
* Names, the engineer "Ravi", order and consent IDs on screen are demo values.
