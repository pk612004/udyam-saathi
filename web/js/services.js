// All external systems go through here. Most are mocked for the demo - see docs/integration.md.

export const MODE = { api: false, ai: false, ocr: false };

export async function detectApi() {
  try {
    const r = await fetch("api/health", { cache: "no-store" });
    if (r.ok) { const j = await r.json(); MODE.api = !!j.ok; MODE.ai = !!(j.ok && j.ai); MODE.ocr = !!(j.ok && j.ocr); }
  } catch { /* static hosting: stay in browser-only mode */ }
  return MODE;
}

// mock: Airtel IQ number verification + SIM swap
export async function verifyNumber() {
  return { verified: true, masked: "98•••••410", simSwappedRecently: false, existingAirtelMobile: true, since: 2019 };
}

// mock: fibre check by PIN (demo rule - PINs ending in 3 have no fibre)
export async function fibreFeasible(pin) {
  return pin ? !pin.endsWith("3") : null;
}

// mock: Airtel Money EMI
export async function emiEligibility(profile) {
  return { approved: true, basis: profile.gstActive ? "GST filings shared through Account Aggregator" : "on-time Airtel bill history" };
}

// mock: UPI AutoPay
export async function upiMandate(monthly) {
  return { approved: true, cap: Math.round(monthly * 1.2), ref: "UPI-MND-" + Date.now().toString().slice(-6) };
}

// real call when served by server/app.py
export async function advisorTurn(history, profile) {
  const r = await fetch("api/advisor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ history, profile }) });
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || r.statusText), { code: r.status });
  return r.json();
}

// our OCR on the server (OpenCV + Tesseract): GST certificate photo -> checks
export async function readGstPhoto(dataUrl) {
  const r = await fetch("api/kyc/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
