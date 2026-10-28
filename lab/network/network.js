"use strict";
/* LEARNERS LAB — Networks. Topology editor, packet replay and result tables on the Python network engine (Pyodide). */
const $ = (id) => document.getElementById(id);
const html = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------------------------------------------------------- engine worker */
const worker = new Worker("worker.js");
let seq = 0; const pending = new Map();
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "progress") { $("bootbar").style.width = m.pct + "%"; $("boottext").textContent = m.text; return; }
  const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
  m.ok ? p.res(m.value) : p.rej(new Error(m.error));
};
worker.onerror = (e) => { $("boottext").textContent = "The engine could not start: " + (e.message || "unknown error"); };
const call = (fn, ...args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); worker.postMessage({ id, fn, args }); });

/* ---------------------------------------------------------------- small helpers */
function setStatus(t, cls = "") { const e = $("status"); e.textContent = t; e.className = "st " + cls; $("sdot").className = "sdot " + cls; }
let toastTimer = 0;
function toast(t, ms = 2400) { const e = $("toast"); e.textContent = t; e.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove("show"), ms); }
function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function makeSplitter(grip, dock, center) {
  let d = null;
  grip.addEventListener("pointerdown", (e) => { d = { y: e.clientY, h: dock.getBoundingClientRect().height }; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", (e) => { if (!d) return; const max = center.getBoundingClientRect().height - 160; dock.classList.remove("collapsed"); dock.style.height = Math.max(80, Math.min(max, d.h + d.y - e.clientY)) + "px"; });
  const up = () => { if (d) { d = null; window.dispatchEvent(new Event("resize")); } };
  grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
}

/* drop-down menus */
const menuEl = $("menu");
function showMenu(anchor, items) {
  menuEl.innerHTML = "";
  for (const it of items) {
    if (it.sep) { menuEl.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button"); b.disabled = !!it.d;
    b.innerHTML = `<span>${html(it.t)}</span>${it.k ? `<span class="k">${html(it.k)}</span>` : ""}`;
    b.onclick = () => { menuEl.hidden = true; it.f && it.f(); }; menuEl.appendChild(b);
  }
  const r = anchor.getBoundingClientRect(); menuEl.hidden = false; menuEl.style.left = Math.min(r.left, innerWidth - 230) + "px"; menuEl.style.top = r.bottom + 4 + "px";
}
document.addEventListener("pointerdown", (e) => {
  if (!menuEl.hidden && !e.target.closest("#menu") && !e.target.closest(".rb")) menuEl.hidden = true;
  const m = $("exMenu"); if (!m.hidden && !e.target.closest("#exMenu") && !e.target.closest("#mEx")) m.hidden = true;
});

/* theme */
function applyTheme(t) { document.documentElement.dataset.theme = t; document.querySelector('meta[name="theme-color"]').content = t === "dark" ? "#1f2226" : "#ffffff"; $("bTheme").innerHTML = `<svg class="ic sm"><use href="#i-${t === "dark" ? "sun" : "moon"}"/></svg>`; try { localStorage.setItem("ll-theme", t); } catch (e) { /* ignore */ } }
$("bTheme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
try { applyTheme(localStorage.getItem("ll-theme") === "dark" ? "dark" : "light"); } catch (e) { applyTheme("light"); }

/* help */
function modal(h) { $("modalBody").innerHTML = h; $("modal").hidden = false; }
$("modalClose").onclick = () => ($("modal").hidden = true); $("modal").addEventListener("pointerdown", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });
$("mHelp").onclick = () => modal(`<h3>Networks</h3><p>Add blocks from the palette and join them with the connect tool (<kbd>L</kbd>). Select a block to set its address, gateway, routes, VLANs and applications in Properties. Press <b>Run</b> and the packets replay on the canvas; open Packet capture for every frame.</p><p><kbd>Ctrl</kbd>+<kbd>Enter</kbd> run · <kbd>Space</kbd> play or pause · <kbd>L</kbd> connect · <kbd>Del</kbd> delete · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo or redo · wheel zooms · drag empty space to pan.</p>`);

/* examples */
let expFilter = "All";
function chipRow(box, items, cur, onPick) { box.innerHTML = ""; for (const it of items) { const b = document.createElement("button"); b.textContent = it; if (it === cur) b.className = "on"; b.onclick = () => onPick(it); box.appendChild(b); } }
function renderExp() {
  const items = NET.examples, groups = [...new Set(items.map((e) => e.group))];
  chipRow($("expChips"), ["All", ...groups], expFilter, (g) => { expFilter = g; renderExp(); });
  const q = $("expSearch").value.trim().toLowerCase(), box = $("expList"); box.innerHTML = ""; let last = "", n = 0;
  for (const e of items) {
    if (expFilter !== "All" && e.group !== expFilter) continue; if (q && !(e.title + " " + e.group).toLowerCase().includes(q)) continue;
    if (e.group !== last) { const h = document.createElement("h4"); h.textContent = e.group; box.appendChild(h); }
    last = e.group; n++;
    const b = document.createElement("button"); b.className = "card" + (e.key === NET.key ? " on" : ""); b.dataset.key = e.key; b.innerHTML = `<span class="tx"><b>${html(e.title)}</b></span>`; box.appendChild(b);
  }
  if (!n) box.innerHTML = '<div class="empty">No experiments match.</div>';
}
$("mEx").onclick = (e) => { const m = $("exMenu"); if (!m.hidden) { m.hidden = true; return; } renderExp(); const r = e.currentTarget.getBoundingClientRect(); m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + "px"; m.style.top = r.bottom + 4 + "px"; m.hidden = false; $("expSearch").focus(); };
$("expSearch").addEventListener("input", renderExp);
$("expList").onclick = (e) => { const b = e.target.closest(".card"); if (b) { $("exMenu").hidden = true; openNetExample(b.dataset.key); } };

/* full screen */
const goFull = () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); };
$("nFull").onclick = goFull;
document.addEventListener("fullscreenchange", () => setTimeout(() => window.dispatchEvent(new Event("resize")), 150));

/* LEARNERS LAB — network workspace (browser edition). Topology editor, packet replay and result tables on top of the Python network engine. */
(() => {
  const $ = (id) => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NET = (window.NET = { examples: [], key: "" });
  const N = { types: {}, defaults: {}, help: {}, multiline: [], probes: {}, proj: null, info: null, sel: null, tool: "sel", linkFrom: null, res: null, view: { x: 0, y: 0, k: 1 },
    hist: [], fut: [], pb: null, mouse: { x: 0, y: 0 }, busy: false, dragging: null, capFilter: "", pid: null, rtab: "prop" };
  const KIND_COL = { arp: "#d1953b", learn: "#6fb5ad", flood: "#c98a55", fwd: "#7fa7c9", filter: "#9aa3ad", route: "#7fa7c9", fw: "#d46a63", drop: "#d46a63", ttl: "#d46a63", tcp: "#b9a46a", app: "#7fb58a", rx: "#c3c8cf" };
  const KIND_NAME = { arp: "ARP", learn: "learn", flood: "flood", fwd: "forward", filter: "filter", route: "route", fw: "firewall", drop: "DROP", ttl: "TTL", tcp: "TCP", app: "app", rx: "receive" };
  const PROTO_COL = { ARP: "#b7791f", ICMP: "#2e7d5b", TCP: "#2b6aa8", UDP: "#a45a5a", DNS: "#3b8f96", DHCP: "#6b7280" };
  const BW = 92, BH = 70;
  const fmtT = (t) => (t >= 1 ? t.toFixed(3) + " s" : t >= 1e-3 ? (t * 1e3).toFixed(3) + " ms" : (t * 1e6).toFixed(1) + " µs");
  const flightColour = (label, proto) => (label.startsWith("DNS") ? PROTO_COL.DNS : ["DISCOVER", "OFFER", "REQUEST", "ACK"].includes(label) && proto === "UDP" ? PROTO_COL.DHCP : PROTO_COL[proto] || "#94a3b8");
  const bisectRight = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };
  const bisectLeft = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
  const nid = (p, list) => { let k = 1; const used = new Set(list.map((x) => x.id)); while (used.has(p + k)) k++; return p + k; };
  const nodeById = (id) => N.proj.nodes.find((n) => n.id === id);
  const nodeByName = (nm) => N.proj.nodes.find((n) => n.name === nm);
  const linkById = (id) => N.proj.links.find((l) => l.id === id);
  const portOf = (nodeId, linkId) => { let k = 0; for (const l of N.proj.links) if (l.a === nodeId || l.b === nodeId) { k++; if (l.id === linkId) return k; } return 0; };
  const nodeIp = (n) => {
    if (n.type === "host" || n.type === "server") return (n.params.ip || "").split("/")[0].trim() || null;
    if (n.type === "router" || n.type === "firewall") for (const ln of (n.params.ips || "").split("\n")) { const m = ln.match(/^\s*p\d+\s*=\s*([\d.]+)(?:\/\d+)?\s*$/); if (m) return m[1]; }
    return null;
  };
  const world = $("nworld"), gLinks = $("nlinks"), gNodes = $("nnodes"), gFly = $("nfly"), cv = $("ncv");

  /* ------------------------------------------------------------------ history */
  const snap = () => JSON.stringify({ nodes: N.proj.nodes, links: N.proj.links });
  function pushHist() { N.hist.push(snap()); if (N.hist.length > 100) N.hist.shift(); N.fut = []; updHist(); }
  function restore(s) { const o = JSON.parse(s); N.proj.nodes = o.nodes; N.proj.links = o.links; N.sel = null; invalidate(); renderAll(); buildProps(); }
  function undo() { if (!N.hist.length) return; N.fut.push(snap()); restore(N.hist.pop()); updHist(); }
  function redo() { if (!N.fut.length) return; N.hist.push(snap()); restore(N.fut.pop()); updHist(); }
  function updHist() { $("nUndo").disabled = !N.hist.length; $("nRedo").disabled = !N.fut.length; $("nDel").disabled = !N.sel; }
  function invalidate() { /* a topology change makes the replay stale but keeps the tables for reading */ fillSelects(); updStatus(); }

  /* ------------------------------------------------------------------ view */
  function applyView() { const v = N.view; world.setAttribute("transform", `translate(${v.x},${v.y}) scale(${v.k})`); $("ngrid").setAttribute("patternTransform", `translate(${v.x},${v.y}) scale(${v.k})`); $("nZoom").textContent = Math.round(v.k * 100) + "%"; }
  const toWorld = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - N.view.x) / N.view.k, y: (e.clientY - r.top - N.view.y) / N.view.k }; };
  function fit() {
    const r = cv.getBoundingClientRect(); const ns = N.proj ? N.proj.nodes : [];
    if (!ns.length || !r.width) { N.view = { x: r.width / 2, y: r.height / 2, k: 1 }; applyView(); return; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const n of ns) { x0 = Math.min(x0, n.x - BW / 2); y0 = Math.min(y0, n.y - BH / 2 - 30); x1 = Math.max(x1, n.x + BW / 2); y1 = Math.max(y1, n.y + BH / 2); }
    const m = 40, bot = 56, k = Math.min(1.3, (r.width - 2 * m) / (x1 - x0), (r.height - 2 * m - bot) / (y1 - y0));
    N.view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - bot - (y1 - y0) * k) / 2 - y0 * k }; applyView();
  }
  NET.fit = fit;
  function zoomBy(f) { const r = cv.getBoundingClientRect(), v = N.view, k = Math.min(3, Math.max(0.2, v.k * f)), mx = r.width / 2, my = r.height / 2; v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; applyView(); }
  cv.addEventListener("wheel", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(), v = N.view, k = Math.min(3, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.0015))), mx = e.clientX - r.left, my = e.clientY - r.top; v.x = mx - (mx - v.x) * (k / v.k); v.y = my - (my - v.y) * (k / v.k); v.k = k; applyView(); }, { passive: false });

  /* ------------------------------------------------------------------ drawing */
  const sub = (n) => (n.type === "host" || n.type === "server" ? nodeIp(n) || (/dhcp/.test(n.params.apps || "") ? "DHCP" : "") : n.type === "router" || n.type === "firewall" ? nodeIp(n) || "" : n.type === "ap" ? n.params.ssid || "" : "");
  const posOf = () => Object.fromEntries(N.proj.nodes.map((n) => [n.name, { x: n.x, y: n.y }]));
  function renderAll() { drawLinks(); drawNodes(); drawFly(); updStatus(); $("doctitle").textContent = N.proj ? N.proj.name || "Untitled network" : ""; }
  function drawLinks() {
    gLinks.innerHTML = ""; const util = {}; if (N.res) for (const l of N.res.links || []) util[l.link] = Math.max(l.util_ab || 0, l.util_ba || 0);
    for (const l of N.proj.links) {
      const a = nodeById(l.a), b = nodeById(l.b); if (!a || !b) continue; const sel = N.sel && N.sel.kind === "l" && N.sel.id === l.id;
      const u = util[`${a.name}-${b.name}`] ?? util[`${b.name}-${a.name}`];
      const col = u === undefined ? "" : `hsl(${Math.round(140 - 140 * Math.min(1, u))},55%,52%)`;
      mk("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "nlink" + (l.wireless ? " wl" : "") + (sel ? " sel" : ""), style: col && !sel ? `stroke:${col};stroke-width:${3 + 4 * Math.min(1, u)}` : "" }, gLinks);
      mk("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "nlinkhit", "data-l": l.id }, gLinks);
      const t = mk("text", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 7, class: "nlabel" }, gLinks);
      t.textContent = `${l.mbps} Mb/s · ${l.delay_ms} ms` + (l.loss ? ` · ${l.loss}% loss` : "") + (u !== undefined ? ` · ${(u * 100).toFixed(0)}% used` : "");
    }
  }
  function drawNodes() {
    gNodes.innerHTML = "";
    for (const n of N.proj.nodes) {
      const sel = N.sel && N.sel.kind === "n" && N.sel.id === n.id, g = mk("g", { class: "nnode" + (sel ? " sel" : ""), "data-n": n.id, transform: `translate(${n.x},${n.y})` }, gNodes);
      mk("rect", { x: -BW / 2, y: -BH / 2, width: BW, height: BH, rx: 10, class: "nbox" }, g);
      const u = mk("use", { href: `#n-${n.type}`, x: -17, y: -31, width: 34, height: 34, class: "gl" }, g);
      const t1 = mk("text", { x: 0, y: 15, class: "nname" }, g); t1.textContent = n.name;
      const t2 = mk("text", { x: 0, y: 28, class: "nsub" }, g); t2.textContent = sub(n);
      if (N.linkFrom === n.id) mk("rect", { x: -BW / 2 - 4, y: -BH / 2 - 4, width: BW + 8, height: BH + 8, rx: 13, fill: "none", stroke: "var(--ok)", "stroke-width": 2.5, "stroke-dasharray": "5 3" }, g);
    }
  }

  /* ------------------------------------------------------------------ pointer interaction */
  cv.addEventListener("pointerdown", (e) => {
    cv.focus(); cv.setPointerCapture(e.pointerId); const w = toWorld(e); N.mouse = w; const ng = e.target.closest && e.target.closest(".nnode");
    if (ng) {
      const id = ng.dataset.n;
      if (N.tool === "link") { linkClick(id); return; }
      select({ kind: "n", id }); const n = nodeById(id); N.dragging = { type: "move", id, sx: w.x, sy: w.y, ox: n.x, oy: n.y, moved: false, pre: snap() }; return;
    }
    const lh = e.target.dataset && e.target.dataset.l; if (lh) { select({ kind: "l", id: lh }); return; }
    if (N.linkFrom) { N.linkFrom = null; renderAll(); return; }
    select(null); N.dragging = { type: "pan", sx: e.clientX, sy: e.clientY, vx: N.view.x, vy: N.view.y }; cv.classList.add("pan");
  });
  cv.addEventListener("pointermove", (e) => {
    const w = toWorld(e); N.mouse = w; const d = N.dragging; $("coords").textContent = `x ${Math.round(w.x)} y ${Math.round(w.y)}`;
    if (!d) return;
    if (d.type === "pan") { N.view.x = d.vx + e.clientX - d.sx; N.view.y = d.vy + e.clientY - d.sy; applyView(); }
    else if (d.type === "move") { const n = nodeById(d.id); const nx = Math.round((d.ox + w.x - d.sx) / 10) * 10, ny = Math.round((d.oy + w.y - d.sy) / 10) * 10; if (nx !== n.x || ny !== n.y) { n.x = nx; n.y = ny; d.moved = true; renderAll(); } }
  });
  const endPtr = () => { const d = N.dragging; N.dragging = null; cv.classList.remove("pan"); if (d && d.type === "move" && d.moved) { N.hist.push(d.pre); N.fut = []; updHist(); } };
  cv.addEventListener("pointerup", endPtr); cv.addEventListener("pointercancel", endPtr);
  cv.addEventListener("contextmenu", (e) => { e.preventDefault(); setTool("sel"); });
  function linkClick(id) {
    if (!N.linkFrom) { N.linkFrom = id; hint("Click the second block to connect (Esc cancels)"); renderAll(); return; }
    const a = N.linkFrom; N.linkFrom = null; hint("");
    if (a === id) { renderAll(); return; }
    const A = nodeById(a), B = nodeById(id);
    for (const n of [A, B]) if ((n.type === "host" || n.type === "server") && N.proj.links.some((l) => l.a === n.id || l.b === n.id)) { toast(`${n.name} has a single network interface and is already linked`); renderAll(); return; }
    pushHist(); const l = { id: nid("l", N.proj.links), a, b: id, mbps: 100, delay_ms: 1, loss: 0, queue: 100, wireless: A.type === "ap" || B.type === "ap" };
    N.proj.links.push(l); select({ kind: "l", id: l.id }); invalidate(); renderAll();
  }
  function select(s) { N.sel = s; renderAll(); buildProps(); buildState(); updHist(); if (s) showRTab("prop"); }
  function setTool(t) {
    N.tool = t; N.linkFrom = null; $("nSel").classList.toggle("on", t === "sel"); $("nLink").classList.toggle("on", t === "link"); cv.setAttribute("class", t === "link" ? "wiring" : "");
    hint(t === "link" ? "Connect tool: click a block, then another block" : ""); renderAll();
  }
  const hint = (t) => ($("nhint").textContent = t || "");
  function addNode(type, x, y) {
    pushHist(); const pre = (N.types[type] || [type, "B"]).short || "B"; const names = new Set(N.proj.nodes.map((n) => n.name)); let k = 1; while (names.has(pre + k)) k++;
    const n = { id: nid("n", N.proj.nodes), type, name: pre + k, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, params: { ...(N.defaults[type] || {}) } };
    N.proj.nodes.push(n); select({ kind: "n", id: n.id }); invalidate(); renderAll(); toast(`Added ${n.name}`);
  }
  function addCenter(type) { const r = cv.getBoundingClientRect(), v = N.view; addNode(type, (r.width / 2 - v.x) / v.k + (Math.random() - 0.5) * 60, (r.height / 2 - v.y) / v.k + (Math.random() - 0.5) * 60); }
  function delSel() {
    if (!N.sel) return; pushHist();
    if (N.sel.kind === "l") N.proj.links = N.proj.links.filter((l) => l.id !== N.sel.id);
    else { const id = N.sel.id; N.proj.nodes = N.proj.nodes.filter((n) => n.id !== id); N.proj.links = N.proj.links.filter((l) => l.a !== id && l.b !== id); }
    N.sel = null; invalidate(); renderAll(); buildProps(); updHist();
  }
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "select" || tag === "textarea") return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); } else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === "enter") { e.preventDefault(); run(); }
    else if (k === "delete" || k === "backspace") { e.preventDefault(); delSel(); } else if (k === "l") setTool(N.tool === "link" ? "sel" : "link");
    else if (k === "escape") { setTool("sel"); select(null); } else if (k === "home") fit(); else if (k === " ") { e.preventDefault(); PB.toggle(); }
  });

  /* ------------------------------------------------------------------ properties */
  function showRTab(t) {
    N.rtab = t; document.querySelectorAll("#nrtabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    $("nProp").hidden = t !== "prop"; $("nAbout").hidden = t !== "about"; $("nState").hidden = t !== "state"; if (t === "state") buildState();
  }
  $("nrtabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showRTab(b.dataset.t); });
  function field(label, el, help) { const r = document.createElement("label"); r.className = "row p"; const s = document.createElement("span"); s.textContent = label; r.appendChild(s); r.appendChild(el); if (help) el.title = help; return r; }
  function buildProps() {
    const p = $("nProp"); p.innerHTML = ""; const s = N.sel;
    if (!s) {
      p.innerHTML = `<h3>Network</h3><p class="mute">${N.proj.nodes.length} blocks · ${N.proj.links.length} links</p><p class="mute">Select a block or a link to edit it. Add blocks from the palette, then use the connect tool.</p>`;
      const nm = document.createElement("input"); nm.type = "text"; nm.value = N.proj.name || ""; nm.onchange = () => { N.proj.name = nm.value; $("doctitle").textContent = nm.value; }; p.appendChild(field("Name", nm));
      const sd = document.createElement("input"); sd.type = "number"; sd.value = (N.proj.sim && N.proj.sim.seed) ?? 1; sd.onchange = () => { N.proj.sim = { ...(N.proj.sim || {}), seed: +sd.value }; }; p.appendChild(field("Random seed", sd, "Loss and jitter use this seed so runs are repeatable"));
      return;
    }
    if (s.kind === "l") {
      const l = linkById(s.id); if (!l) return; const a = nodeById(l.a), b = nodeById(l.b);
      p.innerHTML = `<h3>Link ${esc(a.name)} – ${esc(b.name)}</h3><p class="mute">${esc(a.name)}.p${portOf(a.id, l.id)} ↔ ${esc(b.name)}.p${portOf(b.id, l.id)}</p>`;
      for (const [key, lab, step] of [["mbps", "Rate (Mb/s)", 1], ["delay_ms", "Delay (ms)", 0.1], ["loss", "Loss (%)", 0.1], ["queue", "Queue (packets)", 1]]) {
        const i = document.createElement("input"); i.type = "number"; i.step = step; i.min = 0; i.value = l[key]; i.onchange = () => { pushHist(); l[key] = +i.value; renderAll(); }; p.appendChild(field(lab, i));
      }
      const w = document.createElement("input"); w.type = "checkbox"; w.checked = !!l.wireless; w.onchange = () => { pushHist(); l.wireless = w.checked; renderAll(); }; p.appendChild(field("Wireless", w));
      const d = document.createElement("button"); d.className = "btn block danger"; d.textContent = "Delete link"; d.onclick = delSel; p.appendChild(d); return;
    }
    const n = nodeById(s.id); if (!n) return;
    p.innerHTML = `<h3>${esc(n.name)}</h3><p class="mute">${esc((N.types[n.type] || {}).name || n.type)}</p>`;
    const nm = document.createElement("input"); nm.type = "text"; nm.value = n.name; nm.onchange = () => { const v = nm.value.trim(); if (!v || N.proj.nodes.some((x) => x !== n && x.name === v)) { nm.value = n.name; toast("Names must be unique"); return; } pushHist(); n.name = v; renderAll(); buildProps(); }; p.appendChild(field("Name", nm));
    for (const k in (N.defaults[n.type] || {})) {
      let el; const ml = N.multiline.includes(k);
      if (ml) { el = document.createElement("textarea"); el.rows = 4; } else if (k === "policy") { el = document.createElement("select"); for (const o of ["allow", "deny"]) { const op = document.createElement("option"); op.textContent = op.value = o; if (n.params[k] === o) op.selected = true; el.appendChild(op); } } else { el = document.createElement("input"); el.type = "text"; }
      if (el.tagName !== "SELECT") el.value = n.params[k] ?? ""; else el.value = n.params[k] || "allow";
      el.onchange = () => { pushHist(); n.params[k] = el.value; renderAll(); invalidate(); }; p.appendChild(field(k, el, N.help[k]));
      if (N.help[k]) { const h = document.createElement("div"); h.className = "mute"; h.style.cssText = "font-size:11.5px;margin:-2px 0 6px 0;white-space:pre-line"; h.textContent = N.help[k]; p.appendChild(h); }
    }
    const ports = N.proj.links.filter((l) => l.a === n.id || l.b === n.id);
    if (ports.length) { const h = document.createElement("h5"); h.textContent = "Ports"; p.appendChild(h); const ul = document.createElement("ul"); ul.className = "plist"; for (const l of ports) { const o = nodeById(l.a === n.id ? l.b : l.a); ul.insertAdjacentHTML("beforeend", `<li><span>p${portOf(n.id, l.id)}</span><span class="mute">to ${esc(o.name)}</span></li>`); } p.appendChild(ul); }
    const d = document.createElement("button"); d.className = "btn block danger"; d.textContent = "Delete block"; d.onclick = delSel; p.appendChild(d);
  }
  function buildAbout() {
    const i = N.info, p = $("nAbout"); if (!i) { p.innerHTML = '<p class="empty">Open a network from the Examples menu to read its notes.</p>'; return; }
    let h = `<h3>${esc(i.title)}</h3><div class="mute">${esc(i.group)}</div>`;
    if (i.objective) h += `<h5>Objective</h5><p>${esc(i.objective)}</p>`; if (i.steps && i.steps.length) h += `<h5>Procedure</h5><ol>${i.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`;
    if (i.theory) h += `<h5>Theory</h5><p>${esc(i.theory)}</p>`; p.innerHTML = h;
  }
  function buildState() {
    const p = $("nState"); const s = N.sel;
    if (!s || s.kind !== "n") { p.innerHTML = '<p class="empty">Select a block to see its ARP cache and MAC table at the replay time.</p>'; return; }
    const n = nodeById(s.id); const st = stateAt(n.name, PB.t);
    const rows = (o, a, b) => Object.keys(o).length ? `<table class="t"><thead><tr><th>${a}</th><th>${b}</th></tr></thead><tbody>${Object.entries(o).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>` : '<p class="mute">empty</p>';
    p.innerHTML = `<h3>${esc(n.name)} at ${fmtT(PB.t)}</h3><h5>ARP cache</h5>${rows(st.arp, "IP", "MAC")}<h5>MAC table</h5>${rows(Object.fromEntries(Object.entries(st.mac).map(([k, v]) => [k, v])), "VLAN / MAC", "Port")}`;
  }

  /* ------------------------------------------------------------------ playback */
  const SPEEDS = [["Auto", 0], ["1 s/s", 1], ["100 ms/s", 0.1], ["10 ms/s", 0.01], ["1 ms/s", 1e-3], ["100 µs/s", 1e-4], ["10 µs/s", 1e-5], ["1 µs/s", 1e-6]];
  const PB = { loaded: false, flights: [], starts: [], maxend: [], arrivals: [], events: [], evT: [], drops: [], dropT: [], tables: {}, duration: 1, t: 0, speed: 1e-3, auto: true, playing: false, last: 0, narrN: -1, raf: 0 };
  PB.clear = () => { PB.playing = false; cancelAnimationFrame(PB.raf); PB.loaded = false; PB.flights = []; PB.starts = []; PB.maxend = []; PB.arrivals = []; PB.events = []; PB.evT = []; PB.drops = []; PB.dropT = []; PB.tables = {}; PB.t = 0; PB.narrN = -1; setPlayIcon(); };
  PB.load = (res) => {
    PB.clear(); PB.duration = +res.duration || 1;
    const fl = (res.capture || []).map((c, k) => ({ i: k, a: c.src, b: c.dst, t0: c.sent_at, t1: Math.max(c.t, c.sent_at + 1e-9), label: c.label || "", proto: c.proto, link: c.link, pid: c.pid, layers: c.layers || [], summary: c.summary, bytes: c.bytes, flow: c.flow || "", col: flightColour(c.label || "", c.proto) }));
    fl.sort((x, y) => x.t0 - y.t0); PB.flights = fl; PB.starts = fl.map((f) => f.t0); let m = 0; PB.maxend = fl.map((f) => (m = Math.max(m, f.t1)));
    PB.arrivals = fl.map((f) => f.t1).sort((x, y) => x - y); PB.events = [...(res.log || [])].sort((x, y) => x.t - y.t); PB.evT = PB.events.map((e) => e.t);
    PB.drops = [...(res.drops || [])].sort((x, y) => x.t - y.t); PB.dropT = PB.drops.map((d) => d.t); PB.tables = {};
    for (const e of PB.events) if (e.table) (PB.tables[e.node] ||= []).push(e);
    PB.loaded = true; PB.auto = $("pSpeed").value === "0"; PB.speed = PB.autoSpeed(); PB.t = 0; setTime(0);
  };
  PB.autoSpeed = () => { const d = PB.flights.map((f) => f.t1 - f.t0).sort((a, b) => a - b); if (!d.length) return 1e-3; const med = d[d.length >> 1], target = d.length < 400 ? 1.0 : 0.4; return Math.min(Math.max(med / target, 1e-6), 1.0); };
  PB.win = () => Math.max(0.7 * PB.speed, 1e-9);
  PB.activeUntil = (t) => { const i = bisectRight(PB.starts, t) - 1; return i >= 0 ? PB.maxend[i] : -1; };
  PB.active = (t = PB.t) => { let i = bisectRight(PB.starts, t) - 1; const out = []; while (i >= 0 && PB.maxend[i] >= t) { const f = PB.flights[i]; if (f.t1 >= t) out.push(f); i--; if (out.length > 400) break; } return out; };
  PB.arrived = (win) => { const t = PB.t; let i = bisectRight(PB.starts, t) - 1; const out = []; while (i >= 0 && PB.maxend[i] >= t - win) { const f = PB.flights[i]; if (t - win <= f.t1 && f.t1 <= t) out.push(f); i--; if (out.length > 300) break; } return out; };
  PB.play = () => { if (!PB.loaded) return; if (PB.t >= PB.duration - 1e-12) PB.t = 0; PB.playing = true; PB.last = performance.now(); setPlayIcon(); PB.raf = requestAnimationFrame(tick); };
  PB.pause = () => { PB.playing = false; cancelAnimationFrame(PB.raf); setPlayIcon(); };
  PB.toggle = () => (PB.playing ? PB.pause() : PB.play());
  PB.step = (dir) => {
    PB.pause(); const eps = Math.max(PB.win() * 0.02, 1e-9);
    if (dir > 0) { const i = bisectRight(PB.arrivals, PB.t + eps); setTime(i < PB.arrivals.length ? PB.arrivals[i] : PB.duration); }
    else { const i = bisectLeft(PB.arrivals, PB.t - eps) - 1; setTime(i >= 0 ? PB.arrivals[i] : 0); }
  };
  function tick(now) {
    if (!PB.playing) return; const dt = Math.min((now - PB.last) / 1000, 0.2); PB.last = now; let t = PB.t + dt * PB.speed;
    if ($("pSkip").checked) {
      const pad = PB.win();
      if (PB.activeUntil(t) + pad < t) { const j = bisectRight(PB.starts, t), nxt = j < PB.starts.length ? PB.starts[j] : null, ev = bisectRight(PB.evT, t), nev = ev < PB.evT.length ? PB.evT[ev] : null; const c = [nxt, nev].filter((x) => x !== null); if (c.length && Math.min(...c) - t > pad) t = Math.min(...c) - pad * 0.3; }
    }
    if (t >= PB.duration) { setTime(PB.duration); PB.pause(); return; }
    setTime(t); PB.raf = requestAnimationFrame(tick);
  }
  function setPlayIcon() { $("pPlay").innerHTML = `<svg class="ic sm"><use href="#i-${PB.playing ? "pause" : "play"}"/></svg>`; }
  function setTime(t) {
    PB.t = Math.min(Math.max(t, 0), PB.duration); $("pTime").value = Math.round(10000 * PB.t / Math.max(PB.duration, 1e-12));
    const sp = PB.speed; $("pClock").textContent = PB.loaded ? fmtT(PB.t) : "—"; $("pClock").title = `${fmtT(PB.t)} of ${PB.duration} s · ${sp < 1e-3 ? (sp * 1e6).toPrecision(2) + " µs/s" : sp < 1 ? (sp * 1e3).toPrecision(2) + " ms/s" : sp + " s/s"}`;
    drawFly(); const n = bisectRight(PB.evT, PB.t); if (n !== PB.narrN) { PB.narrN = n; buildNarr(); if (N.rtab === "state") buildState(); }
  }
  function stateAt(node, t) { const mac = {}, arp = {}; for (const e of PB.tables[node] || []) { if (e.t > t) break; if (e.table === "mac") mac[`VLAN ${e.vlan} · ${e.mac}`] = e.port; else arp[e.ip] = e.mac; } return { mac, arp }; }
  $("pPlay").onclick = () => PB.toggle(); $("pPrev").onclick = () => { PB.pause(); setTime(0); }; $("pNext").onclick = () => PB.step(1);
  $("pTime").oninput = () => { if (PB.loaded) setTime(PB.duration * $("pTime").value / 10000); };
  $("pSpeed").innerHTML = SPEEDS.map(([l, v]) => `<option value="${v}">${l}</option>`).join("");
  $("pSpeed").onchange = () => { const v = +$("pSpeed").value; PB.auto = v === 0; PB.speed = v === 0 ? (PB.loaded ? PB.autoSpeed() : PB.speed) : v; setTime(PB.t); };

  function drawFly() {
    gFly.innerHTML = ""; if (!N.proj) return; if (!PB.loaded) return; const pos = posOf(), win = PB.win();
    for (const f of PB.arrived(win)) { const c = pos[f.b]; if (!c) continue; const age = (PB.t - f.t1) / win, r = 40 + 24 * age; mk("rect", { x: c.x - r * 1.15, y: c.y - r * 0.8, width: r * 2.3, height: r * 1.6, rx: 14, class: "pulse", stroke: f.col, opacity: Math.max(0, 0.8 * (1 - age)) }, gFly); }
    const act = PB.active(); const wide = act.length <= 10 ? 36 : act.length <= 24 ? 28 : 12; let shown = 0;
    for (const f of act) {
      const a = pos[f.a], b = pos[f.b]; if (!a || !b) continue; const fr = Math.min(Math.max((PB.t - f.t0) / Math.max(f.t1 - f.t0, 1e-12), 0), 1);
      const dx = b.x - a.x, dy = b.y - a.y, ln = Math.hypot(dx, dy) || 1, off = f.a < f.b ? 7 : -7, x = a.x + dx * fr - dy / ln * off, y = a.y + dy * fr + dx / ln * off, w = shown < 40 ? wide : 12, sel = f.pid !== null && f.pid === N.pid;
      const g = mk("g", { "data-pid": f.pid }, gFly); mk("rect", { x: x - w / 2, y: y - 8, width: w, height: 16, rx: 5, fill: f.col, class: "fly", stroke: sel ? "#fff" : "#0008", "stroke-width": sel ? 2.4 : 1 }, g);
      if (shown < 40) { const t = mk("text", { x, y: y + 3, class: "flytx", fill: "#fff" }, g); t.textContent = f.label.slice(0, 6); } shown++;
    }
    for (const d of PB.drops.slice(bisectLeft(PB.dropT, PB.t - win), bisectRight(PB.dropT, PB.t))) {
      const c = pos[d.where] || (() => { const l = N.proj.links.find((x) => { const A = nodeById(x.a), B = nodeById(x.b); return A && B && (`${A.name}-${B.name}` === d.where || `${B.name}-${A.name}` === d.where); }); if (!l) return null; const A = nodeById(l.a), B = nodeById(l.b); return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; })();
      if (!c) continue; const age = (PB.t - d.t) / win; const g = mk("g", { opacity: 1 - 0.7 * age }, gFly); mk("circle", { cx: c.x, cy: c.y, r: 13, fill: "#fff", stroke: "#c0453d", "stroke-width": 3 }, g); mk("path", { d: `M${c.x - 6},${c.y - 6}L${c.x + 6},${c.y + 6}M${c.x - 6},${c.y + 6}L${c.x + 6},${c.y - 6}`, stroke: "#c0453d", "stroke-width": 3, "stroke-linecap": "round" }, g);
    }
    const cap = {}; const j = bisectRight(PB.evT, PB.t), i = bisectLeft(PB.evT, PB.t - win * 1.6); for (const e of PB.events.slice(i, j)) cap[e.node] = e;
    for (const nm in cap) {
      const c = pos[nm]; if (!c) continue; const e = cap[nm], age = (PB.t - e.t) / (win * 1.6); let tx = e.text; if (tx.length > 46) tx = tx.slice(0, 45) + "…"; const tw = tx.length * 5.6 + 16, g = mk("g", { opacity: 1 - 0.55 * age }, gFly), y0 = c.y - BH / 2 - 34;
      mk("rect", { x: c.x - tw / 2, y: y0, width: tw, height: 20, rx: 6, class: "ncap", stroke: KIND_COL[e.kind] || "#94a3b8", "stroke-width": 1.6 }, g); mk("path", { d: `M${c.x - 5},${y0 + 20}L${c.x + 5},${y0 + 20}L${c.x},${y0 + 26}Z`, class: "ncap" }, g);
      const t = mk("text", { x: c.x - tw / 2 + 8, y: y0 + 14, class: "ncaptx" }, g); t.textContent = tx;
    }
  }
  cv.addEventListener("click", (e) => { if (!PB.loaded) return; const g = e.target.closest && e.target.closest("[data-pid]"); if (g && g.dataset.pid !== "null") { N.pid = +g.dataset.pid; showPacket(PB.flights.find((f) => f.pid === N.pid)); } });

  /* ------------------------------------------------------------------ results */
  const bt = { sum: "nSum", narr: "nNarr", cap: "nCap", insp: "nInsp", links: "nLinks", mat: "nMat", prob: "nProb" };
  function showBTab(t) { document.querySelectorAll("#ntabs button[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === t)); for (const k in bt) $(bt[k]).hidden = k !== t; $("nbdock").classList.remove("collapsed"); }
  $("ntabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) showBTab(b.dataset.t); });
  $("nbdToggle").onclick = () => { $("nbdock").classList.toggle("collapsed"); setTimeout(fit, 30); };
  makeSplitter($("nbgrip"), $("nbdock"), document.querySelector("#workNet .center"));
  const tbl = (head, rows, cls = "") => `<table class="t ${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  const f3 = (v, d = 3) => (v === null || v === undefined ? "—" : (+v).toFixed(d));
  function buildResults() {
    const r = N.res; if (!r || !r.ok) { $("nSum").innerHTML = r && r.error ? `<div class="diag error">${esc(r.error)}</div>` : '<p class="empty">Run the network to see results.</p>'; $("nLinks").innerHTML = $("nCap").innerHTML = $("nProb").innerHTML = $("nInsp").innerHTML = $("nMat").innerHTML = ""; return; }
    const rows = [];
    for (const p of r.pings || []) rows.push(["ping", `${p.host} → ${p.target}`, `${p.received}/${p.sent} replies (${(+p.loss).toFixed(0)} % loss), ` + (p.rtt_avg === null ? "no reply" : `RTT min/avg/max ${f3(p.rtt_min)}/${f3(p.rtt_avg)}/${f3(p.rtt_max)} ms`) + (p.unreachable ? `, ${p.unreachable} unreachable` : "") + (p.ttl_exceeded ? `, ${p.ttl_exceeded} TTL exceeded` : "")]);
    for (const u of r.udp || []) rows.push(["udp", u.flow, `sent ${u.sent}, received ${u.received} (${f3(u.loss, 1)} % loss), ${(+u.throughput_kbps).toFixed(0)} kbit/s, delay ${u.delay_ms === null ? "-" : f3(u.delay_ms, 2) + " ms"}, jitter ${f3(u.jitter_ms)} ms`]);
    for (const t of r.tcp || []) rows.push(["tcp", t.flow, t.time_s === null ? `state ${t.state}: transfer did not complete (retransmits ${t.retransmits}, timeouts ${t.timeouts})` : `${(t.bytes / 1e3).toFixed(0)} kB in ${f3(t.time_s)} s = ${f3(t.goodput_mbps, 2)} Mbit/s goodput, retransmits ${t.retransmits}, timeouts ${t.timeouts}, max cwnd ${(+t.max_cwnd).toFixed(0)}, SRTT ${f3(t.srtt_ms, 1)} ms`]);
    for (const d of r.dns || []) rows.push(["dns", `${d.host} → ${d.server}`, `${d.query} = ${d.answer}` + (d.rtt_ms !== null ? ` in ${f3(d.rtt_ms)} ms` : "")]);
    for (const d of r.dhcp || []) rows.push(["dhcp", d.host, `lease ${d.ip}` + (d.bound_at_ms !== null ? ` at ${f3(d.bound_at_ms, 2)} ms` : "")]);
    for (const t of r.trace || []) rows.push(["trace", `${t.host || ""} → ${t.target || ""}`, esc(JSON.stringify(t.hops || t))]);
    let h = ""; if (r.checks && r.checks.length) h += "<h5>Checks against theory</h5>" + r.checks.map((c) => `<div class="chk ${c.passed ? "" : "bad"}"><div><b>${esc(c.name)}</b><div class="mute">${esc(c.detail)}</div></div></div>`).join("");
    h += "<h5>Traffic</h5>" + (rows.length ? tbl(["Kind", "Flow", "Result"], rows.map((x) => `<tr><td>${x[0]}</td><td>${esc(x[1])}</td><td>${x[0] === "trace" ? x[2] : esc(x[2])}</td></tr>`)) : '<p class="mute">No application traffic was configured. Add an app such as <b>ping 10.0.0.2</b> to a host.</p>');
    $("nSum").innerHTML = h;
    $("nLinks").innerHTML = tbl(["Link", "Mb/s", "A→B util", "B→A util", "pkts A→B", "pkts B→A", "queue drops", "loss drops"], (r.links || []).map((l) => `<tr><td>${esc(l.link)}</td><td class="n">${l.mbps}</td><td class="n">${(l.util_ab * 100).toFixed(1)} %</td><td class="n">${(l.util_ba * 100).toFixed(1)} %</td><td class="n">${l.pkts_ab}</td><td class="n">${l.pkts_ba}</td><td class="n">${l.queue_drops}</td><td class="n">${l.loss_drops}</td></tr>`));
    const warn = (r.warnings || []).map((w) => `<div class="diag warning">${esc(w)}</div>`).join("") || '<p class="mute">No warnings.</p>';
    $("nProb").innerHTML = warn + (r.drops && r.drops.length ? "<h5>Dropped packets</h5>" + tbl(["t (ms)", "Why", "Packet"], r.drops.slice(0, 500).map((d) => `<tr><td class="n">${(d.t * 1e3).toFixed(3)}</td><td>${esc(d.why)}</td><td>${esc(d.summary)}</td></tr>`)) : "");
    buildCapture(); updStatus();
  }
  function buildCapture() {
    const r = N.res; if (!r || !r.ok) return; const q = N.capFilter.toLowerCase(); const cap = r.capture || [];
    const rows = []; for (let i = 0; i < cap.length && rows.length < 3000; i++) { const c = cap[i]; const line = `${c.link} ${c.src} ${c.dst} ${c.proto} ${c.summary}`.toLowerCase(); if (q && !line.includes(q)) continue; rows.push(`<tr class="click${c.pid === N.pid ? " sel" : ""}" data-i="${i}"><td class="n">${i + 1}</td><td class="n">${(c.t * 1e3).toFixed(3)}</td><td>${esc(c.link)}</td><td>${esc(c.src)} → ${esc(c.dst)}</td><td>${esc(c.proto)}</td><td class="n">${c.bytes}</td><td>${esc(c.summary)}</td></tr>`); }
    $("nCap").innerHTML = `<div class="hl"><input id="capQ" type="search" placeholder="Filter (e.g. ICMP, H1, ARP)" value="${esc(N.capFilter)}" style="max-width:260px"><span class="mute">${cap.length} frames captured${cap.length > rows.length ? `, showing ${rows.length}` : ""}</span><span class="grow"></span><button class="btn" id="capCsv">Export CSV</button></div>` + tbl(["#", "t (ms)", "Link", "From → to", "Proto", "Bytes", "Summary"], rows);
    $("capQ").oninput = (e) => { N.capFilter = e.target.value; const pos = e.target.selectionStart; buildCapture(); const q2 = $("capQ"); q2.focus(); q2.setSelectionRange(pos, pos); };
    $("capCsv").onclick = exportCsv;
    $("nCap").querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => { const c = cap[+tr.dataset.i]; N.pid = c.pid; const f = PB.flights.find((x) => x.pid === c.pid) || { layers: c.layers, summary: c.summary, bytes: c.bytes, t1: c.t, link: c.link, label: c.label, proto: c.proto }; PB.pause(); setTime(c.t); showPacket(f); }));
  }
  function showPacket(f) {
    if (!f) return; const box = $("nInsp");
    box.innerHTML = `<h3>${esc(f.summary)}</h3><p class="mute">${esc(f.link)} · ${f.bytes} bytes · arrives ${fmtT(f.t1)}${f.flow ? " · flow " + esc(f.flow) : ""}</p>` + (f.layers || []).map(([name, kv]) => `<h5>${esc(name)}</h5>` + tbl(["Field", "Value"], kv.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`))).join("");
    showBTab("insp"); drawFly(); $("nCap").querySelectorAll("tr.click").forEach((tr) => tr.classList.toggle("sel", +tr.dataset.i === (N.res.capture || []).findIndex((c) => c.pid === N.pid)));
  }
  function buildNarr() {
    const j = bisectRight(PB.evT, PB.t), ev = PB.events.slice(Math.max(0, j - 140), j);
    $("nNarr").innerHTML = ev.length ? `<table class="t"><tbody>${ev.map((e) => `<tr><td class="n mute">${fmtT(e.t)}</td><td><b>${esc(e.node)}</b></td><td style="color:${KIND_COL[e.kind] || "#94a3b8"}">${KIND_NAME[e.kind] || esc(e.kind)}</td><td>${esc(e.text)}</td></tr>`).join("")}</tbody></table>` : '<p class="empty">Press play: every decision a block makes appears here as the replay reaches it.</p>';
    const b = $("nbdock").querySelector(".bbody"); if (!$("nNarr").hidden) b.scrollTop = b.scrollHeight;
  }
  function buildMatrix(m) {
    const ips = m.ips, srcs = m.srcs, cols = Object.values(ips), got = {}; for (const r of m.pings || []) got[`${r.host}|${ips[r.target]}`] = r; let ok = 0, bad = 0;
    const body = srcs.map((s) => `<tr><th>${esc(s)}</th>${cols.map((c) => { const r = got[`${s}|${c}`]; if (!r) return '<td><div class="mcell" style="background:#64748b">—</div></td>'; if (r.received) { ok++; return `<td><div class="mcell" style="background:#2e6b46">${f3(r.rtt_avg, 2)} ms</div></td>`; } bad++; return '<td><div class="mcell" style="background:#8c3b3b">no reply</div></td>'; }).join("")}</tr>`);
    $("nMat").innerHTML = `<p class="mute">Rows = source host, columns = destination. ${ok} paths work, ${bad} do not.</p>` + `<table class="t mat"><thead><tr><th></th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${body.join("")}</tbody></table>`;
    showBTab("mat"); toast(`Connectivity: ${ok} paths work, ${bad} do not`);
  }
  function updStatus() {
    if (!N.proj) return; $("counts").textContent = `${N.proj.nodes.length} blocks · ${N.proj.links.length} links`;
    const w = N.res && N.res.warnings ? N.res.warnings.length : 0, p = $("problems");
    if (N.res && !N.res.ok) { p.textContent = "Cannot run"; p.className = "problems bad"; } else if (w) { p.textContent = `${w} warning${w > 1 ? "s" : ""}`; p.className = "problems warn"; } else { p.textContent = "No problems"; p.className = "problems ok"; }
  }

  /* ------------------------------------------------------------------ run / probe / matrix */
  const projJson = () => JSON.stringify({ schema: "ecelab.network", version: 1, name: N.proj.name, sim: N.proj.sim || {}, notes: N.proj.notes || "", nodes: N.proj.nodes, links: N.proj.links });
  async function exec(fn, args, label) {
    if (N.busy) return null; N.busy = true; $("nRun").classList.add("busy"); setStatus(label, "busy"); const t0 = performance.now(); let out = null;
    try { out = JSON.parse(await call(fn, ...args)); } catch (e) { setStatus(String(e.message || e), "err"); N.busy = false; $("nRun").classList.remove("busy"); return null; }
    N.busy = false; $("nRun").classList.remove("busy");
    if (!out.ok) { N.res = out; setStatus(out.error.length > 90 ? out.error.slice(0, 90) + "…" : out.error, "err"); PB.clear(); buildResults(); renderAll(); showBTab("sum"); toast(out.error.slice(0, 120), 4200); return null; }
    setStatus(`Done in ${((performance.now() - t0) / 1000).toFixed(2)} s`, "ok"); return out;
  }
  async function run() {
    N.proj.sim = { ...(N.proj.sim || {}), duration: +$("nDur").value || 10 };
    const out = await exec("net_run", [projJson(), +$("nDur").value || 10, NET.key], "Running"); if (!out) return;
    N.res = out; N.pid = null; buildResults(); renderAll(); PB.load(out); $("pSpeed").value = "0"; PB.auto = true; PB.speed = PB.autoSpeed(); showBTab("sum"); PB.play();
  }
  async function probe() {
    const src = $("nSrc").value, dst = $("nDst").value, kind = $("nKind").value; if (!src || !dst) { toast("Pick a source and a destination with an address"); return; }
    const out = await exec("net_probe", [projJson(), src, dst, kind], "Testing"); if (!out) return;
    N.res = out; N.pid = null; buildResults(); renderAll(); PB.load(out); showBTab("sum"); PB.play(); toast(`${N.probes[kind] || kind}: ${nodeById(src).name} → ${dst}`);
  }
  async function matrix() {
    const out = await exec("net_matrix", [projJson()], "Checking connectivity"); if (!out) return;
    N.res = out; N.pid = null; buildResults(); renderAll(); PB.load(out); buildMatrix(out); PB.play();
  }
  $("nRun").onclick = run; $("nProbe").onclick = probe; $("nMatrix").onclick = matrix;
  function fillSelects() {
    if (!N.proj) return; const hosts = N.proj.nodes.filter((n) => n.type === "host" || n.type === "server"), dsts = N.proj.nodes.filter((n) => nodeIp(n));
    const keepS = $("nSrc").value, keepD = $("nDst").value;
    $("nSrc").innerHTML = hosts.map((n) => `<option value="${n.id}">${esc(n.name)}</option>`).join(""); $("nDst").innerHTML = dsts.map((n) => `<option value="${nodeIp(n)}">${esc(n.name)} (${nodeIp(n)})</option>`).join("");
    if (keepS && [...$("nSrc").options].some((o) => o.value === keepS)) $("nSrc").value = keepS; if (keepD && [...$("nDst").options].some((o) => o.value === keepD)) $("nDst").value = keepD;
  }
  function exportCsv() {
    const r = N.res; if (!r || !r.ok) { toast("Run the network first"); return; }
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`; const rows = ["no,t_ms,link,src,dst,proto,bytes,summary"].concat((r.capture || []).map((c, i) => [i + 1, (c.t * 1e3).toFixed(4), q(c.link), q(c.src), q(c.dst), c.proto, c.bytes, q(c.summary)].join(",")));
    download("capture.csv", rows.join("\n"), "text/csv");
  }

  /* ------------------------------------------------------------------ projects */
  function setProject(proj, info, key) {
    N.proj = { schema: "ecelab.network", version: 1, name: proj.name || "Untitled network", sim: proj.sim || {}, notes: proj.notes || "", nodes: proj.nodes || [], links: proj.links || [] }; N.info = info || null; NET.key = key || "";
    N.sel = null; N.res = null; N.hist = []; N.fut = []; N.pid = null; N.linkFrom = null; PB.clear(); updHist(); setTool("sel");
    $("nDur").value = (N.info && N.info.duration) || (N.proj.sim && N.proj.sim.duration) || 10; fillSelects(); renderAll(); buildProps(); buildAbout(); buildResults(); buildNarr(); buildState(); setTime(0);
    showRTab(info ? "about" : "prop"); fit();
  }
  async function openExample(key) {
    setStatus("Loading", "busy"); const o = JSON.parse(await call("net_load_example", key)); setProject(o.project, o.info, key); setStatus("Ready"); run();
  }
  window.openNetExample = openExample;
  NET.openFile = async (f) => { try { const o = JSON.parse(await f.text()); if (!o.nodes) throw new Error("not a network file"); setProject(o, { title: o.name || f.name, group: "Opened file", objective: "", steps: [], theory: "", duration: (o.sim && o.sim.duration) || 10 }, ""); } catch (err) { setStatus("Cannot open: " + err.message, "err"); } };
  const FILE = { new: () => { setProject({ name: "Untitled network", nodes: [], links: [], sim: {} }, null, ""); toast("New network. Add blocks from the palette."); }, open: () => $("fOpen").click(), save: () => download((N.proj.name || "network").replace(/[^\w-]+/g, "_") + ".ecelab-net.json", projJson(), "application/json"), csv: exportCsv };
  const EDIT = () => [{ t: "Undo", k: "Ctrl+Z", f: undo, d: !N.hist.length }, { t: "Redo", k: "Ctrl+Y", f: redo, d: !N.fut.length }, { sep: 1 }, { t: "Delete", k: "Del", f: delSel, d: !N.sel }, { sep: 1 }, { t: "Fit network to window", k: "Home", f: fit }];

  $("mFile").onclick = (e) => showMenu(e.currentTarget, [{ t: "New network", f: FILE.new }, { t: "Open…", f: FILE.open }, { t: "Save", f: FILE.save }, { sep: 1 }, { t: "Export packet capture (CSV)", f: FILE.csv }]);
  $("mEdit").onclick = (e) => showMenu(e.currentTarget, EDIT());
  /* ------------------------------------------------------------------ buttons, palette */
  $("nSel").onclick = () => setTool("sel"); $("nLink").onclick = () => setTool(N.tool === "link" ? "sel" : "link"); $("nUndo").onclick = undo; $("nRedo").onclick = redo; $("nDel").onclick = delSel;
  $("nZin").onclick = () => zoomBy(1.25); $("nZout").onclick = () => zoomBy(0.8); $("nFit").onclick = fit; $("nParts").onclick = () => $("app").classList.toggle("showparts");
  NET.init = async () => {
    const t = JSON.parse(await call("net_types")); N.types = t.types; N.defaults = t.defaults; N.help = t.help; N.multiline = t.multiline; N.probes = t.probes; NET.examples = JSON.parse(await call("net_example_list"));
    $("nKind").innerHTML = Object.entries(N.probes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    const box = $("ntiles"); box.innerHTML = ""; for (const [k, v] of Object.entries(N.types)) { const b = document.createElement("button"); b.className = "tile"; b.dataset.type = k; b.draggable = true; b.title = v.name; b.innerHTML = `<span class="th"><svg class="ic"><use href="#n-${k}"/></svg></span><span>${esc(v.name)}</span>`; box.appendChild(b); }
    box.onclick = (e) => { const b = e.target.closest(".tile"); if (b) { addCenter(b.dataset.type); $("app").classList.remove("showparts"); } };
    box.addEventListener("dragstart", (e) => { const b = e.target.closest(".tile"); if (b) { e.dataTransfer.setData("text/plain", "net:" + b.dataset.type); e.dataTransfer.effectAllowed = "copy"; } });
    const st = $("nstage"); st.addEventListener("dragover", (e) => e.preventDefault()); st.addEventListener("drop", (e) => { e.preventDefault(); const d = e.dataTransfer.getData("text/plain"); if (d.startsWith("net:")) { const w = toWorld(e); addNode(d.slice(4), w.x, w.y); } });
    setPlayIcon();
  };
  window.addEventListener("resize", () => { if (N.proj) fit(); });
})();

$("fOpen").onchange = async (e) => { const f = e.target.files[0]; if (f) await NET.openFile(f); e.target.value = ""; };
(async () => {
  try {
    await call("boot");
    await NET.init();
    $("boot").remove(); setStatus("Ready");
    const q = new URLSearchParams(location.search).get("ex");
    await openNetExample(q && NET.examples.some((x) => x.key === q) ? q : "lan_ping");
    setTimeout(() => NET.fit(), 150);
  } catch (err) { const m = "Could not start: " + (err.message || err); if ($("boottext")) $("boottext").textContent = m; else setStatus(m.slice(0, 160), "err"); console.error(m); }
})();
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("../sw.js").catch(() => {});
