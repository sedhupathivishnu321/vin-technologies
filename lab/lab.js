"use strict";
/* LEARNERS LAB — browser edition. The circuit engine is the same Python code as the desktop app, running in a worker (Pyodide + NumPy). */
const G = 20, NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const html = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------------------------------------------------------- engine worker */
const worker = new Worker("worker.js");
let seq = 0; const pending = new Map();
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "progress") { if ($("bootbar")) { $("bootbar").style.width = m.pct + "%"; $("boottext").textContent = m.text; } else setStatus(m.pct < 100 ? "Loading simulation engine " + m.pct + " %" : "Ready", m.pct < 100 ? "busy" : "ok"); return; }
  const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
  m.ok ? p.res(m.value) : p.rej(new Error(m.error));
};
worker.onerror = (e) => { if ($("boottext")) $("boottext").textContent = "The engine could not start: " + (e.message || "unknown error"); };
const call = (fn, ...args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ id, fn, args }); });

/* ---------------------------------------------------------------- state */
const S = { defs: {}, proj: null, info: null, key: "", sel: null, res: null, live: false, tool: null, wireFrom: null, view: { x: 0, y: 0, k: 1 },
  hist: [], fut: [], resVals: [], running: false, again: false, cur: null, mouse: { x: 0, y: 0 }, dragging: null, sigOn: {}, scope: null, examples: [] };

/* ---------------------------------------------------------------- units */
const SI = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
function fmt(v, unit = "", digits = 3) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  if (v === 0) return "0 " + unit;
  const a = Math.abs(v);
  for (const [f, p] of SI) if (a >= f * 0.9995) return (+(v / f).toPrecision(digits)) + " " + p + unit;
  return v.toExponential(2) + " " + unit;
}
function parseSI(s) {
  s = String(s).trim().replace(/µ/g, "u").replace(/Ω|ohm/gi, "");
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(meg|[pnumkMGT])?\s*[A-Za-z]*$/i);
  if (!m) return NaN;
  let v = parseFloat(m[1]); const p = m[2];
  if (!p) return v;
  if (p.toLowerCase() === "meg") return v * 1e6;
  const map = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  return v * (map[p] ?? map[p.toLowerCase()] ?? 1);
}

/* ---------------------------------------------------------------- geometry */
function rot(dx, dy, r, mirror) { if (mirror) dx = -dx; for (let i = 0; i < ((r % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx]; return [dx, dy]; }
const defOf = (c) => S.defs[c.type];
function pinPos(c, name) {
  const d = defOf(c); const p = d.pins.find((q) => q.name === name); if (!p) return [c.x, c.y];
  const [ox, oy] = rot(p.dx, p.dy, c.rot, c.mirror); return [c.x + ox, c.y + oy];
}
function localBox(d) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  if (d.sprite) { const [, ox, oy, w, h] = d.sprite; add(-ox * 2, -oy * 2); add((-ox + w) * 2, (-oy + h) * 2); }
  else if (d.symbol === "ground") { add(-20, -4); add(20, 34); }
  else if (["vsource", "isource", "ammeter", "voltmeter"].includes(d.symbol)) { add(-30, -30); add(30, 30); }
  else if (d.symbol === "gate") { add(-40, -40); add(52, 40); }
  else { add(-d.box[0] * G, -d.box[1] * G); add(d.box[0] * G, d.box[1] * G); }
  for (const p of d.pins) { add(p.dx * G - 4, p.dy * G - 4); add(p.dx * G + 4, p.dy * G + 4); }
  return [x0, y0, x1, y1];
}
function worldBox(c) {
  const [x0, y0, x1, y1] = localBox(defOf(c)); const xs = [], ys = [];
  for (const [a, b] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) { const [rx, ry] = rot(a / G, b / G, c.rot, c.mirror); xs.push(c.x * G + rx * G); ys.push(c.y * G + ry * G); }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* ---------------------------------------------------------------- artwork names (same rules as the desktop app) */
const ECAP = [0.47, 1, 2.2, 4.7, 10, 22, 47, 100, 220, 470, 1000, 2200, 4700];
const CAPF = { 0.0001: "0.0001", 0.000022: "0.000022", 0.001: "0.001", 0.01: "0.01", 0.047: "0.047", 0.1: "0.1", 0.22: "0.22", 1: "1" };
const nearest = (vals, x) => { x = Math.max(x, 1e-30); return vals.reduce((b, v) => Math.abs(Math.log(v / x)) < Math.abs(Math.log(b / x)) ? v : b); };
function spriteName(c) {
  const d = defOf(c); if (!d.sprite) return null; const p = c.params;
  switch (c.type) {
    case "resistor": return "res_" + nearest(S.resVals, +p.R || 1000);
    case "capacitor": return "ecap_" + nearest(ECAP, (+p.C || 1e-4) * 1e6);
    case "capacitor_ceramic": return "cap_" + CAPF[nearest(Object.keys(CAPF).map(Number), (+p.C || 1e-7) * 1e6)];
    case "led": return "led-" + (p.color || "red");
    case "pot": return "pot_" + Math.round(Math.min(Math.max(+p.pos || 0, 0), 1) * 10);
    case "switch": return p.closed ? "toggle_on" : "toggle_off";
    case "buzzer": return (p.kind || "active") === "active" ? "buzzer-active" : "buzzer-piezo";
  }
  return d.sprite[0];
}

/* ---------------------------------------------------------------- history */
const snap = () => JSON.stringify({ components: S.proj.components, wires: S.proj.wires });
function pushHist() { S.hist.push(snap()); if (S.hist.length > 120) S.hist.shift(); S.fut = []; updHist(); }
function restore(s) { const o = JSON.parse(s); S.proj.components = o.components; S.proj.wires = o.wires; S.sel = null; renderAll(); buildPanels(); updCtx(); changed(); }
function undo() { if (!S.hist.length) return; S.fut.push(snap()); restore(S.hist.pop()); updHist(); }
function redo() { if (!S.fut.length) return; S.hist.push(snap()); restore(S.fut.pop()); updHist(); }
function updHist() { $("bUndo").disabled = !S.hist.length; $("bRedo").disabled = !S.fut.length; }

/* ---------------------------------------------------------------- canvas rendering */
const cv = $("cv"), world = $("world"), gComps = $("comps"), gWires = $("wires"), gOver = $("over");
function applyView() {
  const zp = $("zoomPct"); if (zp) zp.textContent = Math.round(S.view.k * 100) + "%";
  const v = S.view; world.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`);
  $("grid").setAttribute("patternTransform", `translate(${v.x},${v.y}) scale(${v.k})`);
}
function compById(id) { return S.proj.components.find((c) => c.id === id); }
/* ---------------------------------------------------------------- wiring engine (the desktop canvas rules: routing, pin snapping, nets, breadboard seating) */
const HIT_R = 9;
const NETPAL = ["#1d78d6", "#2a9d3a", "#f2c200", "#f77f00", "#7b2cbf", "#e5e7eb", "#8a5a2b"];
const bbGroup = (n) => (/^[a-e]\d+$/.test(n) ? "top" + n.slice(1) : /^[f-j]\d+$/.test(n) ? "bot" + n.slice(1) : n.slice(0, 2));
const pinKey = (c, p) => c + "|" + p;
function pinPx(ref) { const c = compById(ref[0]); const [x, y] = pinPos(c, ref[1]); return { x: x * G, y: y * G }; }
function pinDir(ref) {
  const c = compById(ref[0]), d = defOf(c), p = d.pins.find((q) => q.name === ref[1]); const [ox, oy] = rot(p.dx, p.dy, c.rot, c.mirror);
  if (d.engine === "board") return [0, oy > 0 ? 1 : -1];
  if (ox === 0 && oy === 0) return [0, 1];
  return Math.abs(ox) >= Math.abs(oy) ? [ox > 0 ? 1 : -1, 0] : [0, oy > 0 ? 1 : -1];
}
function cleanPts(pts) {
  const out = [];
  for (const q of pts) { const l = out[out.length - 1]; if (l && Math.abs(l.x - q.x) < 0.5 && Math.abs(l.y - q.y) < 0.5) continue; out.push(q); }
  let i = 1;
  while (i < out.length - 1) { const a = out[i - 1], b = out[i], c = out[i + 1]; if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) out.splice(i, 1); else i++; }
  return out;
}
function route(a, b, via) {
  const pa = pinPx(a), pb = pinPx(b);
  if (via && via.length) {
    const pts = [pa, ...via.map(([x, y]) => ({ x: x * G, y: y * G })), pb]; let out = [pts[0]]; let horiz = pinDir(a)[1] === 0;
    for (const q of pts.slice(1)) {
      const prev = out[out.length - 1];
      if (Math.abs(prev.x - q.x) > 0.5 && Math.abs(prev.y - q.y) > 0.5) { out.push(horiz ? { x: q.x, y: prev.y } : { x: prev.x, y: q.y }); horiz = !horiz; } else horiz = Math.abs(prev.y - q.y) < 0.5;
      out.push(q);
    }
    out = cleanPts(out); return out.length >= 2 ? out : [pa, pb];
  }
  const da = pinDir(a), db = pinDir(b), ha = da[1] === 0, hb = db[1] === 0;
  if (Math.abs(pa.x - pb.x) < 0.5 || Math.abs(pa.y - pb.y) < 0.5) return [pa, pb];
  if (ha && hb) { const mx = Math.round((pa.x + pb.x) / 2 / G) * G; return [pa, { x: mx, y: pa.y }, { x: mx, y: pb.y }, pb]; }
  if (!ha && !hb) { const my = Math.round((pa.y + pb.y) / 2 / G) * G; return [pa, { x: pa.x, y: my }, { x: pb.x, y: my }, pb]; }
  return ha ? [pa, { x: pb.x, y: pa.y }, pb] : [pa, { x: pa.x, y: pb.y }, pb];
}
const routeFor = (w) => (compById(w.a[0]) && compById(w.b[0]) ? route(w.a, w.b, w.via) : null);
function pinAt(pos) {
  let best = null, bd = HIT_R;
  const comps = [...S.proj.components].sort((a, b) => (defOf(a).engine === "board") - (defOf(b).engine === "board"));
  for (const c of comps) { const d = defOf(c); if (d.engine === "none" && !d.pins.length) continue; for (const p of d.pins) { const [x, y] = pinPos(c, p.name); const dd = Math.hypot(x * G - pos.x, y * G - pos.y); if (dd < bd) { best = [c.id, p.name]; bd = dd; } } }
  return best;
}
const samePin = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
function canWire(a, b, ignore) {
  for (const [cid, pin] of [a, b]) { const c = compById(cid); if (!c) return [false, "Unknown component"]; if (!defOf(c).pins.some((p) => p.name === pin)) return [false, `${c.ref} has no pin ${pin}`]; }
  if (samePin(a, b)) return [false, "Cannot connect a pin to itself"];
  if (S.proj.wires.some((w) => w !== ignore && ((samePin(w.a, a) && samePin(w.b, b)) || (samePin(w.a, b) && samePin(w.b, a))))) return [false, "Wire already exists"];
  const ca = compById(a[0]), cb = compById(b[0]), da = defOf(ca).engine, db = defOf(cb).engine;
  if (da === "board" || db === "board") return [true, ""];
  for (const c of [ca, cb]) if (defOf(c).engine === "none") return [false, `${c.ref} (${defOf(c).name}) has no simulation model and cannot be wired`];
  if (da !== db) return [false, "Analog and digital pins cannot be wired together (no mixed-signal model)"];
  return [true, ""];
}
function connectPins(a, b) {
  const [ok, why] = canWire(a, b); if (!ok) { toast(why); return false; }
  pushHist(); const w = { id: Math.random().toString(16).slice(2, 10), a, b, color: wireColorFor(), via: [] }; S.proj.wires.push(w); changed(); renderAll(); return true;
}

/* nets: union-find over wires, strips inside parts and breadboard strips; used for the automatic wire colours */
function computeNets() {
  const parent = new Map(), find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent.set(rx, ry); };
  const comps = S.proj.components;
  for (const c of comps) for (const p of defOf(c).pins) parent.set(pinKey(c.id, p.name), pinKey(c.id, p.name));
  for (const w of S.proj.wires) { const ka = pinKey(...w.a), kb = pinKey(...w.b); if (parent.has(ka) && parent.has(kb)) union(ka, kb); }
  for (const c of comps) for (const g of defOf(c).links || []) for (const o of g.slice(1)) union(pinKey(c.id, g[0]), pinKey(c.id, o));
  const boards = comps.filter((c) => defOf(c).engine === "board");
  if (boards.length) {
    const holeAt = new Map(), strips = new Map();
    for (const bd of boards) for (const p of defOf(bd).pins) { const key = pinKey(bd.id, p.name); const sk = bd.id + "|" + bbGroup(p.name); (strips.get(sk) || strips.set(sk, []).get(sk)).push(key); const [x, y] = pinPos(bd, p.name); holeAt.set(x + "," + y, key); }
    for (const m of strips.values()) for (const k of m.slice(1)) union(m[0], k);
    for (const c of comps) { if (defOf(c).engine === "board") continue; for (const p of defOf(c).pins) { const [x, y] = pinPos(c, p.name), h = holeAt.get(x + "," + y); if (h) union(pinKey(c.id, p.name), h); } }
  }
  const groups = new Map(); for (const k of parent.keys()) { const r = find(k); (groups.get(r) || groups.set(r, []).get(r)).push(k); }
  const refOf = (k) => compById(k.split("|")[0]).ref + k.split("|")[1];
  const ordered = [...groups.values()].sort((g1, g2) => { const a = g1.map(refOf).sort()[0], b = g2.map(refOf).sort()[0]; return a < b ? -1 : a > b ? 1 : 0; });
  const color = new Map(), deg = new Map();
  ordered.forEach((g, idx) => {
    const pins = g.map((k) => { const [cid, pn] = k.split("|"); const c = compById(cid); return [c.type, pn]; });
    const ground = pins.some(([t, pn]) => t === "ground" || (t === "arduino" && pn.startsWith("GND")));
    const col = ground ? "#2b2b2b" : pins.some(([t, pn]) => ["vdc", "vac", "vpulse", "idc"].includes(t) && pn === "+") ? "#d62828" : NETPAL[idx % NETPAL.length];
    for (const k of g) color.set(k, col);
  });
  return { color, deg };
}

/* breadboard seating (magnetic snap), identical to the desktop model */
function holeMap() { const m = new Map(); for (const bd of S.proj.components) if (defOf(bd).engine === "board") for (const p of defOf(bd).pins) { const [x, y] = pinPos(bd, p.name); m.set(x + "," + y, [bd.id, p.name]); } return m; }
function seatedOn(boardId) {
  const bd = compById(boardId), mine = new Set(defOf(bd).pins.map((p) => pinPos(bd, p.name).join(","))), out = [];
  for (const c of S.proj.components) { if (defOf(c).engine === "board" || c.type === "arduino" || c.type === "ground") continue; if (defOf(c).pins.some((p) => mine.has(pinPos(c, p.name).join(",")))) out.push(c.id); }
  return out;
}
function snapOffset(cid, reach = 4) {
  const c = compById(cid), pins = defOf(c).pins, holes = holeMap();
  if (!holes.size || defOf(c).engine === "board" || c.type === "arduino" || c.type === "ground" || !pins.length || pins.length > 20) return [0, 0, 0];
  const pos = pins.map((p) => pinPos(c, p.name)), cands = new Map([["0,0", [0, 0]]]);
  for (const [x, y] of pos.slice(0, 3)) for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) if (holes.has(x + dx + "," + (y + dy))) cands.set(dx + "," + dy, [dx, dy]);
  let best = null;
  for (const [dx, dy] of cands.values()) {
    const strips = pos.filter(([x, y]) => holes.has(x + dx + "," + (y + dy))).map(([x, y]) => { const h = holes.get(x + dx + "," + (y + dy)); return h[0] + "|" + bbGroup(h[1]); });
    const n = strips.length, shorts = n - new Set(strips).size, key = [-n, shorts, Math.abs(dx) + Math.abs(dy)];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) best = { key, dx, dy, n };
  }
  if (best.n < Math.min(pins.length, 2)) return [0, 0, pos.filter(([x, y]) => holes.has(x + "," + y)).length];
  return [best.dx, best.dy, best.n];
}
function seatComp(cid, announce) {
  const c = compById(cid); if (!c || defOf(c).engine === "board") return 0;
  const [dx, dy, n] = snapOffset(cid); if (dx || dy) { c.x += dx; c.y += dy; }
  if (announce && holeMap().size && c.type !== "arduino" && c.type !== "ground") toast(n ? `${c.ref}: ${n}/${defOf(c).pins.length} pins in breadboard holes` : `${c.ref} is not seated in the breadboard`);
  return n;
}
function shiftVia(ids, dx, dy) { for (const w of S.proj.wires) if (w.via && w.via.length && ids.has(w.a[0]) && ids.has(w.b[0])) w.via = w.via.map(([x, y]) => [x + dx, y + dy]); }

function symbolSVG(c, d, g) {
  const L = (x1, y1, x2, y2) => el("line", { x1, y1, x2, y2, class: "symline" }, g);
  const T = (x, y, t, cls = "symtext") => { const e = el("text", { x, y, class: cls }, g); e.textContent = t; return e; };
  const lead = (p, edge) => { L(p.dx * G, p.dy * G, edge[0], edge[1]); };
  switch (d.symbol) {
    case "ground": L(0, 0, 0, 10); L(-14, 10, 14, 10); L(-9, 17, 9, 17); L(-4, 24, 4, 24); return;
    case "vsource": case "isource": {
      el("circle", { cx: 0, cy: 0, r: 26, class: "symfill" }, g); L(0, -40, 0, -26); L(0, 26, 0, 40);
      if (d.symbol === "vsource") { T(0, -11, "+"); T(0, 12, "−"); } else { L(0, 12, 0, -12); L(0, -12, -5, -4); L(0, -12, 5, -4); } return;
    }
    case "ammeter": case "voltmeter": {
      el("circle", { cx: 0, cy: 0, r: 26, class: "symfill" }, g); L(-60, 0, -26, 0); L(26, 0, 60, 0);
      T(0, 1, d.symbol === "ammeter" ? "A" : "V", "symtext"); return;
    }
    case "gate": return gateSVG(c.type, d, g);
  }
  const [hw, hh] = d.box;
  el("rect", { x: -hw * G, y: -hh * G, width: hw * 2 * G, height: hh * 2 * G, rx: 4, class: "symfill" }, g);
  for (const p of d.pins) {
    const x = p.dx * G, y = p.dy * G; let ex = x, ey = y;
    if (Math.abs(x) > hw * G) ex = Math.sign(x) * hw * G; if (Math.abs(y) > hh * G) ey = Math.sign(y) * hh * G;
    L(x, y, ex, ey);
    const t = el("text", { x: ex - Math.sign(ex || 1) * (Math.abs(x) > hw * G ? -4 : 0) + (Math.abs(x) > hw * G ? -Math.sign(x) * 5 : 0), y: Math.abs(y) > hh * G ? ey - Math.sign(y) * 7 : ey, class: "plabel" }, g);
    t.textContent = p.name; t.setAttribute("text-anchor", Math.abs(x) > hw * G ? (x < 0 ? "start" : "end") : "middle"); t.setAttribute("dominant-baseline", "central");
  }
  T(0, 0, d.label || d.name);
}
function gateSVG(type, d, g) {
  const inv = ["nand", "nor", "xnor", "not"].includes(type);
  const P = (dd, cls = "symfill") => el("path", { d: dd, class: cls }, g);
  const L = (x1, y1, x2, y2) => el("line", { x1, y1, x2, y2, class: "symline" }, g);
  let outx = 40;
  if (type === "not") { P("M-30,-30 V30 L30,0 Z"); outx = 30; }
  else if (type === "and" || type === "nand") P("M-40,-40 H0 A40,40 0 0 1 0,40 H-40 Z");
  else { P("M-40,-40 Q-5,-40 40,0 Q-5,40 -40,40 Q-15,0 -40,-40 Z"); if (type === "xor" || type === "xnor") P("M-50,-40 Q-25,0 -50,40", "symline"); }
  if (inv) { el("circle", { cx: outx + 6, cy: 0, r: 6, class: "symfill" }, g); outx += 12; }
  for (const p of d.pins) { if (p.dx > 0) L(outx, 0, p.dx * G, 0); else L(p.dx * G, p.dy * G, -34, p.dy * G); }
}

function drawComp(c) {
  const d = defOf(c); if (!d) return null;
  const g = el("g", { class: "comp", "data-id": c.id }, gComps);
  const t = el("g", { transform: `translate(${c.x * G},${c.y * G}) rotate(${c.rot * 90}) scale(${c.mirror ? -1 : 1},1)` }, g);
  const hit = el("rect", { fill: "transparent" }, t); const [x0, y0, x1, y1] = localBox(d);
  hit.setAttribute("x", x0); hit.setAttribute("y", y0); hit.setAttribute("width", x1 - x0); hit.setAttribute("height", y1 - y0);
  const sn = spriteName(c), st = (S.res && S.res.comp && S.res.comp[c.id]) || {};
  if (sn) {
    const [sid, ox, oy, w, h] = d.sprite;
    const im = el("image", { href: `af/${sn}.svg`, x: -ox * 2, y: -oy * 2, width: w * 2, height: h * 2 }, t);
    im.addEventListener("error", () => im.setAttribute("href", `af/${sid}.svg`), { once: true });
    if (c.type === "led" && st.glow > 0.02) {
      const col = { red: "R", green: "G", yellow: "Y", blue: "B" }[c.params.color || "red"] || "R";
      el("circle", { cx: -ox * 2 + 50, cy: -oy * 2 + 68, r: 84, fill: `url(#glow${col})`, opacity: Math.min(1, 0.4 + st.glow * 0.8), "pointer-events": "none" }, t);
    }
    if (c.type === "dmm") {
      const r = el("rect", { x: -ox * 2 + 36, y: -oy * 2 + 34, width: 208, height: 56, rx: 3, fill: "#b9c7a4", "pointer-events": "none" }, t);
      const txt = el("text", { x: -ox * 2 + 140, y: -oy * 2 + 60, "text-anchor": "middle", "dominant-baseline": "central", style: "font:700 26px Consolas,monospace;fill:#1f2a18", "pointer-events": "none" }, t);
      const i = st.inst; txt.textContent = i ? (i.overload ? "OL" : fmt(i.value, i.unit || "", 3).replace(" ", "")) : "----";
    }
  } else symbolSVG(c, d, t);
  // labels (kept upright)
  const [wx0, wy0, wx1, wy1] = worldBox(c);
  const lab = el("g", { "pointer-events": "none" }, g);
  const r = el("text", { x: (wx0 + wx1) / 2, y: wy0 - 4, class: "refl" }, lab); r.textContent = c.ref;
  const val = valueText(c, d);
  if (val) { const v = el("text", { x: (wx0 + wx1) / 2, y: wy1 + 12, class: "valtext" }, lab); v.textContent = val; }
  if (["voltmeter", "ammeter"].includes(d.symbol) && st.inst) {
    const i = st.inst, cx = (wx0 + wx1) / 2;
    el("rect", { x: cx - 36, y: wy1 + 14, width: 72, height: 20, rx: 3, class: "meter" }, lab);
    const m = el("text", { x: cx, y: wy1 + 24.5, class: "meterv" }, lab); m.textContent = i.overload ? "OL" : fmt(i.value, i.unit || "", 3);
  }
  if (S.sel && S.sel.kind === "c" && S.sel.id === c.id) el("rect", { x: wx0 - 3, y: wy0 - 3, width: wx1 - wx0 + 6, height: wy1 - wy0 + 6, class: "sel-box" }, lab);
  return g;
}
function valueText(c, d) {
  const p = c.params;
  switch (c.type) {
    case "resistor": return fmt(+p.R, "Ω");
    case "capacitor": case "capacitor_ceramic": return fmt(+p.C, "F");
    case "inductor": return fmt(+p.L, "H");
    case "vdc": return fmt(+p.V, "V");
    case "idc": return fmt(+p.I, "A");
    case "pot": return fmt(+p.R, "Ω") + "  " + Math.round((+p.pos || 0) * 100) + " %";
    case "vac": return fmt(+p.amp, "V") + " " + fmt(+p.freq, "Hz");
    case "zener": return fmt(+p.Vz, "V");
    case "lswitch": return +p.value ? "1" : "0";
    case "switch": return p.closed ? "closed" : "open";
  }
  return d.category === "Semiconductors" || d.category === "Analog ICs" || d.category === "Digital ICs" ? d.name.split(" ")[0] : "";
}
const darker = (hex, f = 190) => { const n = parseInt(hex.slice(1), 16), k = 100 / f; return "#" + [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => Math.round(v * k).toString(16).padStart(2, "0")).join(""); };
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.3 * (n >> 16 & 255) + 0.59 * (n >> 8 & 255) + 0.11 * (n & 255); };
function roundedPath(pts) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1], l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y), rr = Math.min(10, l1 / 2, l2 / 2);
    if (rr < 1) { d += ` L${b.x},${b.y}`; continue; }
    d += ` L${b.x + (a.x - b.x) / l1 * rr},${b.y + (a.y - b.y) / l1 * rr} Q${b.x},${b.y} ${b.x + (c.x - b.x) / l2 * rr},${b.y + (c.y - b.y) / l2 * rr}`;
  }
  return d + ` L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
}
function drawWires() {
  gWires.innerHTML = ""; S.nets = computeNets();
  for (const w of S.proj.wires) {
    if (S.wend && S.wend.w === w) continue;
    const pts = routeFor(w); if (!pts) continue;
    const sel = S.sel && S.sel.kind === "w" && S.sel.id === w.id;
    const base = sel ? "#e0a84e" : w.color || S.nets.color.get(pinKey(...w.a)) || "#1d78d6", out = lum(base) < 70 ? "#7b8696" : darker(base), d = roundedPath(pts), g = el("g", {}, gWires);
    el("path", { d, transform: "translate(2,3)", class: "w-sh" }, g); el("path", { d, class: "w-out", style: `stroke:${out}` }, g); el("path", { d, class: "w-main", style: `stroke:${base}` }, g); el("path", { d, transform: "translate(-0.8,-0.8)", class: "w-hi" }, g);
    for (const q of [pts[0], pts[pts.length - 1]]) el("circle", { cx: q.x, cy: q.y, r: 3.6, fill: base, stroke: out, "stroke-width": 1 }, g);
    el("path", { d, class: "wirehit", "data-w": w.id }, g);
    if (sel) {
      for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) >= 1.5 * G) el("rect", { x: (a.x + b.x) / 2 - 3.5, y: (a.y + b.y) / 2 - 3.5, width: 7, height: 7, class: "w-handle" }, g); }
      for (const q of [pts[0], pts[pts.length - 1]]) el("circle", { cx: q.x, cy: q.y, r: 6, class: "w-end" }, g);
    }
  }
}
function renderAll() {
  gComps.innerHTML = ""; for (const c of S.proj.components) drawComp(c);
  drawWires(); drawOver(); $("doctitle").textContent = S.proj.meta?.name || "Untitled"; updStatusbar();
}
function drawOver() {
  gOver.innerHTML = "";
  const from = S.wireFrom || (S.wend && S.wend.fixed);
  if (from && compById(from[0])) { const a = pinPx(from); el("path", { d: `M${a.x},${a.y} L${S.mouse.x},${a.y} L${S.mouse.x},${S.mouse.y}`, class: "w-prev", "pointer-events": "none" }, gOver); }
  if (S.hover && compById(S.hover[0])) { const q = pinPx(S.hover); el("circle", { cx: q.x, cy: q.y, r: 7, class: "pinring" }, gOver); }
}
function defaultParams(d) { const o = {}; for (const k in d.params) o[k] = d.params[k].default; return o; }
function hint(t) { $("hint").textContent = t || ""; }

/* ---------------------------------------------------------------- view */
function toWorld(ev) { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left - S.view.x) / S.view.k, y: (ev.clientY - r.top - S.view.y) / S.view.k }; }
function visibleBottom() { const r = cv.getBoundingClientRect(); return isDesk() ? 0 : Math.min(r.height * 0.7, SH.p * r.height); }
function fit() {
  const cs = S.proj.components; const r = cv.getBoundingClientRect(), bi = visibleBottom(), H = r.height - bi, tr = 24;
  if (!cs.length || !r.width) { S.view = { x: r.width / 2, y: H / 2, k: 1 }; applyView(); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const c of cs) { const b = worldBox(c); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  const m = 36, k = Math.min(1.25, (r.width - tr - m) / Math.max(1, x1 - x0), (H - 2 * m) / Math.max(1, y1 - y0));
  S.view = { k, x: (r.width - tr - (x1 - x0) * k) / 2 - x0 * k + 4, y: (H - (y1 - y0) * k) / 2 - y0 * k }; applyView();
}
function zoomBy(f) { const r = cv.getBoundingClientRect(), v = S.view, k = Math.min(4, Math.max(0.12, v.k * f)), mx = r.width / 2, my = (r.height - visibleBottom()) / 2; v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; applyView(); }
cv.addEventListener("wheel", (e) => {
  e.preventDefault(); const r = cv.getBoundingClientRect(), v = S.view, f = Math.exp(-e.deltaY * 0.0015);
  const k = Math.min(4, Math.max(0.12, v.k * f)), mx = e.clientX - r.left, my = e.clientY - r.top;
  v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; applyView();
}, { passive: false });

/* ---------------------------------------------------------------- pointer interaction */
const ptrs = new Map(); let pinch = null;
const segDist = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)); return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y); };
function wireEndAt(pos) {
  if (!S.sel || S.sel.kind !== "w") return null; const w = S.proj.wires.find((x) => x.id === S.sel.id); if (!w) return null;
  for (const end of ["a", "b"]) { const q = pinPx(w[end]); if ((q.x - pos.x) ** 2 + (q.y - pos.y) ** 2 <= 64) return { w, end }; }
  return null;
}
function beginSegDrag(w, pos) {
  const pts = (routeFor(w) || []).map((p) => ({ ...p })); let best = null, bd = 1e9;
  for (let i = 0; i < pts.length - 1; i++) { const d = segDist(pos, pts[i], pts[i + 1]); if (d < bd && (Math.abs(pts[i].x - pts[i + 1].x) > 0.5 || Math.abs(pts[i].y - pts[i + 1].y) > 0.5)) { best = i; bd = d; } }
  if (best === null) return false; S.wseg = { w, pts, i: best, start: { ...pos }, moved: false, old: [...(w.via || [])], pre: snap() }; return true;
}
function applySegDrag(pos) {
  const d = S.wseg; const pts = d.pts.map((p) => ({ ...p })); let i = d.i; const horizontal = Math.abs(pts[i].y - pts[i + 1].y) < 0.5;
  if (i === 0) { pts.unshift({ ...pts[0] }); i++; } const j = i + 1; if (j === pts.length - 1) pts.push({ ...pts[pts.length - 1] });
  const delta = horizontal ? pos.y - d.start.y : pos.x - d.start.x; if (Math.abs(delta) > 3) d.moved = true;
  const nw = Math.round(((horizontal ? pts[i].y : pts[i].x) + delta) / G) * G;
  for (const k of [i, j]) { if (horizontal) pts[k].y = nw; else pts[k].x = nw; }
  d.w.via = pts.slice(1, -1).map((q) => [Math.round(q.x / G), Math.round(q.y / G)]); drawWires();
}
function finishSegDrag() {
  const d = S.wseg; S.wseg = null; const w = d.w;
  if (!d.moved) { w.via = d.old; drawWires(); return; }
  const pts = routeFor(w); w.via = pts.slice(1, -1).map((q) => [Math.round(q.x / G), Math.round(q.y / G)]);
  S.hist.push(d.pre); S.fut = []; updHist(); changed(); renderAll();
}
function finishEndDrag(pos) {
  const d = S.wend; S.wend = null; S.wireFrom = null; hint(""); const pin = pinAt(pos), w = d.w;
  if (!pin || samePin(pin, w[d.end]) || samePin(pin, d.fixed)) { renderAll(); return; }
  const [ok, why] = canWire(pin, d.fixed, w); if (!ok) { toast(why); renderAll(); return; }
  pushHist(); w[d.end] = pin; w.via = []; changed(); renderAll();
}
cv.addEventListener("pointerdown", (e) => {
  cv.focus(); cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: S.view.k }; S.dragging = null; return; }
  if (e.button === 2) return;
  const w = toWorld(e); S.mouse = w; const tg = e.target, usePins = S.tool === "wire" || e.pointerType === "mouse" || !!S.wireFrom, pin = usePins ? pinAt(w) : null;
  if (S.tool !== "wire" && !S.wireFrom) {
    const hit = wireEndAt(w);
    if (hit) { S.wend = { w: hit.w, end: hit.end, fixed: hit.end === "a" ? hit.w.b : hit.w.a }; hint("Drop the wire end on another pin (empty space cancels)"); drawWires(); drawOver(); return; }
    if (!pin && tg.dataset && tg.dataset.w) { const id = tg.dataset.w; select({ kind: "w", id }); const wr = S.proj.wires.find((x) => x.id === id); if (wr) beginSegDrag(wr, w); return; }
  }
  if (pin) {
    if (!S.wireFrom) { S.wireFrom = pin; S.pressPos = w; hint("Wire: click or release on another pin (Esc cancels)"); drawOver(); return; }
    if (!samePin(pin, S.wireFrom)) { const a = S.wireFrom; S.wireFrom = null; hint(""); connectPins(a, pin); drawOver(); }
    return;
  }
  if (S.wireFrom) { S.wireFrom = null; hint("Wire cancelled"); drawOver(); return; }
  if (S.tool === "wire") return;
  const cg = tg.closest && tg.closest(".comp");
  if (cg) {
    const c = compById(cg.dataset.id); select({ kind: "c", id: c.id });
    const carry = defOf(c).engine === "board" ? seatedOn(c.id).map((id) => { const o = compById(id); return { id, ox: o.x, oy: o.y }; }) : [];
    S.dragging = { type: "move", id: c.id, sx: w.x, sy: w.y, ox: c.x, oy: c.y, px: c.x, py: c.y, carry, moved: false, pre: snap() }; return;
  }
  select(null); S.dragging = { type: "pan", sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y }; cv.classList.add("pan");
});
cv.addEventListener("pointermove", (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; S.view.k = Math.min(4, Math.max(0.12, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); applyView(); return; }
  const w = toWorld(e); S.mouse = w; $("coords").textContent = `x ${Math.round(w.x / G)} y ${Math.round(w.y / G)}`; const d = S.dragging;
  if (e.pointerType === "mouse") { const hp = pinAt(w); if (!samePin(hp, S.hover) && !d) { S.hover = hp; drawOver(); } }
  if (S.wseg) { applySegDrag(w); return; }
  if (S.wend || S.wireFrom) { drawOver(); return; }
  if (d && d.type === "pan") { S.view.x = d.vx + e.clientX - d.sx; S.view.y = d.vy + e.clientY - d.sy; applyView(); }
  else if (d && d.type === "move") {
    const c = compById(d.id), nx = d.ox + Math.round((w.x - d.sx) / G), ny = d.oy + Math.round((w.y - d.sy) / G);
    if (nx !== c.x || ny !== c.y) {
      const dx = nx - d.px, dy = ny - d.py; d.px = nx; d.py = ny; c.x = nx; c.y = ny; d.moved = true;
      const ids = new Set([c.id, ...d.carry.map((k) => k.id)]); shiftVia(ids, dx, dy);
      for (const k of d.carry) { const o = compById(k.id); o.x = k.ox + (nx - d.ox); o.y = k.oy + (ny - d.oy); }
      S.hover = null; renderAll();
    }
  }
});
function endPtr(e) {
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
  const w = toWorld(e);
  if (S.wseg) { finishSegDrag(); return; }
  if (S.wend) { finishEndDrag(w); return; }
  if (S.wireFrom && S.pressPos) {
    const moved = Math.abs(w.x - S.pressPos.x) + Math.abs(w.y - S.pressPos.y) > 6, pin = pinAt(w);
    if (moved) { const a = S.wireFrom; S.wireFrom = null; S.pressPos = null; hint(""); if (pin && !samePin(pin, a)) connectPins(a, pin); drawOver(); }
    else S.pressPos = null;
    return;
  }
  const d = S.dragging; S.dragging = null; cv.classList.remove("pan");
  if (d && d.type === "move" && d.moved) {
    if (!d.carry.some(() => false) && defOf(compById(d.id)).engine !== "board") seatComp(d.id, true);
    S.hist.push(d.pre); S.fut = []; updHist(); renderAll(); changed(); buildProps();
  }
}
cv.addEventListener("pointerup", endPtr); cv.addEventListener("pointercancel", endPtr);
cv.addEventListener("contextmenu", (e) => { e.preventDefault(); if (S.tool) setTool(null); S.wireFrom = null; S.wend = null; renderAll(); });
cv.addEventListener("dblclick", (e) => {
  const wh = e.target.dataset && e.target.dataset.w;
  if (wh && !pinAt(toWorld(e))) { const w = S.proj.wires.find((x) => x.id === wh); if (w && w.via && w.via.length) { pushHist(); w.via = []; changed(); renderAll(); toast("Wire auto-routed"); } }
});

function select(s) { S.sel = s; renderAll(); buildProps(); updCtx(); if (s) openPage("prop"); }
function updCtx() {
  const sel = S.sel, isC = !!sel && sel.kind === "c";
  $("bRot").disabled = !isC; $("bMir").disabled = !isC; $("bDel").disabled = !sel;
}
cv.addEventListener("dblclick", (e) => { const g = e.target.closest && e.target.closest(".comp"); if (g) { select({ kind: "c", id: g.dataset.id }); openPage("prop"); } });
function nextRef(d) { const used = new Set(S.proj.components.map((c) => c.ref)); let n = 1; while (used.has(d.prefix + n)) n++; return d.prefix + n; }
function placePart(type, x, y, r) {
  const d = S.defs[type]; pushHist();
  const c = { id: Math.random().toString(16).slice(2, 10), type, ref: nextRef(d), x, y, rot: r, mirror: false, params: defaultParams(d) };
  S.proj.components.push(c); seatComp(c.id, true); S.sel = { kind: "c", id: c.id }; changed(); renderAll(); buildPanels();
  updCtx(); toast(`Added ${c.ref}. Drag it into place.`); openPage("prop");
}
function setTool(t) {
  S.tool = t; S.wireFrom = null; cv.setAttribute("class", t === "wire" ? "wiring" : "");
  $("bWire").classList.toggle("on", t === "wire"); $("bWire").setAttribute("aria-pressed", t === "wire");
  hint(t === "wire" ? "Wire tool: click a pin, then another pin (drag from a pin works too)" : ""); drawOver();
}
function addPartCenter(type) {
  const r = cv.getBoundingClientRect(), v = S.view, bi = visibleBottom();
  const wx = (r.width / 2 - v.x) / v.k, wy = ((r.height - bi) / 2 - v.y) / v.k;
  placePart(type, Math.round(wx / G), Math.round(wy / G), 0);
}
function delSel() {
  if (!S.sel) return; pushHist();
  if (S.sel.kind === "w") S.proj.wires = S.proj.wires.filter((w) => w.id !== S.sel.id);
  else { const id = S.sel.id; S.proj.components = S.proj.components.filter((c) => c.id !== id); S.proj.wires = S.proj.wires.filter((w) => w.a[0] !== id && w.b[0] !== id); }
  S.sel = null; renderAll(); buildPanels(); updCtx(); changed();
}
function rotSel(mirror) {
  if (!S.sel || S.sel.kind !== "c") return; pushHist(); const c = compById(S.sel.id);
  if (mirror) c.mirror = !c.mirror; else c.rot = (c.rot + 1) % 4; renderAll(); changed();
}
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "select" || tag === "textarea" || netMode) return;
  const k = e.key.toLowerCase();
  if (k.startsWith("arrow") && S.sel && S.sel.kind === "c" && !e.ctrlKey) {
    e.preventDefault(); const dx = { arrowleft: -1, arrowright: 1 }[k] || 0, dy = { arrowup: -1, arrowdown: 1 }[k] || 0, c = compById(S.sel.id); pushHist();
    const carry = defOf(c).engine === "board" ? seatedOn(c.id) : []; c.x += dx; c.y += dy; for (const id of carry) { const o = compById(id); o.x += dx; o.y += dy; } shiftVia(new Set([c.id, ...carry]), dx, dy);
    if (defOf(c).engine !== "board") seatComp(c.id, true); renderAll(); changed(); return;
  }
  if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
  else if ((e.ctrlKey || e.metaKey) && k === "l") { e.preventDefault(); toggleLive(); }
  else if ((e.ctrlKey || e.metaKey) && k === "enter") { e.preventDefault(); run(); }
  else if (k === "delete" || k === "backspace") { e.preventDefault(); delSel(); }
  else if (k === "r") rotSel(false); else if (k === "f") rotSel(true);
  else if (k === "w") setTool(S.tool === "wire" ? null : "wire");
  else if (k === "escape") { setTool(null); select(null); }
  else if (k === "home") fit();
});

/* ---------------------------------------------------------------- run */
function setStatus(t, cls = "") { const e = $("status"); e.textContent = t; e.className = "st " + cls; $("sdot").className = "sdot " + cls; }
function updStatusbar() {
  if (!S.proj) return; $("counts").textContent = `${S.proj.components.length} parts · ${S.proj.wires.length} wires`;
  const dg = (S.res && S.res.diagnostics) || [], e = dg.filter((d) => d.severity === "error").length, w = dg.filter((d) => d.severity === "warning").length, p = $("problems");
  if (S.res && !S.res.ok) { p.textContent = "Simulation error"; p.className = "problems bad"; }
  else if (e) { p.textContent = `${e} wiring problem${e > 1 ? "s" : ""}`; p.className = "problems bad"; }
  else if (w) { p.textContent = `${w} warning${w > 1 ? "s" : ""}`; p.className = "problems warn"; }
  else { p.textContent = "No wiring problems"; p.className = "problems ok"; }
}
let toastTimer = 0;
function toast(t, ms = 2400) { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove("show"), ms); }
let liveTimer = 0;
function changed() { stopAudio(); S.cur = null; if (S.live) { clearTimeout(liveTimer); liveTimer = setTimeout(run, 110); } else if (S.res) setStatus("Edited — press Run"); }
async function run() {
  if (S.running) { S.again = true; return; }
  if (!S.proj.components.length) return;
  S.running = true; setStatus("Running", "busy"); $("bRun").classList.add("busy"); $("bRun").disabled = true; const t0 = performance.now();
  try {
    const out = JSON.parse(await call("run", JSON.stringify({ ...S.proj, sim: S.proj.sim }), "{}", S.key));
    S.res = out;
    if (!out.ok) setStatus(out.error.length > 90 ? out.error.slice(0, 90) + "…" : out.error, "err");
    else setStatus(`Done in ${((performance.now() - t0) / 1000).toFixed(2)} s`, "ok");
    renderAll(); buildResults(); buildGraph(); buildScope(); afterRun();
  } catch (err) { setStatus(String(err.message || err), "err"); }
  S.running = false; $("bRun").classList.remove("busy"); $("bRun").disabled = false; if (S.again) { S.again = false; run(); }
}
function afterRun() {
  const r = S.res; const bad = !r || !r.ok || (r.checks || []).some((c) => !c.passed);
  if (!r.ok) toast(r.error.length > 110 ? r.error.slice(0, 110) + "…" : r.error, 4200);
  updStatusbar(); buildSerial(); if (S.live) return;
  const d = $("resDot"); d.hidden = false; d.classList.toggle("bad", bad);
  if (r.ok && r.serial) openPage("serial"); else openPage("res");
  openPage(scopeRefs().length ? "scope" : "graph");
  if (r.ok && r.audio && S.sound) playAudio(r.audio);
}

/* ---------------------------------------------------------------- docks, menus, palette, examples */
let netMode = false;
const isDesk = () => true;
const SH = { state: "open" };
const TABMAP = { prop: "insp", ctl: "ctl", exp: "guide", res: "res", scope: "scope", graph: "graph", serial: "serial", sketch: "sketch" };
const RIGHT = { insp: "pInsp", ctl: "pCtl", guide: "pGuide", res: "pRes", serial: "pSerial", sketch: "pSketch" };
const BOTTOM = { scope: "pScope", graph: "pGraph" };
const bdCollapsed = () => $("bdock").classList.contains("collapsed");
function openPage(page, _state, sub) {
  let t = TABMAP[page] || page; if (page === "res" && sub === 1) t = "graph";
  if (RIGHT[t]) {
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    for (const k in RIGHT) $(RIGHT[k]).hidden = k !== t;
    if (t === "res") $("resDot").hidden = true;
    if (t === "sketch") buildSketch(); if (t === "serial") buildSerial();
  } else if (BOTTOM[t]) {
    document.querySelectorAll("#btabs button[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    for (const k in BOTTOM) $(BOTTOM[k]).hidden = k !== t;
    $("bdock").classList.remove("collapsed");
    requestAnimationFrame(() => { drawGraph(); drawScope(); });
  }
}
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) openPage(b.dataset.t); });
$("btabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) openPage(b.dataset.t); });
$("bdToggle").onclick = () => { $("bdock").classList.toggle("collapsed"); setTimeout(() => { fit(); drawGraph(); drawScope(); }, 30); };
function makeSplitter(grip, dock, center) {
  let d = null;
  grip.addEventListener("pointerdown", (e) => { d = { y: e.clientY, h: dock.getBoundingClientRect().height }; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", (e) => { if (!d) return; const max = center.getBoundingClientRect().height - 160; dock.classList.remove("collapsed"); dock.style.height = Math.max(80, Math.min(max, d.h + d.y - e.clientY)) + "px"; });
  const up = () => { if (d) { d = null; window.dispatchEvent(new Event("resize")); } };
  grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
}
makeSplitter($("bgrip"), $("bdock"), document.querySelector("#workElec .center"));
window.addEventListener("resize", () => { if (!netMode) { drawGraph(); drawScope(); } });

/* generic drop-down menu */
const menuEl = $("menu");
function showMenu(anchor, items) {
  menuEl.innerHTML = "";
  for (const it of items) {
    if (it.sep) { menuEl.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button"); b.disabled = !!it.d;
    b.innerHTML = `<span class="chk">${it.chk ? "✓" : ""}</span><span>${html(it.t)}</span>${it.k ? `<span class="k">${html(it.k)}</span>` : ""}`;
    b.onclick = () => { menuEl.hidden = true; it.f && it.f(); }; menuEl.appendChild(b);
  }
  const r = anchor.getBoundingClientRect(); menuEl.hidden = false; menuEl.style.left = Math.min(r.left, innerWidth - 230) + "px"; menuEl.style.top = r.bottom + 4 + "px";
}
document.addEventListener("pointerdown", (e) => {
  if (!menuEl.hidden && !e.target.closest("#menu") && !e.target.closest(".rb")) menuEl.hidden = true;
  const m = $("exMenu"); if (!m.hidden && !e.target.closest("#exMenu") && !e.target.closest("#mEx")) m.hidden = true;
});
const FILE = {
  elec: { new: () => newCircuit(), open: () => $("fOpen").click(), save: () => saveCircuit(), csv: () => exportCsv() },
  net: {},
};
const EDIT = { elec: () => [
  { t: "Undo", k: "Ctrl+Z", f: undo, d: !S.hist.length }, { t: "Redo", k: "Ctrl+Y", f: redo, d: !S.fut.length }, { sep: 1 },
  { t: "Rotate", k: "R", f: () => rotSel(false), d: !S.sel || S.sel.kind !== "c" }, { t: "Mirror", k: "F", f: () => rotSel(true), d: !S.sel || S.sel.kind !== "c" }, { t: "Delete", k: "Del", f: delSel, d: !S.sel },
  { sep: 1 }, { t: "Fit circuit to window", k: "Home", f: fit }], net: () => [] };
$("mFile").onclick = (e) => { const f = FILE[netMode ? "net" : "elec"]; showMenu(e.currentTarget, [
  { t: netMode ? "New network" : "New circuit", f: f.new }, { t: "Open…", f: f.open }, { t: "Save", f: f.save }, { sep: 1 }, { t: netMode ? "Export packet capture (CSV)" : "Export results (CSV)", f: f.csv }]); };
$("mEdit").onclick = (e) => showMenu(e.currentTarget, EDIT[netMode ? "net" : "elec"]());
$("mMore").onclick = (e) => showMenu(e.currentTarget, [
  { t: "Palette", f: () => togglePanel("palette"), chk: !panelHidden("palette") }, { t: "Properties dock", f: () => togglePanel("rdock"), chk: !panelHidden("rdock") }, { t: "Bottom dock", f: () => $("bdToggle").click(), chk: !bdCollapsed() },
  { sep: 1 }, { t: document.documentElement.dataset.theme === "light" ? "Switch to dark theme" : "Switch to light theme", f: toggleTheme },
  { sep: 1 }, { t: "Quick guide", f: showGuide }, { t: "About", f: showAbout }, { t: "Download the desktop app", f: () => (location.href = "../#app") }]);
function panelHidden(cls) { const w = netMode ? $("workNet") : $("workElec"); const n = w.querySelector("." + cls); return !n || n.style.display === "none"; }
function togglePanel(cls) { const w = netMode ? $("workNet") : $("workElec"); const n = w.querySelector("." + cls); if (!n) return; n.style.display = n.style.display === "none" ? "" : "none"; w.style.gridTemplateColumns = ""; setTimeout(() => { fit(); window.dispatchEvent(new Event("resize")); }, 30); }
function toggleTheme() {
  const light = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = light ? "light" : "dark";
  try { localStorage.setItem("ll-theme", light ? "light" : "dark"); } catch (e) { /* ignore */ }
  document.querySelector('meta[name="theme-color"]').content = light ? "#ffffff" : "#1f2226"; try { $("ardFrame").contentWindow.postMessage({ theme: light ? "light" : "dark" }, "*"); } catch (e) { /* frame not loaded */ } if (S.proj) { renderAll(); drawGraph(); drawScope(); }
}
try { if (localStorage.getItem("ll-theme") === "dark") { document.documentElement.dataset.theme = "dark"; } } catch (e) { /* ignore */ }
function modal(h) { $("modalBody").innerHTML = h; $("modal").hidden = false; }
$("modalClose").onclick = () => ($("modal").hidden = true); $("modal").addEventListener("pointerdown", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });
function showGuide() { modal(`<h3>Quick guide</h3><p><b>Electronics.</b> Pick an experiment from <b>Examples</b>, or drag parts in from the palette. Click a pin, then another pin, to wire them. Press <b>Run</b>; switch on <b>Live</b> and drag a slider in <b>Controls</b> to watch the circuit respond.</p><p><b>Network.</b> Switch to the Network workspace, add blocks, connect them, set addresses and applications in Properties, press <b>Run</b> and watch the packets replay.</p><p><kbd>Ctrl</kbd>+<kbd>Enter</kbd> run · <kbd>Ctrl</kbd>+<kbd>L</kbd> live · <kbd>R</kbd> rotate · <kbd>F</kbd> mirror · <kbd>W</kbd> wire · <kbd>Del</kbd> delete · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo · wheel zooms · drag empty space to pan.</p>`); }
function showAbout() { modal(`<h3>LEARNERS LAB</h3><p>A virtual electronics and networks laboratory by VIN Technologies. This page runs the same Python simulation engine as the Windows app, inside your browser (Pyodide + NumPy). Nothing is sent to a server.</p><p class="mute">Models are simplified (level-1 transistors, ideal breadboard, Arduino C++ subset). See the desktop manual for limits.</p>`); }

/* wire colours */
const WCOL = ["#d46a63", "#1a1c20", "#d1953b", "#e3c04a", "#5fae78", "#6f9bc0", "#9a7fd0", "#f2f2f2", "#8b929b", "#8a5a3a", "#d675a8", "#4fb3c0"];
S.wireColor = "";
function buildSwatches() {
  const box = $("swatches"); box.innerHTML = "";
  for (const c of WCOL) { const b = document.createElement("button"); b.style.background = c; b.setAttribute("aria-label", "Wire colour " + c); b.dataset.c = c; box.appendChild(b); }
  $("autoColor").onchange = () => { if ($("autoColor").checked) { S.wireColor = ""; box.querySelectorAll("button").forEach((x) => x.classList.remove("on")); } };
  box.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return; S.wireColor = b.dataset.c; $("autoColor").checked = false;
    box.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    if (S.sel && S.sel.kind === "w") { const w = S.proj.wires.find((x) => x.id === S.sel.id); if (w) { pushHist(); w.color = S.wireColor; drawWires(); } }
  };
}
function wireColorFor() { return $("autoColor").checked ? "" : S.wireColor || ""; }

/* examples menu (circuits and networks) */
let expFilter = "All", expKind = "elec";
const GCOL = ["#6f9bc0", "#5fae78", "#d1953b", "#d46a63", "#b9a46a", "#7fb5b8", "#c08a5a", "#a3a9b0"];
function chipRow(box, items, cur, onPick) {
  box.innerHTML = ""; for (const it of items) { const b = document.createElement("button"); b.textContent = it; if (it === cur) b.className = "on"; b.onclick = () => onPick(it); box.appendChild(b); }
}
const expItems = () => (expKind === "net" ? (window.NET ? NET.examples : []) : S.examples);
function renderExp() {
  const items = expItems(), groups = [...new Set(items.map((e) => e.group))]; S.groupCol = Object.fromEntries([...new Set([...S.examples, ...(window.NET ? NET.examples : [])].map((e) => e.group))].map((g, i) => [g, GCOL[i % GCOL.length]]));
  if (expFilter !== "All" && !groups.includes(expFilter)) expFilter = "All";
  chipRow($("expChips"), ["All", ...groups], expFilter, (g) => { expFilter = g; renderExp(); });
  const q = $("expSearch").value.trim().toLowerCase(), box = $("expList"); box.innerHTML = ""; let last = "", n = 0;
  for (const e of items) {
    if (expFilter !== "All" && e.group !== expFilter) continue; if (q && !(e.title + " " + e.group).toLowerCase().includes(q)) continue;
    if (e.group !== last) { const h = document.createElement("h4"); h.textContent = e.group; box.appendChild(h); }
    last = e.group; n++;
    const b = document.createElement("button"); b.className = "card" + (e.key === (expKind === "net" ? NET.key : S.key) ? " on" : ""); b.dataset.key = e.key;
    b.innerHTML = `<span class="ci" style="background:${S.groupCol[e.group]}"></span><span class="tx"><b>${html(e.title)}</b></span>`; box.appendChild(b);
  }
  if (!n) box.innerHTML = '<div class="empty">No experiments match.</div>';
}
$("mEx").onclick = (e) => {
  const m = $("exMenu"); if (!m.hidden) { m.hidden = true; return; }
  expKind = netMode ? "net" : "elec"; $("exSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === expKind)); renderExp();
  const r = e.currentTarget.getBoundingClientRect(); m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + "px"; m.style.top = r.bottom + 4 + "px"; m.hidden = false; $("expSearch").focus();
};
$("exSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; expKind = b.dataset.k; $("exSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); renderExp(); };

/* palette */
const catClosed = {};
function thumbHtml(d) {
  const svg = document.createElementNS(NS, "svg"), g = el("g", {}, svg); const fake = { type: d.type, ref: "", params: {}, rot: 0, mirror: false };
  symbolSVG(fake, d, g); const [x0, y0, x1, y1] = localBox(d); const w = x1 - x0, h = y1 - y0, k = Math.min(60 / w, 50 / h, 1);
  svg.setAttribute("viewBox", `${x0} ${y0} ${w} ${h}`); svg.setAttribute("width", Math.round(w * k)); svg.setAttribute("height", Math.round(h * k));
  svg.querySelectorAll("text.plabel").forEach((t) => t.remove()); return svg.outerHTML;
}
function renderParts() {
  const q = $("partSearch").value.trim().toLowerCase(), box = $("partTree"); box.innerHTML = ""; const by = {};
  for (const d of Object.values(S.defs)) { if (d.engine === "none" || d.type === "breadboard") continue; if (q && !(d.name + " " + d.type + " " + d.category).toLowerCase().includes(q)) continue; (by[d.category] ||= []).push(d); }
  for (const c of S.cats) {
    if (!by[c]) continue; const sec = document.createElement("div"); sec.className = "cat" + (!q && catClosed[c] ? " closed" : "");
    const h = document.createElement("button"); h.className = "cathead"; h.innerHTML = `<svg class="ic xs"><use href="#i-chev"/></svg>${html(c)}<span class="n">${by[c].length}</span>`;
    h.onclick = () => { catClosed[c] = !catClosed[c]; sec.classList.toggle("closed", catClosed[c]); }; sec.appendChild(h);
    const grid = document.createElement("div"); grid.className = "tiles";
    for (const d of by[c].sort((a, b) => a.name.localeCompare(b.name))) {
      const b = document.createElement("button"); b.className = "tile"; b.dataset.type = d.type; b.draggable = true; b.title = d.description;
      b.innerHTML = `<span class="th">${d.sprite ? `<img loading="lazy" alt="" src="af/${d.sprite[0]}.svg">` : thumbHtml(d)}</span><span>${html(d.name)}</span>`;
      const im = b.querySelector("img"); if (im) im.onerror = () => { b.querySelector(".th").innerHTML = '<svg class="ic"><use href="#i-chip"/></svg>'; };
      grid.appendChild(b);
    }
    sec.appendChild(grid); box.appendChild(sec);
  }
  if (!box.children.length) box.innerHTML = '<div class="empty">No components match.</div>';
}
function buildLists() {
  const ORDER = ["Boards and breadboards", "Sources and power", "Passive components", "Semiconductors", "Analog ICs", "Digital ICs", "Digital logic", "Power ICs", "Switches and buzzers", "Instruments"];
  S.cats = [...new Set(Object.values(S.defs).filter((d) => d.engine !== "none" && d.type !== "breadboard").map((d) => d.category))].sort((x, y) => (ORDER.indexOf(x) + 99) % 99 - (ORDER.indexOf(y) + 99) % 99);
  $("partSearch").placeholder = `Search ${Object.values(S.defs).filter((d) => d.engine !== "none").length} components`;
  buildSwatches(); renderExp(); renderParts();
  $("expList").onclick = (e) => { const b = e.target.closest(".card"); if (b) { $("exMenu").hidden = true; expKind === "net" ? openNetExample(b.dataset.key) : openExample(b.dataset.key, true); } };
  $("partTree").onclick = (e) => { const b = e.target.closest(".tile"); if (b) { addPartCenter(b.dataset.type); $("app").classList.remove("showparts"); } };
  $("partTree").addEventListener("dragstart", (e) => { const b = e.target.closest(".tile"); if (b) { e.dataTransfer.setData("text/plain", b.dataset.type); e.dataTransfer.effectAllowed = "copy"; } });
  const st = $("stage");
  st.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  st.addEventListener("drop", (e) => { e.preventDefault(); const t = e.dataTransfer.getData("text/plain"); if (t && S.defs[t]) { const w = toWorld(e); placePart(t, Math.round(w.x / G), Math.round(w.y / G), 0); } });
  $("expSearch").addEventListener("input", renderExp); $("partSearch").addEventListener("input", renderParts);
  $("bParts").onclick = () => $("app").classList.toggle("showparts");
}

/* sound */
S.sound = true; let audioEl = null;
function stopAudio() { if (audioEl) { try { audioEl.pause(); } catch (e) { /* ignore */ } audioEl = null; } }
function playAudio(b64) { stopAudio(); try { audioEl = new Audio("data:audio/wav;base64," + b64); audioEl.play().catch(() => toast("Click the page once to allow sound")); } catch (e) { /* ignore */ } }
$("bSound").onclick = () => { S.sound = !S.sound; $("bSound").classList.toggle("on", S.sound); $("bSound").setAttribute("aria-pressed", S.sound); if (!S.sound) stopAudio(); else if (S.res && S.res.audio) playAudio(S.res.audio); };

/* serial monitor and sketch editor */
function buildSerial() {
  const p = $("rserial"), r = S.res;
  const t = r && r.ok && r.serial ? r.serial : "";
  p.innerHTML = `<div class="hl"><b>Serial monitor</b><span class="mute">${t ? "output of Serial.print() from the sketch" : "Run a circuit with an Arduino sketch that uses Serial."}</span></div><pre class="serial">${html(t)}</pre>`;
}
function arduinoComp() {
  if (S.sel && S.sel.kind === "c") { const c = compById(S.sel.id); if (c && c.type === "arduino") return c; }
  return S.proj.components.find((c) => c.type === "arduino") || null;
}
function buildSketch() {
  const p = $("rsketch"), c = arduinoComp();
  if (!c) { p.innerHTML = '<p class="empty">Place an Arduino UNO from the palette to write a sketch for it.</p>'; return; }
  p.innerHTML = `<div class="hl"><b>${html(c.ref)} sketch</b><span class="grow"></span><button id="skCheck" class="btn">Compile check</button><button id="skRun" class="btn">Run</button></div><textarea id="skCode" class="codebox" spellcheck="false"></textarea><div id="skMsg" class="mute" style="margin-top:6px"></div>`;
  const ta = $("skCode"); ta.value = c.params.code || ""; let pushed = false;
  ta.addEventListener("input", () => { if (!pushed) { pushed = true; pushHist(); } c.params.code = ta.value; changed(); });
  ta.addEventListener("change", () => { pushed = false; });
  ta.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); const s0 = ta.selectionStart; ta.setRangeText("  ", s0, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); } });
  $("skCheck").onclick = async () => { const r = JSON.parse(await call("compile_check", ta.value)); $("skMsg").style.color = r.ok ? "var(--ok)" : "var(--bad)"; $("skMsg").textContent = r.message; };
  $("skRun").onclick = run;
}

/* ---------------------------------------------------------------- panels */
function buildPanels() { buildCtl(); buildProps(); if (!$("pSketch").hidden) buildSketch(); }
function buildInfo() {
  const i = S.info; const p = $("rinfo"); if (!i) { p.innerHTML = '<p class="empty">Pick an experiment on the left, or build your own circuit from the Parts tab.</p>'; return; }
  let h = `<h3>${html(i.title)}</h3><div class="mute">${html(i.group)}</div>`;
  if (i.objective) h += `<h5>Objective</h5><p>${html(i.objective)}</p>`;
  if (i.steps && i.steps.length) h += `<h5>Procedure</h5><ol>${i.steps.map((s) => `<li>${html(s)}</li>`).join("")}</ol>`;
  if (i.theory) h += `<h5>Theory</h5><p>${html(i.theory)}</p>`;
  if (i.questions && i.questions.length) h += `<h5>Questions</h5><ol>${i.questions.map((s) => `<li>${html(typeof s === "string" ? s : s.q || s.question || JSON.stringify(s))}</li>`).join("")}</ol>`;
  if (i.limits) h += `<h5>Limits of the model</h5><p class="mute">${html(i.limits)}</p>`;
  p.innerHTML = h;
}

/* live sliders */
const SPECS = {
  pot: [["pos", "Wiper position", "lin", 0, 1, ""]], resistor: [["R", "Resistance", "log", 1, 10e6, "Ω"]], capacitor: [["C", "Capacitance", "log", 1e-9, 10e-3, "F"]],
  capacitor_ceramic: [["C", "Capacitance", "log", 1e-12, 10e-6, "F"]], inductor: [["L", "Inductance", "log", 1e-6, 10, "H"]], vdc: [["V", "Voltage", "lin", 0, 30, "V"]],
  vac: [["amp", "Amplitude", "lin", 0, 20, "V"], ["freq", "Frequency", "log", 1, 1e6, "Hz"]],
  vpulse: [["freq", "Frequency", "log", 1, 1e6, "Hz"], ["duty", "Duty cycle", "lin", 0, 1, ""], ["v2", "High level", "lin", 0, 20, "V"]],
  idc: [["I", "Current", "lin", 0, 0.1, "A"]], psu: [["V", "Voltage", "lin", 0, 30, "V"], ["Ilim", "Current limit", "lin", 0, 3, "A"]],
  ldr: [["lux", "Light level", "log", 0.1, 10000, "lux"]], bpw34: [["E", "Irradiance", "lin", 0, 10, "mW/cm²"]], zener: [["Vz", "Zener voltage", "lin", 1, 30, "V"]],
  speaker: [["volume", "Volume", "lin", 0, 1, ""]], clock: [["freq", "Frequency", "log", 0.1, 1e6, ""]],
};
const TOGGLES = { switch: ["closed", "Closed"], lswitch: ["value", "Output = 1"] };
const STEPS = 1000;
const toSl = (v, sc, lo, hi) => { v = Math.min(Math.max(+v, lo), hi); return Math.round(STEPS * (sc === "log" ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo))); };
const fromSl = (s, sc, lo, hi) => { const f = s / STEPS; return sc === "log" ? lo * Math.pow(hi / lo, f) : lo + f * (hi - lo); };
const nice = (v, sc, lo, hi) => sc === "log" ? +v.toPrecision(3) : Math.round(v / (hi - lo) * 200) / 200 * (hi - lo);
function buildCtl() {
  const p = $("rctl"); p.innerHTML = ""; let n = 0;
  for (const c of [...S.proj.components].sort((a, b) => a.type.localeCompare(b.type) || a.ref.localeCompare(b.ref, undefined, { numeric: true }))) {
    const rows = (SPECS[c.type] || []).filter((r) => r[0] in c.params), tg = TOGGLES[c.type];
    if (!rows.length && !(tg && tg[0] in c.params)) continue; n++;
    const h = document.createElement("div"); h.className = "compHead"; h.innerHTML = `<b>${html(c.ref)}</b><span>${html(defOf(c).name)}</span>`; p.appendChild(h);
    for (const [key, label, sc, lo, hi, unit] of rows) {
      const row = document.createElement("div"); row.className = "row";
      const val = +c.params[key];
      row.innerHTML = `<label>${label}</label><input type="range" min="0" max="${STEPS}" value="${toSl(val, sc, lo, hi)}"><output>${fmt(val, unit)}</output>`;
      const sl = row.querySelector("input"), out = row.querySelector("output"); let pushed = false;
      sl.addEventListener("input", () => {
        const v = nice(fromSl(+sl.value, sc, lo, hi), sc, lo, hi); c.params[key] = v; out.textContent = fmt(v, unit);
        if (!pushed) { pushed = true; S.hist.push(S._pre || snap()); S.fut = []; updHist(); }
        refreshComp(c); changed();
      });
      sl.addEventListener("pointerdown", () => { S._pre = snap(); pushed = false; });
      sl.addEventListener("change", () => { if (S.sel && S.sel.id === c.id) buildProps(); });
      p.appendChild(row);
    }
    if (tg && tg[0] in c.params) {
      const row = document.createElement("label"); row.className = "row p"; row.innerHTML = `<span class="mute">${tg[1]}</span><input type="checkbox" ${c.params[tg[0]] ? "checked" : ""}>`;
      row.querySelector("input").addEventListener("change", (e) => { pushHist(); c.params[tg[0]] = e.target.checked; refreshComp(c); changed(); buildProps(); });
      p.appendChild(row);
    }
  }
  if (!n) p.innerHTML = '<p class="empty">This circuit has no adjustable parts. Add a resistor, a source or a potentiometer, then drag its slider here.</p>';
  else p.insertAdjacentHTML("afterbegin", '<p class="mute">Drag a slider and switch on <b>Live</b> to watch meters, LEDs, the scope and graphs follow.</p>');
}
function refreshComp(c) { renderAll(); }

/* properties */
function circuitSummary(p) {
  const cs = S.proj.components, counts = {}; for (const c of cs) counts[defOf(c).name] = (counts[defOf(c).name] || 0) + 1;
  p.innerHTML = `<h3>Circuit</h3><p class="mute">${cs.length} parts · ${S.proj.wires.length} wires</p><p class="mute">Select a part or wire to edit it. Drag parts from the left; click a pin then another pin to connect them.</p><h5>Parts list</h5><ul class="plist">${Object.entries(counts).sort().map(([n, k]) => `<li><span>${html(n)}</span><span class="mute">×${k}</span></li>`).join("")}</ul>`;
}
function buildProps() {
  const p = $("rprop"); p.innerHTML = ""; const s = S.sel;
  if (!s) { circuitSummary(p); return; }
  if (s.kind === "w") {
    const w = S.proj.wires.find((x) => x.id === s.id); if (!w) return;
    const a = compById(w.a[0]), b = compById(w.b[0]);
    p.innerHTML = `<h3>Wire</h3><p>${html(a.ref)}.${html(w.a[1])} to ${html(b.ref)}.${html(w.b[1])}</p><button id="pDel">Delete wire</button>`;
    $("pDel").onclick = delSel; return;
  }
  const c = compById(s.id); if (!c) return; const d = defOf(c);
  p.insertAdjacentHTML("beforeend", `<h3>${html(c.ref)} — ${html(d.name)}</h3><p class="mute">${html(d.description)}</p>`);
  for (const k in d.params) {
    if (k === "code") { const b = document.createElement("button"); b.className = "btn block"; b.textContent = "Edit sketch"; b.onclick = () => openPage("sketch"); p.appendChild(b); continue; }
    const pm = d.params[k]; const row = document.createElement("label"); row.className = "row p";
    const lab = document.createElement("span"); lab.className = "mute"; lab.textContent = pm.label + (pm.unit ? ` (${pm.unit})` : ""); row.appendChild(lab);
    const v = c.params[k]; let inp;
    if (pm.choices && pm.choices.length) { inp = document.createElement("select"); for (const o of pm.choices) { const op = document.createElement("option"); op.textContent = o; op.value = o; if (String(o) === String(v)) op.selected = true; inp.appendChild(op); } inp.onchange = () => setParam(c, k, inp.value); }
    else if (typeof pm.default === "boolean") { inp = document.createElement("input"); inp.type = "checkbox"; inp.checked = !!v; inp.onchange = () => setParam(c, k, inp.checked); }
    else if (typeof pm.default === "number") { inp = document.createElement("input"); inp.type = "text"; inp.value = fmt(+v, "", 4).trim(); inp.onchange = () => { const n = parseSI(inp.value); if (isFinite(n)) setParam(c, k, n); else inp.value = fmt(+c.params[k], "", 4).trim(); }; }
    else { inp = document.createElement("input"); inp.type = "text"; inp.value = v ?? ""; inp.onchange = () => setParam(c, k, inp.value); }
    if (pm.help) inp.title = pm.help; row.appendChild(inp); p.appendChild(row);
  }
  if (d.note) p.insertAdjacentHTML("beforeend", `<h5>Model</h5><p class="mute">${html(d.note)}</p>`);
  const b = document.createElement("button"); b.textContent = "Delete part"; b.style.marginTop = "10px"; b.onclick = delSel; p.appendChild(b);
}
function setParam(c, k, v) { pushHist(); c.params[k] = v; renderAll(); buildCtl(); changed(); }

/* results */
function buildResults() {
  const p = $("rres"), r = S.res; if (!r) { p.innerHTML = '<p class="empty">Press Run to simulate.</p>'; return; }
  let h = "";
  if (!r.ok) { h += `<div class="diag error">${html(r.error)}</div>`; }
  for (const d of r.diagnostics || []) h += `<div class="diag ${d.severity}">${html(d.source ? d.source + ": " : "")}${html(d.message)}</div>`;
  if (r.ok) {
    if (r.checks && r.checks.length) h += "<h5>Checks against theory</h5>" + r.checks.map((c) => `<div class="chk ${c.passed ? "" : "bad"}"><i></i><div><b>${html(c.name)}</b><div class="mute">${html(c.detail)}</div></div></div>`).join("");
    if (r.serial) h += `<h5>Serial monitor</h5><pre class="serial">${html(r.serial)}</pre>`;
    if (r.measurements && r.measurements.length) h += "<h5>Measurements</h5><table class='t'><tbody>" + r.measurements.map((m) => `<tr><td>${html(m.name)}${m.note ? `<div class="mute">${html(m.note)}</div>` : ""}</td><td class="n">${typeof m.value === "number" ? html(fmt(m.value, m.unit || "", 4)) : html(m.value ?? "")}</td></tr>`).join("") + "</tbody></table>";
    if (r.table && r.table.length) {
      const cols = Object.keys(r.table[0]); h += "<h5>Table</h5><table class='t'><thead><tr>" + cols.map((c) => `<th>${html(c)}</th>`).join("") + "</tr></thead><tbody>" +
        r.table.slice(0, 200).map((row) => "<tr>" + cols.map((c) => `<td class="n">${typeof row[c] === "number" ? html(fmt(row[c], "", 4)) : html(row[c] ?? "")}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
    }
  }
  p.innerHTML = h || '<p class="empty">No output.</p>';
}

/* ---------------------------------------------------------------- graph */
const COL = ["--trace1", "--trace2", "--trace3", "--trace4", "--trace5", "--trace6"];
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function sigNames() { return S.res && S.res.ok ? Object.keys(S.res.signals) : []; }
function buildGraph() {
  const names = sigNames(), box = $("gsig"); box.innerHTML = "";
  const keep = names.every((n) => n in S.sigOn);
  if (!keep) { S.sigOn = {}; const pref = names.filter((n) => /^V\(/.test(n)); (pref.length ? pref : names).slice(0, 4).forEach((n) => (S.sigOn[n] = true)); }
  names.forEach((n, i) => {
    const l = document.createElement("label"); l.className = "sig";
    l.innerHTML = `<input type="checkbox" ${S.sigOn[n] ? "checked" : ""}><i style="background:${css(COL[i % 6])}"></i><span>${html(n)}</span>`;
    l.querySelector("input").onchange = (e) => { S.sigOn[n] = e.target.checked; drawGraph(); }; box.appendChild(l);
  });
  const first = names.length ? S.res.signals[names[0]] : null;
  if (first) { $("gLogX").checked = !!first.logx; $("gLogY").checked = !!first.logy; }
  drawGraph();
}
function niceTicks(lo, hi, n = 6) {
  if (!(hi > lo)) { hi = lo + 1; } const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag; const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toPrecision(12)); return out;
}
function setupCanvas(c) { const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; c.width = Math.max(10, r.width * dpr); c.height = Math.max(10, r.height * dpr); const x = c.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); return [x, r.width, r.height]; }
let gView = null;
function drawGraph(cursorX) {
  const c = $("gcv"); if ($("pGraph").hidden || bdCollapsed() || netMode) return; const [x, W, H] = setupCanvas(c);
  x.clearRect(0, 0, W, H); const names = sigNames().filter((n) => S.sigOn[n]);
  x.font = "11px system-ui"; x.fillStyle = css("--mute");
  if (!names.length) { x.fillText("Run the circuit to see waveforms", 14, 24); gView = null; return; }
  const logX = $("gLogX").checked, logY = $("gLogY").checked, sg = S.res.signals;
  const fx = (v) => logX ? Math.log10(Math.max(v, 1e-30)) : v, fy = (v) => logY ? Math.log10(Math.max(Math.abs(v), 1e-30)) : v;
  let x0 = 1e30, x1 = -1e30, y0 = 1e30, y1 = -1e30;
  for (const n of names) { const s = sg[n]; for (let i = 0; i < s.x.length; i++) { const a = fx(s.x[i]), b = fy(s.y[i]); if (!isFinite(a) || !isFinite(b) || s.y[i] === null) continue; x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); } }
  if (!(x1 > x0)) x1 = x0 + 1; if (!(y1 > y0)) { y0 -= 1; y1 += 1; } const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  const L = 52, R = 10, T = 10, B = 28, pw = W - L - R, ph = H - T - B;
  const X = (v) => L + (fx(v) - x0) / (x1 - x0) * pw, Y = (v) => T + ph - (fy(v) - y0) / (y1 - y0) * ph;
  gView = { L, R, T, B, pw, ph, x0, x1, fx, names };
  x.strokeStyle = css("--line"); x.lineWidth = 1; x.fillStyle = css("--mute"); x.textAlign = "right"; x.textBaseline = "middle";
  const unitY = (sg[names[0]].ylabel.match(/\(([^)]*)\)/) || [, ""])[1], unitX = (sg[names[0]].xlabel.match(/\(([^)]*)\)/) || [, ""])[1];
  const yt = logY ? niceTicks(y0, y1, 5) : niceTicks(y0, y1, 5);
  for (const t of yt) { const yy = T + ph - (t - y0) / (y1 - y0) * ph; x.beginPath(); x.moveTo(L, yy); x.lineTo(L + pw, yy); x.stroke(); x.fillText(logY ? fmt(Math.pow(10, t), unitY, 2) : fmt(t, unitY, 3), L - 5, yy); }
  x.textAlign = "center"; x.textBaseline = "top";
  for (const t of niceTicks(x0, x1, 6)) { const xx = L + (t - x0) / (x1 - x0) * pw; x.beginPath(); x.moveTo(xx, T); x.lineTo(xx, T + ph); x.stroke(); x.fillText(logX ? fmt(Math.pow(10, t), unitX, 2) : fmt(t, unitX, 3), xx, T + ph + 6); }
  x.strokeStyle = css("--mute"); x.strokeRect(L, T, pw, ph);
  x.save(); x.beginPath(); x.rect(L, T, pw, ph); x.clip();
  const all = sigNames();
  for (const n of names) {
    const s = sg[n]; x.strokeStyle = css(COL[all.indexOf(n) % 6]); x.lineWidth = 1.7; x.beginPath(); let started = false, px = 0, py = 0;
    for (let i = 0; i < s.x.length; i++) {
      if (s.y[i] === null || s.x[i] === null) { started = false; continue; }
      const xx = X(s.x[i]), yy = Y(s.y[i]);
      if (s.kind === "step" && started) { x.lineTo(xx, py); x.lineTo(xx, yy); } else if (!started) { x.moveTo(xx, yy); started = true; } else x.lineTo(xx, yy);
      px = xx; py = yy;
    }
    x.stroke();
  }
  if (cursorX !== undefined) { x.strokeStyle = css("--acc2"); x.setLineDash([4, 3]); x.beginPath(); x.moveTo(cursorX, T); x.lineTo(cursorX, T + ph); x.stroke(); x.setLineDash([]); }
  x.restore();
}
$("gcv").addEventListener("pointermove", (e) => {
  if (!gView) return; const r = $("gcv").getBoundingClientRect(), px = e.clientX - r.left; const g = gView;
  if (px < g.L || px > g.L + g.pw) return; const fxv = g.x0 + (px - g.L) / g.pw * (g.x1 - g.x0), xv = $("gLogX").checked ? Math.pow(10, fxv) : fxv;
  drawGraph(px); const sg = S.res.signals; const all = sigNames();
  const parts = g.names.map((n) => { const s = sg[n]; let lo = 0, hi = s.x.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s.x[m] < xv) lo = m; else hi = m; } const y = Math.abs(s.x[lo] - xv) < Math.abs(s.x[hi] - xv) ? s.y[lo] : s.y[hi];
    return `<span style="color:${css(COL[all.indexOf(n) % 6])}">${html(n)} ${html(fmt(y, (s.ylabel.match(/\(([^)]*)\)/) || [, ""])[1], 4))}</span>`; });
  const ux = (sg[g.names[0]].xlabel.match(/\(([^)]*)\)/) || [, ""])[1];
  $("greadout").innerHTML = `${html(fmt(xv, ux, 4))} &nbsp; ` + parts.join(" &nbsp; ");
});
$("gcv").addEventListener("pointerleave", () => { $("greadout").textContent = ""; drawGraph(); });
$("gLogX").onchange = $("gLogY").onchange = () => drawGraph();
$("gCsv").onclick = () => {
  const names = sigNames().filter((n) => S.sigOn[n]); if (!names.length) return; const s0 = S.res.signals[names[0]];
  let t = ["x," + names.map((n) => '"' + n + '"').join(",")]; for (let i = 0; i < s0.x.length; i++) t.push(s0.x[i] + "," + names.map((n) => S.res.signals[n].y[i] ?? "").join(","));
  download("signals.csv", t.join("\n"), "text/csv");
};
$("gPng").onclick = () => { $("gcv").toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "graph.png"; a.click(); }); };
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

/* ---------------------------------------------------------------- oscilloscope */
const scopeRefs = () => S.res && S.res.ok ? Object.keys(S.res.instruments || {}).filter((k) => S.res.instruments[k].type === "scope" && S.res.instruments[k].t) : [];
const STEP125 = []; for (let e = -9; e <= 3; e++) for (const m of [1, 2, 5]) STEP125.push(m * Math.pow(10, e));
const snap125 = (v) => STEP125.find((s) => s >= v * 0.999) || STEP125[STEP125.length - 1];
const SC = { ref: "", v1: 1, v2: 1, p1: 0, p2: 0, td: 1e-3, c1: "DC", c2: "DC", lvl: 0, xy: false, on1: true, on2: true, trig: 0 };
function buildScope() {
  const refs = scopeRefs(); $("scopeNone").hidden = !!refs.length; $("scopeBox").hidden = !refs.length; if (!refs.length) return;
  if (!refs.includes(SC.ref)) { SC.ref = refs[0]; scopeAuto(); }
  const k = $("sknobs"); const opt = (arr, cur, f = (v) => v) => arr.map((v) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${f(v)}</option>`).join("");
  const vd = STEP125.filter((v) => v >= 1e-3 && v <= 50), td = STEP125.filter((v) => v >= 1e-8 && v <= 10);
  k.innerHTML = `
    ${refs.length > 1 ? `<label class="k full"><span>Instrument</span><select id="s_ref">${opt(refs, SC.ref)}</select></label>` : ""}
    <label class="k"><span>CH1 V/div</span><select id="s_v1">${opt(vd, SC.v1, (v) => fmt(v, "V"))}</select></label>
    <label class="k"><span>CH2 V/div</span><select id="s_v2">${opt(vd, SC.v2, (v) => fmt(v, "V"))}</select></label>
    <label class="k"><span>CH1 position</span><input id="s_p1" type="range" min="-4" max="4" step="0.1" value="${SC.p1}"></label>
    <label class="k"><span>CH2 position</span><input id="s_p2" type="range" min="-4" max="4" step="0.1" value="${SC.p2}"></label>
    <label class="k"><span>CH1 coupling</span><select id="s_c1">${opt(["DC", "AC", "GND"], SC.c1)}</select></label>
    <label class="k"><span>CH2 coupling</span><select id="s_c2">${opt(["DC", "AC", "GND"], SC.c2)}</select></label>
    <label class="k"><span>Time/div</span><select id="s_td">${opt(td, SC.td, (v) => fmt(v, "s"))}</select></label>
    <label class="k"><span>Trigger level (CH1)</span><input id="s_lvl" type="range" min="-4" max="4" step="0.1" value="${SC.lvl}"></label>
    <label class="k"><span>Mode</span><select id="s_xy"><option value="0" ${SC.xy ? "" : "selected"}>Y–T</option><option value="1" ${SC.xy ? "selected" : ""}>X–Y</option></select></label>
    <label class="k"><span>&nbsp;</span><button id="s_auto">Autoset</button></label>`;
  const bind = (id, key, num = true) => { const e = $(id); if (!e) return; e.onchange = e.oninput = () => { SC[key] = num ? +e.value : e.value; if (key === "ref") scopeAuto(); drawScope(); }; };
  bind("s_v1", "v1"); bind("s_v2", "v2"); bind("s_p1", "p1"); bind("s_p2", "p2"); bind("s_c1", "c1", false); bind("s_c2", "c2", false); bind("s_td", "td"); bind("s_lvl", "lvl"); bind("s_ref", "ref", false);
  $("s_xy").onchange = () => { SC.xy = $("s_xy").value === "1"; drawScope(); };
  $("s_auto").onclick = () => { scopeAuto(); buildScope(); };
  drawScope();
}
function scopeData() { const i = S.res.instruments[SC.ref]; return i; }
function stats(t, y) {
  let mn = 1e30, mx = -1e30, s = 0, s2 = 0; const n = y.length; if (!n) return null;
  for (const v of y) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; s2 += v * v; }
  const mean = s / n, rms = Math.sqrt(s2 / n); const ups = [];
  for (let i = 1; i < n; i++) if (y[i - 1] < mean && y[i] >= mean) ups.push(t[i - 1] + (mean - y[i - 1]) / (y[i] - y[i - 1]) * (t[i] - t[i - 1]));
  const per = ups.length > 1 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : 0;
  return { mn, mx, vpp: mx - mn, mean, rms, per, f: per > 0 ? 1 / per : 0 };
}
function scopeAuto() {
  const i = scopeData(); if (!i) return;
  for (const [ch, vk, pk] of [["ch1", "v1", "p1"], ["ch2", "v2", "p2"]]) {
    const y = i[ch]; if (!y) continue; const s = stats(i.t, y); if (!s) continue; SC[vk] = snap125(Math.max(s.vpp, 1e-3) / 6); SC[pk] = Math.max(-3, Math.min(3, -Math.round(s.mean / SC[vk])));
  }
  const s1 = stats(i.t, i.ch1), s2 = stats(i.t, i.ch2 || []), per = (s1 && s1.per) || (s2 && s2.per);
  SC.td = snap125(per ? 3 * per / 10 : (i.t[i.t.length - 1] - i.t[0]) / 10); SC.lvl = 0; SC.c1 = SC.c2 = "DC"; SC.xy = false;
}
function drawScope() {
  if ($("pScope").hidden || $("scopeBox").hidden || bdCollapsed() || netMode) return; const i = scopeData(); if (!i) return;
  const c = $("scv"), [x, W, H] = setupCanvas(c); x.fillStyle = "#0b1410"; x.fillRect(0, 0, W, H);
  const m = 10, w = W - 2 * m, h = H - 2 * m, dx = w / 10, dy = h / 8;
  x.strokeStyle = "#1d3a2b"; x.lineWidth = 1; x.beginPath();
  for (let k = 0; k <= 10; k++) { x.moveTo(m + k * dx, m); x.lineTo(m + k * dx, m + h); } for (let k = 0; k <= 8; k++) { x.moveTo(m, m + k * dy); x.lineTo(m + w, m + k * dy); } x.stroke();
  x.strokeStyle = "#2b5a42"; x.beginPath(); x.moveTo(m + 5 * dx, m); x.lineTo(m + 5 * dx, m + h); x.moveTo(m, m + 4 * dy); x.lineTo(m + w, m + 4 * dy); x.stroke();
  const col = ["#e8c14a", "#5fe0d0"], T = i.t;
  const proc = (y, coup, vdiv, pos) => { if (!y) return null; let mean = 0; if (coup === "AC") { for (const v of y) mean += v; mean /= y.length; } return y.map((v) => coup === "GND" ? 0 : v - mean); };
  const y1 = proc(i.ch1, SC.c1), y2 = proc(i.ch2, SC.c2);
  x.save(); x.beginPath(); x.rect(m, m, w, h); x.clip();
  if (SC.xy && y1 && y2) {
    x.strokeStyle = col[0]; x.lineWidth = 1.6; x.beginPath();
    for (let k = 0; k < T.length; k++) { const px = m + w / 2 + (y1[k] / SC.v1 + SC.p1) * dx, py = m + h / 2 - (y2[k] / SC.v2 + SC.p2) * dy; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
  } else {
    // edge trigger on CH1 (rising), trigger point at the first division
    let t0 = T[0]; const lvl = SC.lvl * SC.v1;
    if (y1) { const need = 1 * SC.td, found = []; for (let k = 1; k < T.length; k++) if (y1[k - 1] < lvl && y1[k] >= lvl && T[k] - need >= T[0]) { found.push(k); if (found.length >= 1) break; } if (found.length) t0 = T[found[0]] - need; }
    [[y1, SC.v1, SC.p1, col[0]], [y2, SC.v2, SC.p2, col[1]]].forEach(([y, v, p, cl]) => {
      if (!y) return; x.strokeStyle = cl; x.lineWidth = 1.7; x.beginPath(); let st = false;
      for (let k = 0; k < T.length; k++) { const px = m + (T[k] - t0) / SC.td * dx; if (px < m - 2) continue; if (px > m + w + 2) break; const py = m + h / 2 - (y[k] / v + p) * dy; st ? x.lineTo(px, py) : (x.moveTo(px, py), st = true); } x.stroke();
      x.fillStyle = cl; const gy = m + h / 2 - p * dy; x.beginPath(); x.moveTo(m, gy - 5); x.lineTo(m + 8, gy); x.lineTo(m, gy + 5); x.fill();
    });
    const ty = m + h / 2 - SC.lvl * dy; x.fillStyle = "#e07a5f"; x.beginPath(); x.moveTo(m + w, ty - 5); x.lineTo(m + w - 8, ty); x.lineTo(m + w, ty + 5); x.fill();
  }
  x.restore(); x.fillStyle = "#6fae92"; x.font = "11px system-ui"; x.textAlign = "left";
  x.fillText(SC.xy ? `X ${fmt(SC.v1, "V")}/div   Y ${fmt(SC.v2, "V")}/div` : `${fmt(SC.td, "s")}/div`, m + 4, H - m - 4);
  // measurements over the visible window
  const mk = (y, vd) => { if (!y) return ""; const lo = SC.td * 0, s = stats(T, y); if (!s) return ""; return s; };
  const rows = [["CH1", i.ch1, col[0]], ["CH2", i.ch2, col[1]]].filter((r) => r[1]).map(([n, y, cl]) => {
    const s = stats(T, y); return `<div style="grid-column:1/-1;color:${cl}"><b>${n}</b></div><div><span>Vpp</span>${fmt(s.vpp, "V")}</div><div><span>Mean</span>${fmt(s.mean, "V")}</div><div><span>RMS</span>${fmt(s.rms, "V")}</div><div><span>Max</span>${fmt(s.mx, "V")}</div><div><span>Frequency</span>${s.f ? fmt(s.f, "Hz") : "—"}</div><div><span>Period</span>${s.per ? fmt(s.per, "s") : "—"}</div>`;
  });
  $("smeas").innerHTML = rows.join("");
}

/* ---------------------------------------------------------------- loading projects */
async function openExample(key, fromList) {
  setStatus("Loading", "busy");
  const o = JSON.parse(await call("load_example", key)); setProject(o.project, o.info, key);
  if (fromList) { openPage("exp"); fit(); toast(o.info.title); }
  renderExp(); run();
}
function setProject(proj, info, key) {
  S.proj = proj; S.proj.wires ||= []; S.proj.sim ||= {}; S.info = info || null; S.key = key || ""; S.sel = null; S.res = null; S.hist = []; S.fut = []; S.sigOn = {}; updHist();
  setTool(null); renderAll(); buildInfo(); buildPanels(); buildResults(); buildGraph(); buildScope(); updCtx(); fit();
  $("scopeNone").hidden = false; $("scopeBox").hidden = true;
}
$("bRun").onclick = run; $("bUndo").onclick = undo; $("bRedo").onclick = redo; $("bRot").onclick = () => rotSel(false); $("bMir").onclick = () => rotSel(true);
$("bDel").onclick = delSel; $("bWire").onclick = () => setTool(S.tool === "wire" ? null : "wire"); $("bFit").onclick = fit;
function toggleLive() { S.live = !S.live; $("bLive").classList.toggle("on", S.live); $("bLive").setAttribute("aria-pressed", S.live); toast(S.live ? "Live: results update as you change values" : "Live off"); if (S.live) run(); }
$("bLive").onclick = toggleLive;
$("bZin").onclick = () => zoomBy(1.3); $("bZout").onclick = () => zoomBy(1 / 1.3);
$("fOpen").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (netMode) { await NET.openFile(f); e.target.value = ""; return; }
  try { const o = JSON.parse(await f.text()); if (!o.components) throw new Error("not a circuit file"); for (const c of o.components) if (!S.defs[c.type]) throw new Error("unknown part " + c.type);
    setProject(o, { title: o.meta?.name || f.name, group: "Opened file", objective: "", steps: [], theory: "" }, ""); run(); }
  catch (err) { setStatus("Cannot open: " + err.message, "err"); }
  e.target.value = "";
};

/* ---------------------------------------------------------------- files, mode switch, full screen, offline */
function newCircuit() { setProject({ components: [], wires: [], meta: { name: "Untitled" }, sim: {} }, null, ""); toast("New circuit. Drag parts in from the palette."); }
function saveCircuit() { download((S.proj.meta?.name || "circuit").replace(/[^\w-]+/g, "_") + ".ecelab.json", JSON.stringify({ ...S.proj }, null, 1), "application/json"); }
function exportCsv() {
  const r = S.res; if (!r || !r.ok) { toast("Run the circuit first"); return; }
  const rows = ["name,value,unit"].concat((r.measurements || []).map((m) => `"${m.name}",${m.value},${m.unit || ""}`)); download("results.csv", rows.join("\n"), "text/csv");
}
const goFull = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); };
$("bFull").onclick = goFull; $("nFull").onclick = goFull;
document.addEventListener("fullscreenchange", () => setTimeout(() => { netMode ? window.NET && NET.fit() : fit(); drawGraph(); drawScope(); }, 150));
function setMode(m) {
  if (m !== "ard" && !S.ready) { toast("The analog engine is still loading. One moment."); return; }
  netMode = m === "net"; const ard = m === "ard"; $("app").dataset.mode = m;
  $("modeseg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $("workElec").hidden = m !== "elec"; $("workNet").hidden = !netMode; $("workArd").hidden = !ard; $("tbElec").hidden = m !== "elec"; $("tbNet").hidden = !netMode; $("app").classList.remove("showparts");
  for (const id of ["mFile", "mEx", "mEdit"]) $(id).hidden = ard;
  $("tip").textContent = ard ? "Circuits: 196 parts (131 ArduinoForge + 65 LEARNERS LAB), Arduino sketches and 400 Kit 1–8 projects. Use Examples, the parts panel and Start Simulation (F5)." : netMode ? "Select a block to edit it · connect tool links two blocks · wheel zoom · drag empty space to pan · Del delete" : "Click a pin, then another pin to wire · wheel zoom · drag empty space to pan · R rotate · Del delete";
  if (ard) { const f = $("ardFrame"); if (!f.getAttribute("src")) f.src = "circuits/index.html"; $("doctitle").textContent = "Circuits"; setStatus(S.ready ? "Ready" : "Loading simulation engine", S.ready ? "ok" : "busy"); }
  else if (netMode) { NET.enter(); } else { $("doctitle").textContent = S.proj.meta?.name || "Untitled"; updStatusbar(); setTimeout(() => { fit(); drawGraph(); drawScope(); }, 30); }
}
$("modeseg").onclick = (e) => { const b = e.target.closest("button"); if (b && b.dataset.m !== $("app").dataset.mode) setMode(b.dataset.m); };
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});

/* ---------------------------------------------------------------- boot */
(async () => {
  const qs = new URLSearchParams(location.search), startMode = qs.get("m") || (qs.get("ex") ? "elec" : "ard");
  try {
    if (startMode === "ard") { setMode("ard"); const f = $("ardFrame"); const rm = () => $("boot") && $("boot").remove(); f.addEventListener("load", rm, { once: true }); setTimeout(rm, 4000); }
    S.resVals = await (await fetch("res_values.json")).json();
    await call("boot", S.resVals);
    S.defs = JSON.parse(await call("part_defs")); S.examples = JSON.parse(await call("example_list"));
    buildLists(); if (window.NET) await NET.init(); if ($("boot")) $("boot").remove(); S.ready = true;
    const q = qs.get("ex");
    await openExample(q && S.examples.some((e) => e.key === q) ? q : "lg_cmos_not");
    openPage("exp");
    if (startMode === "net") setMode("net"); else if (startMode === "ard") setStatus("ArduinoForge", "ok"); else setMode("elec");
    if (startMode === "ard") { $("doctitle").textContent = "Circuits"; }
  } catch (err) { const m = "Could not start: " + (err.message || err); if ($("boottext")) $("boottext").textContent = m; else setStatus(m.slice(0, 160), "err"); console.error(m); }
})();
