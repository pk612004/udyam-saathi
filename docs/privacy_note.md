# Udyam Saathi: data privacy and security note

Udyam Saathi handles business and personal data (GSTIN, Udyam number, address, signatory name and ID). We designed it as if this were live customer data under the **Digital Personal Data Protection Act, 2023** and the **DPDP Rules, 2025**. The Rules were notified on 13 Nov 2025, Consent Manager registration opens on 13 Nov 2026, and full obligations apply from 13 May 2027.

## 1. Consent before KYC
- A plain-language notice appears before any document is fetched. It lists what we fetch, why, how long we keep it, and how to withdraw consent.
- Consent is itemised (documents, Account Aggregator data for EMI, WhatsApp updates) and logged with an ID, time and scope.
- Withdrawal takes one tap from the app, the same effort as giving consent. The consent ledger is built so it can plug into a registered Consent Manager.
- An owner who taps "Not now" keeps their saved quote, with nothing fetched.

## 2. Purpose limitation and data minimisation
| Step | What we collect | What we don't |
|---|---|---|
| Sign-up | Network-verified mobile number (Airtel IQ Silent Auth), so no OTP is stored | Aadhaar number, date of birth |
| Advisor | Business type, city, size, needs, rough monthly spend | Revenue figures, bank details |
| KYC | GSTIN, Udyam number, one address proof, signatory name and ID validity | Full ID images once they are verified |
| EMI (optional) | GST filings via Account Aggregator, only if the owner opts in | Anything when the EMI is declined |

- When the registry already has a fact, we fetch it from the registry rather than asking for an upload. Entity Locker comes first and OCR is the fallback.
- A business without a GSTIN gets a GST-free bundle. We never ask for documents the order doesn't need.

## 3. Retention
- Document images are deleted 30 days after activation (or after cancellation). We keep only the verification result, the date and the registry reference.
- Unconverted leads in the partner console are purged after 180 days.
- The consent record is kept for the period the Rules require, even after the data itself is deleted.

## 4. Security
- Identifiers are masked in the UI and logs (for example `27XUIX•••••1ZP`, `98•••••410`). Raw values live only in the encrypted KYC store.
- Data is encrypted in transit (TLS 1.2+) and at rest (AES-256), with keys in a managed KMS.
- Role-based access: partners see only leads they sourced, with no documents. KYC reviewers see documents only for cases flagged for manual review.
- Fraud controls: a SIM-swap check before onboarding, a GSTIN status check before activation, and a document tamper signal from checksum failures and registry mismatches.
- Every rule decision is logged and explainable. The demo's "Under the hood" panel shows the same audit trail.
- Data is stored and processed in India.

## 5. AI-specific safeguards
- The AI advisor never decides eligibility or price. It proposes; a deterministic rules engine validates every product against the catalogue rules before the owner sees it.
- The advisor receives only the chat and the business profile, never document images. Before any text leaves our server, Aadhaar numbers, phone numbers and email addresses are replaced with placeholders.
- Free-text chat is processed by an external LLM provider (Groq in the prototype) acting as our data processor. In production this would run under a processor contract or on an India-hosted model; the app works fully in tap-through mode if the owner prefers not to type.
- AI document reading is a convenience. Every extracted field is re-checked against the registries, and low-quality images are rejected before reading.

## 6. Owner rights
Owners can view, correct, export or erase their data from the app. Grievances are answered within the timeline the DPDP Rules set.
