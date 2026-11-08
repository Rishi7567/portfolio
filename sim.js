// Live version of the SaaS Pricing Model Simulator built at Monetizely.
// The maths is the same as the app's Express API (POST /api/simulate),
// ported to the browser so the chart can update without a server.

const MONTHS = 36;

// ARR at month t = customers x MRR per customer x 12, both growing yearly.
function arrAt(t, m) {
  const customers = m.customers * (1 - m.churn) * Math.pow(1 + m.customerGrowth, t / 12);
  const mrrPerCustomer = m.mrr0 * Math.pow(1 + m.expansion, t / 12);
  return customers * mrrPerCustomer * 12;
}

function buildModels(p) {
  const base = { customers: p.customers, customerGrowth: p.customerGrowth / 100 };
  const churn = p.migrationChurn / 100;
  return {
    perUser: { ...base, churn: 0, mrr0: p.seats * p.pricePerSeat, expansion: p.seatGrowth / 100 },
    usage: { ...base, churn, mrr0: p.units * p.pricePerUnit, expansion: p.usageGrowth / 100 },
    outcome: { ...base, churn, mrr0: p.outcomes * p.pricePerOutcome, expansion: p.outcomeGrowth / 100 },
  };
}

function simulate(p) {
  const models = buildModels(p);
  const series = {};
  for (const [key, m] of Object.entries(models)) {
    series[key] = Array.from({ length: MONTHS + 1 }, (_, t) => Math.round(arrAt(t, m)));
  }
  return series;
}

const DEFAULTS = {
  customers: 200, customerGrowth: 20, migrationChurn: 5,
  seats: 50, pricePerSeat: 30, seatGrowth: 5,
  units: 10000, pricePerUnit: 0.15, usageGrowth: 15,
  outcomes: 300, pricePerOutcome: 5, outcomeGrowth: 12,
};

if (typeof module !== "undefined") module.exports = { simulate, DEFAULTS };

// ---------- Page widget ----------
if (typeof document !== "undefined") {
  const root = document.getElementById("sim");
  if (root) initSim(root);
}

function initSim(root) {
  const KEYS = ["perUser", "usage", "outcome"];
  const NAMES = { perUser: "Per-user", usage: "Usage-based", outcome: "Outcome-based" };
  const svg = root.querySelector("svg");
  const inputs = root.querySelectorAll("input[type=range]");
  const PAD = { l: 52, r: 16, t: 12, b: 28 };
  let W = 640, H = 300;
  const NS = "http://www.w3.org/2000/svg";
  const money = (v) => "$" + (v / 1e6).toFixed(2) + "M";

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function params() {
    const p = { ...DEFAULTS };
    inputs.forEach((i) => { p[i.name] = Number(i.value); });
    return p;
  }

  // Round the axis to a 1/2/5 x 10^n step so every tick label is even.
  function niceStep(range) {
    const rough = range / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const f = rough / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  }
  const label = (v, step) => "$" + (v / 1e6).toFixed(step < 1e6 ? 1 : 0) + "M";

  function draw() {
    // Measure before any DOM writes, so the browser never has to re-run layout mid-draw.
    // Drawing at the chart's real pixel width keeps axis text readable on phones.
    W = Math.max(300, Math.round(svg.getBoundingClientRect().width) || 640);
    H = W < 480 ? 220 : 300;
    const p = params();
    inputs.forEach((i) => { root.querySelector(`output[for=${i.id}]`).textContent = i.value + "%"; });
    const s = simulate(p);
    const all = KEYS.flatMap((k) => s[k]);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const xStep = W < 480 ? 12 : 6;
    const min = Math.min(...all), max = Math.max(...all);
    const step = niceStep(Math.max(max - min, 1e5));
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const x = (t) => PAD.l + (t / MONTHS) * (W - PAD.l - PAD.r);
    const y = (v) => H - PAD.b - ((v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

    svg.replaceChildren();
    for (let v = lo; v <= hi + step / 2; v += step) {
      svg.append(el("line", { x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v), class: "grid" }));
      svg.append(el("text", { x: PAD.l - 8, y: y(v) + 4, "text-anchor": "end", class: "axis" }, label(v, step)));
    }
    for (let t = 0; t <= MONTHS; t += xStep) {
      svg.append(el("text", { x: x(t), y: H - 8, "text-anchor": "middle", class: "axis" }, t === 0 ? "Today" : "M" + t));
    }
    for (const k of KEYS) {
      const d = s[k].map((v, t) => (t ? "L" : "M") + x(t).toFixed(1) + " " + y(v).toFixed(1)).join("");
      svg.append(el("path", { d, class: "line line-" + k }));
    }

    const y3 = Object.fromEntries(KEYS.map((k) => [k, s[k][MONTHS]]));
    for (const k of KEYS) {
      root.querySelector(`[data-y3=${k}]`).textContent = money(y3[k]);
      if (k !== "perUser") {
        const diff = (y3[k] / y3.perUser - 1) * 100;
        root.querySelector(`[data-diff=${k}]`).textContent =
          (diff >= 0 ? "+" : "") + diff.toFixed(1) + "% vs per-user";
      }
    }
    const best = KEYS.reduce((a, b) => (y3[b] > y3[a] ? b : a));
    svg.setAttribute("aria-label",
      `ARR over 36 months. Year 3: per-user ${money(y3.perUser)}, usage-based ${money(y3.usage)}, ` +
      `outcome-based ${money(y3.outcome)}. Highest: ${NAMES[best]}.`);
  }

  inputs.forEach((i) => i.addEventListener("input", draw));
  let pending = false;
  window.addEventListener("resize", () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  });
  root.querySelector("[data-reset]").addEventListener("click", () => {
    inputs.forEach((i) => { i.value = DEFAULTS[i.name]; });
    draw();
  });
  draw();
}
