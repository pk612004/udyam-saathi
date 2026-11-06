"""Turns the data pack into the JSON files the web app loads (web/data/)."""
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "web" / "data"
OUT.mkdir(parents=True, exist_ok=True)

SEG_KEY = {
    "Micro retail & services": "micro",
    "Professional offices": "prof",
    "Small multi-site businesses": "multi",
    "Small manufacturers": "mfg",
}
STAGES = ["Lead", "Contacted", "Needs assessed", "Quote accepted", "KYC complete", "Activated"]

# Which part of our journey answers each drop reason, and a conservative recovery share
FIX = {
    "Unreachable after 3 attempts": ("A WhatsApp link instead of three cold calls", 0.15),
    "Wrong or invalid number": ("Number checked by the network at sign-up", 0.0),
    "Not interested on first call": ("Starts from their needs, not a pitch", 0.0),
    "Owner had no time for a visit": ("Four minutes on the phone, no visit", 0.5),
    "Visit not scheduled by sales": ("Four minutes on the phone, no visit", 0.5),
    "Locked in with current provider": ("Shows savings and plans the switch date", 0.0),
    "Only wanted a mobile plan": ("A quick mobile-only checkout", 0.0),
    "Price too high": ("Compares with today’s bill, setup on EMI", 0.2),
    "Competitor offered cheaper plan": ("Compares with today’s bill, setup on EMI", 0.2),
    "Quote too complex to understand": ("One monthly price in plain language", 0.5),
    "Quote took too long to arrive": ("Instant quote", 0.5),
    "Decided to wait": ("Saves the quote and reminds them", 0.0),
    "Missing GST or Udyam document": ("Fetched from the registry or Entity Locker", 0.5),
    "Found paperwork too long": ("Zero-upload KYC", 0.5),
    "Authorised signatory not available": ("Signatory e-signs from their own phone", 0.5),
    "Document details did not match": ("Spots the mismatch and says how to fix it", 0.4),
    "Installation delayed beyond 21 days": ("Honest date, AirFiber online from day 2", 0.6),
    "Site not feasible for fibre": ("Checks fibre before quoting, AirFiber if not", 0.6),
    "First payment failed": ("UPI AutoPay with automatic retry", 0.6),
    "Customer cancelled before install": ("Status updates on WhatsApp before they ask", 0.3),
}


def products(s):
    if pd.isna(s):
        return []
    return [p.split("x")[0] for p in str(s).split(";")]


def main():
    cat = pd.read_csv(DATA / "product_catalogue.csv")
    leads = pd.read_csv(DATA / "smb_leads.csv")
    gst = pd.read_csv(DATA / "mock_gstin_registry.csv")
    udy = pd.read_csv(DATA / "mock_udyam_registry.csv")

    # ---------- catalogue ----------
    cat_out = []
    for r in cat.itertuples():
        cat_out.append({
            "id": r.product_id, "cat": r.category, "name": r.product_name, "desc": r.description,
            "unit": r.unit, "pmin": int(r.price_min_inr_per_month), "pmax": int(r.price_max_inr_per_month),
            "setup": int(r.one_time_setup_inr), "contract": int(r.min_contract_months),
            "tiers": [int(t) for t in str(r.available_city_tiers).split(";")],
            "minEmp": int(r.min_employees), "minSites": int(r.min_sites),
            "gst": r.requires_gstin == "Y",
            "needs": [] if pd.isna(r.requires_one_of) else r.requires_one_of.split("|"),
            "install": int(r.typical_install_days), "segs": r.target_segments.split(";"),
        })
    (OUT / "catalogue.json").write_text(json.dumps(cat_out))

    # ---------- registries (mock lookup APIs) ----------
    g = {r.gstin: [r.legal_name, r.trade_name, r.constitution, r.principal_place_of_business,
                   r.state, r.registration_date, r.status] for r in gst.itertuples()}
    (OUT / "gstin_registry.json").write_text(json.dumps(g, separators=(",", ":")))
    u = {r.udyam_number: [r.enterprise_name, r.enterprise_type, r.major_activity, r.nic_description,
                          r.state, r.city, r.date_of_registration] for r in udy.itertuples()}
    (OUT / "udyam_registry.json").write_text(json.dumps(u, separators=(",", ":")))

    # ---------- segment reference: business types, cities, peer bundles ----------
    act = leads[leads.outcome == "Activated"]
    peers = {}
    for seg, grp in act.groupby("segment"):
        c = Counter(p for b in grp.bundle_products for p in products(b))
        peers[SEG_KEY[seg]] = {k: round(v / len(grp), 2) for k, v in c.most_common(12)}
    btypes = {SEG_KEY[s]: sorted(grp.business_type.unique().tolist()) for s, grp in leads.groupby("segment")}
    cities = {r.city: int(r.city_tier) for r in leads[["city", "city_tier", "state"]].drop_duplicates().itertuples()}
    city_state = {r.city: r.state for r in leads[["city", "state"]].drop_duplicates().itertuples()}
    lang_by_state = leads.groupby("state").preferred_language.agg(lambda s: s.value_counts().index[0]).to_dict()
    (OUT / "reference.json").write_text(json.dumps({
        "peers": peers, "businessTypes": btypes, "cities": cities, "cityState": city_state,
        "langByState": lang_by_state,
    }))

    # ---------- insights ----------
    leads["act"] = (leads.outcome == "Activated").astype(int)
    funnel = []
    reached = {s: 0 for s in STAGES}
    for i, s in enumerate(STAGES):
        reached[s] = int((leads.stage_reached.map(STAGES.index) >= i).sum())
        funnel.append({"stage": s, "n": reached[s]})

    drops = []
    for (stage, reason), grp in leads[leads.outcome == "Dropped"].groupby(["stage_reached", "drop_reason"]):
        fix, rec = FIX.get(reason, ("", 0))
        drops.append({"stage": stage, "reason": reason, "n": len(grp), "fix": fix, "recover": rec})
    drops.sort(key=lambda x: (STAGES.index(x["stage"]), -x["n"]))

    def table(col):
        t = leads.groupby(col).agg(n=("act", "size"), acts=("act", "sum"), cost=("acquisition_cost_inr", "sum"))
        t["rate"] = (t.acts / t.n * 100).round(1)
        t["cac"] = (t.cost / t.acts.replace(0, np.nan)).round(0)
        return [{"k": str(k), "n": int(r.n), "rate": float(r.rate), "cac": None if pd.isna(r.cac) else int(r.cac)}
                for k, r in t.sort_values("rate", ascending=False).iterrows()]

    a = act.copy()
    a["churn"] = (a.churned_within_6_months == "Y").astype(int)
    seg_tbl = []
    for seg, grp in leads.groupby("segment"):
        ag = a[a.segment == seg]
        seg_tbl.append({
            "seg": seg, "key": SEG_KEY[seg], "leads": len(grp), "rate": round(grp.act.mean() * 100, 1),
            "cac": int(grp.acquisition_cost_inr.sum() / grp.act.sum()),
            "mrr": int(ag.monthly_bundle_value_inr.median()), "churn": round(ag.churn.mean() * 100, 0),
            "share": round(len(grp) / len(leads) * 100, 0),
        })
    chase = [{"calls": int(k), "n": int(len(g_)), "churn": round(g_.churn.mean() * 100, 0),
              "nps": round(g_.nps_score.mean(), 1)} for k, g_ in a.groupby("customer_follow_up_calls")]

    # eligibility violations in what sales actually sold
    cat_i = cat.set_index("product_id")
    viol = Counter()
    viol_leads = set()
    for r in a.itertuples():
        items = [x.split("x") for x in r.bundle_products.split(";")]
        ids = {i for i, _ in items}
        for pid, _ in items:
            p = cat_i.loc[pid]
            bad = []
            if str(r.city_tier) not in str(p.available_city_tiers).split(";"):
                bad.append("sold outside its city tier")
            if r.employee_count < p.min_employees:
                bad.append("below minimum employees")
            if p.requires_gstin == "Y" and r.has_gstin != "Y":
                bad.append("needs GSTIN, customer had none")
            if not pd.isna(p.requires_one_of) and not (set(p.requires_one_of.split("|")) & ids):
                bad.append("missing required base product")
            for b in bad:
                viol[f"{pid} {p.product_name}: {b}"] += 1
                viol_leads.add(r.lead_id)
    m = leads.merge(gst[["gstin", "status"]], on="gstin", how="left")
    bad_gst_act = m[(m.outcome == "Activated") & m.status.isin(["Cancelled", "Suspended"])].status.value_counts().to_dict()

    bought_vs_asked = a.apply(lambda r: len(set(products(r.bundle_products)) & set(str(r.products_of_interest).split(";"))) == 0, axis=1).mean()

    # opportunity sizing (conservative): recovered drops still face downstream conversion
    conv = {}
    for i, s in enumerate(STAGES[:-1]):
        conv[s] = reached[STAGES[i + 1]] / reached[s]
    downstream = {}
    for i, s in enumerate(STAGES[:-1]):
        p = 1.0
        for s2 in STAGES[i + 1:-1]:
            p *= conv[s2]
        downstream[s] = p
    extra = sum(d["n"] * d["recover"] * downstream[d["stage"]] for d in drops)
    mrr_med = float(a.monthly_bundle_value_inr.median())

    insights = {
        "funnel": funnel, "drops": drops, "segments": seg_tbl, "sources": table("lead_source"),
        "languages": table("preferred_language"), "gstin": table("has_gstin"), "chase": chase,
        "kpis": {
            "leads": len(leads), "activated": int(leads.act.sum()),
            "rate": round(leads.act.mean() * 100, 1),
            "days": round(a.days_lead_to_activation.mean(), 1),
            "calls": round(a.customer_follow_up_calls.mean(), 1),
            "cac": int(leads.acquisition_cost_inr.sum() / leads.act.sum()),
            "churn": round(a.churn.mean() * 100, 1), "nps": round(a.nps_score.mean(), 1),
            "mrrMedian": int(mrr_med),
        },
        "violations": {"leads": len(viol_leads), "detail": viol.most_common()},
        "badGstinActivated": bad_gst_act,
        "boughtNoneAsked": round(bought_vs_asked * 100, 0),
        "existingMobile": table("current_provider"),
        "opportunity": {
            "extraPerQuarter": int(round(extra)), "newTotal": int(round(368 + extra)),
            "newRate": round((368 + extra) / len(leads) * 100, 1),
            "extraAnnualRevenueCr": round(extra * 4 * mrr_med * 12 / 1e7, 1),
            "assumption": "Recovery share per drop reason (see FIX table) x observed downstream conversion; median bundle Rs %d/month" % mrr_med,
        },
    }
    (OUT / "insights.json").write_text(json.dumps(insights, default=int))
    print("assets written:", sorted(p.name for p in OUT.glob("*.json")))
    print("opportunity:", insights["opportunity"])


if __name__ == "__main__":
    main()
