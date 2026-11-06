// Plan builder + eligibility + pricing. Every bundle goes through validate(), whoever suggested it.
export const TODAY = new Date("2026-07-15T10:00:00+05:30"); // data pack "today"

export const NEEDS = [
  { id: "payments", en: "UPI / billing counter", hi: "UPI / बिलिंग काउंटर" },
  { id: "whatsapp", en: "Reach customers on WhatsApp", hi: "WhatsApp पर ग्राहक" },
  { id: "cctv", en: "CCTV cameras", hi: "CCTV कैमरा" },
  { id: "wifi", en: "Wi-Fi for customers", hi: "ग्राहकों के लिए Wi-Fi" },
  { id: "email", en: "Business email & docs", hi: "बिज़नेस ईमेल" },
  { id: "security", en: "Protect PCs & data", hi: "डेटा सुरक्षा" },
  { id: "backup", en: "Never go offline", hi: "इंटरनेट कभी बंद न हो" },
  { id: "calls", en: "Business phone line / IVR", hi: "बिज़नेस फ़ोन लाइन" },
  { id: "website", en: "Website", hi: "वेबसाइट" },
  { id: "storage", en: "Cloud backup of files", hi: "फ़ाइल बैकअप" },
  { id: "manage", en: "Manage all branches centrally", hi: "सभी ब्रांच एक जगह से" },
  { id: "machines", en: "Monitor machines", hi: "मशीन मॉनिटरिंग" },
  { id: "fleet", en: "Track vehicles", hi: "गाड़ी ट्रैकिंग" },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Engine {
  constructor(catalogue, reference) {
    this.cat = Object.fromEntries(catalogue.map((p) => [p.id, p]));
    this.ref = reference;
  }

  segmentOf(type) {
    for (const [seg, types] of Object.entries(this.ref.businessTypes)) if (types.includes(type)) return seg;
    return "micro";
  }

  // Why a single product can or cannot be sold to this business
  eligibility(id, p, bundleIds) {
    const c = this.cat[id];
    const r = [];
    if (!c) return [`Unknown product ${id}`];
    if (!c.tiers.includes(p.tier)) r.push(`${c.name} is not sold in tier-${p.tier} cities`);
    if (p.employees < c.minEmp) r.push(`${c.name} needs ${c.minEmp}+ employees`);
    if (p.sites < c.minSites) r.push(`${c.name} needs ${c.minSites}+ sites`);
    if (c.gst && !p.gstActive) r.push(`${c.name} needs an active GSTIN`);
    if (c.needs.length && !c.needs.some((n) => bundleIds.includes(n)))
      r.push(`${c.name} needs one of ${c.needs.map((n) => this.cat[n].name).join(" / ")} in the bundle`);
    return r;
  }

  validate(items, p) {
    const ids = items.map((i) => i.id);
    return items.map((i) => ({ ...i, problems: this.eligibility(i.id, p, ids) }));
  }

  baseConnectivity(p) {
    const seg = p.segment;
    if (p.fibre === false) return { id: "P04", qty: p.sites, why: "Fibre isn't available at your address yet, so 5G AirFiber: plug-and-play in 2 days" };
    if (seg === "mfg" && p.employees >= 25 && p.gstActive) return { id: "P06", qty: 1, why: "Dedicated 100 Mbps line with 99.9% uptime for the shop floor" };
    if (seg === "mfg" && p.employees >= 10 && p.gstActive) return { id: "P05", qty: 1, why: "Dedicated 20 Mbps line with 99.5% uptime, nobody shares your speed" };
    if (seg === "multi") return { id: p.tier === 1 && p.employees >= 50 && p.gstActive ? "P03" : "P02", qty: p.sites, why: `One fibre line at each of your ${p.sites} sites, on one bill` };
    if (seg === "prof") {
      if (p.tier === 1 && p.employees >= 15 && p.gstActive) return { id: "P03", qty: p.sites, why: "1 Gbps with priority support for a busy office" };
      return { id: "P02", qty: p.sites, why: "300 Mbps fibre, enough for video calls and cloud software" };
    }
    return { id: "P01", qty: p.sites, why: "100 Mbps fibre: UPI, billing and WhatsApp never lag" };
  }

  recommend(p) {
    const items = [];
    const notes = [];
    const add = (id, qty, why) => {
      const ex = items.find((x) => x.id === id);
      if (ex) return;
      items.push({ id, qty: Math.max(1, Math.round(qty)), why });
    };
    const base = this.baseConnectivity(p);
    add(base.id, base.qty, base.why);
    const fibre = ["P01", "P02", "P03", "P05", "P06"].includes(base.id);
    // mobile lines
    if (p.segment === "micro") add("P07", clamp(Math.ceil(p.employees / 3), 1, 3), "Business number for the owner, separate from personal");
    else add("P08", clamp(p.segment === "multi" ? p.sites : Math.ceil(p.employees / 5), 1, 10), "Business mobile lines with priority care for key staff");

    let needs = p.needs?.length ? p.needs : this.defaultNeeds(p);
    for (const n of needs) {
      switch (n) {
        case "payments": add("P19", p.sites, "GST-ready billing and UPI/card on a tablet"); break;
        case "whatsapp":
          if (p.gstActive) add("P15", 1, "Verified WhatsApp with catalogue, 1,000 chats a month");
          else notes.push("WhatsApp Business API needs an active GSTIN. You can keep using the free WhatsApp Business app; we'll add the verified channel once GST is active.");
          break;
        case "cctv": add("P23", 2 * p.sites, "HD cameras with 30-day cloud recording, view on your phone"); break;
        case "wifi": add("P22", p.sites, "Separate guest Wi-Fi so customers never touch your billing network"); break;
        case "email": add("P16", clamp(p.employees, 1, 50), "Email on your own domain, documents and video meetings"); break;
        case "security":
          add("P20", clamp(p.employees, 1, 50), "Antivirus and ransomware protection on every device");
          if (p.employees >= 10 && p.gstActive && fibre) add("P21", p.sites, "Managed firewall watched by our security team");
          break;
        case "backup": if (fibre) add("P09", p.sites, "Switches to 4G/5G automatically if the main line goes down"); break;
        case "calls":
          if (p.employees >= 3 && p.gstActive) add("P12", clamp(Math.ceil(p.employees / 10), 2, 10), "Business phone lines with IVR and call recording");
          else if (p.gstActive) add("P13", 1, "1800 number routed to your mobile");
          else notes.push("Business phone lines need an active GSTIN.");
          break;
        case "website": add("P18", 1, "Domain, 5-page website and hosting"); break;
        case "storage": add("P17", 1, "Automatic backup of PCs and phones, 1 TB"); break;
        case "manage":
          if (p.sites >= 3 && p.employees >= 10 && p.gstActive && fibre) add("P10", p.sites, "Manage every branch's internet from one screen");
          else notes.push("Central SD-WAN management needs 3+ sites, 10+ employees and an active GSTIN.");
          break;
        case "machines":
          if (p.employees >= 10 && p.gstActive) add("P24", 5, "Sensor kits to track machine uptime and power use");
          else notes.push("Machine monitoring needs 10+ employees and an active GSTIN.");
          break;
        case "fleet": add("P25", 3, "Live GPS tracking for your vehicles"); break;
      }
    }
    // final deterministic gate: drop anything still ineligible, with the reason
    const checked = this.validate(items, p);
    const kept = checked.filter((i) => !i.problems.length);
    const dropped = checked.filter((i) => i.problems.length);
    for (const d of dropped) notes.push(d.problems.join("; "));
    return { items: kept.map(({ problems, ...i }) => i), notes, dropped };
  }

  defaultNeeds(p) {
    const peers = this.ref.peers[p.segment] || {};
    const map = { P19: "payments", P15: "whatsapp", P23: "cctv", P22: "wifi", P16: "email", P20: "security", P09: "backup", P12: "calls", P17: "storage", P10: "manage", P24: "machines" };
    return Object.entries(peers).filter(([, s]) => s >= 0.3).map(([id]) => map[id]).filter(Boolean);
  }

  peerShare(p, id) {
    return this.ref.peers[p.segment]?.[id] ?? null;
  }

  quote(items, p) {
    const lines = items.map((i) => {
      const c = this.cat[i.id];
      return { ...i, name: c.name, unit: c.unit, price: c.pmin, monthly: c.pmin * i.qty, setup: c.setup * i.qty, contract: c.contract, install: c.install, cat: c.cat };
    });
    const monthly = lines.reduce((s, l) => s + l.monthly, 0);
    const cats = new Set(lines.map((l) => l.cat)).size;
    const discount = cats >= 3 ? Math.round(monthly * 0.1) : 0;
    const setup = lines.reduce((s, l) => s + l.setup, 0);
    const contract = Math.max(...lines.map((l) => l.contract), 1);
    const total = monthly - discount;
    const current = p.spend || 0;
    return {
      lines, monthly, discount, total, setup, contract,
      emi: setup >= 2000 ? Math.ceil(setup / 6) : 0,
      saving: current ? current - total : null,
      gstNote: "Prices exclude 18% GST, claimable as input credit if you're GST-registered",
    };
  }

  // go-live date from install times; AirFiber first if fibre takes a week+
  promise(items, p) {
    const day = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return d; };
    const max = Math.max(...items.map((i) => this.cat[i.id].install));
    const fibre = items.some((i) => ["P01", "P02", "P03", "P05", "P06"].includes(i.id));
    const bridge = fibre && max >= 7;
    const steps = [
      { d: 0, t: "Order confirmed, KYC verified", done: true },
      { d: 0, t: "AutoPay mandate set up on UPI", done: true },
      { d: 1, t: "Engineer visit booked (we'll WhatsApp you the name and time)" },
    ];
    if (bridge) steps.push({ d: 2, t: "Day-1 internet: 5G AirFiber bridge plugged in, free until fibre is live" });
    const mobiles = items.some((i) => ["P07", "P08"].includes(i.id));
    if (mobiles) steps.push({ d: 1, t: "Business SIMs delivered and active" });
    steps.push({ d: max, t: fibre ? "Fibre live, all services switched on" : "All services live" });
    steps.sort((a, b) => a.d - b.d);
    return { steps: steps.map((s) => ({ ...s, date: day(s.d) })), liveBy: day(max), bridge, days: max };
  }
}

export const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
export const fmtDate = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
