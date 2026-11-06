"""Scores lost leads so sales calls the likely ones first. Uses only fields known when the lead comes in."""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ["lead_source", "segment", "city_tier", "preferred_language", "employee_count", "num_sites",
            "annual_turnover_band", "has_gstin", "has_udyam", "current_internet", "current_provider",
            "monthly_telecom_spend_inr", "contact_role"]

NEXT_ACTION = {
    "Unreachable after 3 attempts": "Send WhatsApp self-serve link",
    "Wrong or invalid number": "Verify number via partner",
    "Not interested on first call": "Nurture: savings X-ray on WhatsApp",
    "Owner had no time for a visit": "Send 4-min advisor link",
    "Visit not scheduled by sales": "Send 4-min advisor link",
    "Locked in with current provider": "Reminder at contract end",
    "Only wanted a mobile plan": "Mobile-only checkout link",
    "Price too high": "Offer EMI on setup + savings X-ray",
    "Competitor offered cheaper plan": "Savings X-ray vs competitor",
    "Quote too complex to understand": "Resend plain-language quote",
    "Quote took too long to arrive": "Resend instant quote",
    "Decided to wait": "Saved quote reminder",
    "Missing GST or Udyam document": "Auto-fetch from registry",
    "Found paperwork too long": "Zero-upload KYC link",
    "Authorised signatory not available": "Remote e-sign link to signatory",
    "Document details did not match": "Guided fix of mismatched field",
    "Installation delayed beyond 21 days": "Offer Day-1 AirFiber bridge",
    "Site not feasible for fibre": "Offer 5G AirFiber",
    "First payment failed": "UPI AutoPay retry",
    "Customer cancelled before install": "Partner call-back",
}


def main():
    d = pd.read_csv(ROOT / "data" / "smb_leads.csv")
    y = (d.outcome == "Activated").astype(int).values
    X = pd.get_dummies(d[FEATURES].astype({"city_tier": str}))
    model = GradientBoostingClassifier(random_state=7)
    cv = StratifiedKFold(5, shuffle=True, random_state=7)
    p = cross_val_predict(model, X, y, cv=cv, method="predict_proba")[:, 1]
    auc = roc_auc_score(y, p)
    order = np.argsort(-p)
    lift = {f"top{k}": round(float(y[order[: int(k / 100 * len(y))]].sum() / y.sum()), 3) for k in (10, 20, 30)}
    model.fit(X, y)
    imp = pd.Series(model.feature_importances_, X.columns).sort_values(ascending=False).head(10)
    metrics = {"auc_cv5": round(auc, 3), "capture": lift, "top_features": imp.round(3).to_dict()}
    (ROOT / "model" / "metrics.json").write_text(json.dumps(metrics, indent=2))

    d["score"] = (p * 100).round(0).astype(int)
    pct = pd.Series(p).rank(pct=True).values
    d["band"] = np.where(pct >= 0.8, "Hot", np.where(pct >= 0.5, "Warm", "Cold"))
    lost = d[d.outcome == "Dropped"].copy()
    lost["action"] = lost.drop_reason.map(NEXT_ACTION)
    cols = ["lead_id", "business_name", "business_type", "segment", "city", "city_tier", "preferred_language",
            "lead_source", "stage_reached", "drop_reason", "has_gstin", "monthly_telecom_spend_inr",
            "products_of_interest", "score", "band", "action"]
    rows = lost.sort_values("score", ascending=False)[cols].values.tolist()
    (ROOT / "web" / "data" / "leads.json").write_text(json.dumps({"cols": cols, "rows": rows}, default=int))
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
