// Visual parts of the kits: every widget returns {el, update(kit, ctx)}; update is called once per animation frame.
import { SEG_FONT } from "./kit8085.js";
import { glyphRows } from "./devices.js";

const NS = "http://www.w3.org/2000/svg";
export function h(tag, a = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(a || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
export function sv(tag, a = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(a || {})) if (v !== undefined && v !== null) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}
const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, "0");
const lum = (d) => (d <= 0.001 ? 0 : Math.min(1, Math.sqrt(d) * 1.15));

export function mod(title, note, body, cls = "") {
  return h("section", { class: "mod " + cls }, h("header", {}, h("h4", { text: title }), note ? h("span", { class: "note", text: note }) : null), body);
}

/** A tone generator for buzzers and speakers; created lazily on a user gesture. */
export const audio = {
  ctx: null, on: false, voices: new Map(),
  enable() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; } }
    this.ctx.resume && this.ctx.resume();
    this.on = true;
    return true;
  },
  disable() { this.on = false; for (const v of this.voices.values()) v.gain.gain.value = 0; },
  tone(id, freq) {
    if (!this.on || !this.ctx) return;
    let v = this.voices.get(id);
    if (!v) {
      const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
      osc.type = "square"; gain.gain.value = 0; osc.connect(gain).connect(this.ctx.destination); osc.start();
      v = { osc, gain }; this.voices.set(id, v);
    }
    if (freq > 20 && freq < 20000) { v.osc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.005); v.gain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.01); }
    else v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  },
  click() {
    if (!this.on || !this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = 1800; g.gain.value = 0.08; o.connect(g).connect(this.ctx.destination);
    o.start(); g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.01, 0.01); o.stop(this.ctx.currentTime + 0.05);
  },
};

// ------------------------------------------------------------------ LEDs, switches, buttons
export function ledRow({ n = 8, names, color = "red", get }) {
  const leds = [];
  const row = h("div", { class: "ledrow" });
  for (let i = n - 1; i >= 0; i--) {
    const l = h("i", { class: "led " + color });
    leds[i] = l;
    row.append(h("span", { class: "lc" }, l, h("small", { text: names ? names[i] : String(i) })));
  }
  const last = new Array(n).fill(-1);
  return {
    el: row,
    update(kit) {
      const d = get(kit);
      for (let i = 0; i < n; i++) {
        const b = Math.round(lum(d[i]) * 20) / 20;
        if (b !== last[i]) { last[i] = b; leds[i].style.setProperty("--b", b); }
      }
    },
  };
}

export function dipRow({ n = 8, get, set, names }) {
  const sw = [];
  const row = h("div", { class: "dip" });
  for (let i = n - 1; i >= 0; i--) {
    const b = h("button", { class: "sw", title: `Switch ${i}: click to toggle`, "aria-label": `switch ${i}`, onclick: () => set(i) }, h("i"), h("small", { text: names ? names[i] : String(i) }));
    sw[i] = b;
    row.append(b);
  }
  return { el: row, update(kit) { const v = get(kit); for (let i = 0; i < n; i++) sw[i].classList.toggle("on", !!((v >> i) & 1)); } };
}

export function pushButtons({ labels, onDown, onUp }) {
  const row = h("div", { class: "pbrow" });
  labels.forEach((t, i) => {
    const b = h("button", { class: "pbtn", text: t, type: "button" });
    const down = (e) => { e.preventDefault(); b.classList.add("down"); onDown(i, t); };
    const up = () => { if (b.classList.contains("down")) { b.classList.remove("down"); onUp && onUp(i, t); } };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("pointercancel", up);
    row.append(b);
  });
  return { el: row, update() {} };
}

// ------------------------------------------------------------------ seven-segment
const SEGS = [
  "M8,4 L32,4 L28,9 L12,9Z", "M34,6 L34,32 L29,29 L29,11Z", "M34,38 L34,64 L29,59 L29,41Z", "M8,66 L32,66 L28,61 L12,61Z",
  "M6,38 L6,64 L11,59 L11,41Z", "M6,6 L6,32 L11,29 L11,11Z", "M8,35 L12,31 L28,31 L32,35 L28,39 L12,39Z",
];
function digitSvg(tint) {
  const el = sv("svg", { viewBox: "0 0 42 72", class: "digit " + (tint || "") });
  const parts = SEGS.map((d) => { const p = sv("path", { d, class: "seg" }); el.append(p); return p; });
  const dp = sv("circle", { cx: 38, cy: 66, r: 2.6, class: "seg" });
  el.append(dp);
  parts.push(dp);
  return { el, parts, last: new Array(8).fill(-1) };
}
export function sevenSeg({ digits, tints, get }) {
  const row = h("div", { class: "sevenseg" });
  const ds = [];
  for (let d = 0; d < digits; d++) {
    const dg = digitSvg(tints ? tints[d] : "");
    ds[d] = dg;
    row.append(dg.el);
  }
  return {
    el: row,
    update(kit) {
      const v = get(kit);
      for (let d = 0; d < digits; d++) for (let s = 0; s < 8; s++) {
        const b = Math.round(lum(v[d][s]) * 20) / 20;
        if (b !== ds[d].last[s]) { ds[d].last[s] = b; ds[d].parts[s].style.opacity = 0.07 + 0.93 * b; }
      }
    },
  };
}
/** Seven-segment display driven by characters (for the monitor): text -> segment bitmaps. */
export function charDisplay({ n, tints, get }) {
  const inner = sevenSeg({ digits: n, tints, get: (kit) => {
    const t = get(kit);
    return Array.from({ length: n }, (_, i) => {
      const ch = t[i] ?? " ";
      const code = SEG_FONT[ch] ?? SEG_FONT[ch.toUpperCase?.()] ?? 0;
      return Array.from({ length: 8 }, (_, s) => (code >> s) & 1);
    });
  } });
  return inner;
}

// ------------------------------------------------------------------ keypads
export function hexKeypad({ onChange }) {
  const grid = h("div", { class: "keygrid" });
  for (let k = 0; k < 16; k++) {
    const b = h("button", { class: "key", type: "button", text: k.toString(16).toUpperCase() });
    const down = (e) => { e.preventDefault(); b.classList.add("down"); onChange(k, true); };
    const up = () => { if (b.classList.contains("down")) { b.classList.remove("down"); onChange(k, false); } };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("pointercancel", up);
    grid.append(b);
  }
  return { el: grid, update() {} };
}

export function monitorKeys({ onKey }) {
  const keys = [
    "C", "D", "E", "F", "RESET", "8", "9", "A", "B", "GO", "4", "5", "6", "7", "EXEC", "0", "1", "2", "3", "NEXT", "EXAM", "REG", "STEP", "PREV", "INT",
  ];
  const grid = h("div", { class: "monkeys" });
  for (const k of keys) {
    const fn = k.length > 1;
    grid.append(h("button", { type: "button", class: "mkey" + (fn ? " fn" : "") + (k === "RESET" ? " rst" : ""), text: k, title: KEYHELP[k] || "", onclick: () => onKey(k) }));
  }
  return { el: grid, update() {} };
}
const KEYHELP = {
  RESET: "Reset the CPU and monitor", GO: "Start entering a start address (then EXEC)", EXEC: "Run the program from the entered address", NEXT: "Store the data and go to the next address",
  PREV: "Store the data and go to the previous address", EXAM: "Examine/modify memory (type an address, then NEXT)", REG: "Examine/modify registers", STEP: "Execute one instruction", INT: "Vectored interrupt: raises RST 7.5",
};

// ------------------------------------------------------------------ LCD
export function lcdWidget() {
  const W = 16, cw = 24, ch = 40, pad = 10;
  const cv = h("canvas", { class: "lcd", width: W * cw + pad * 2, height: 2 * ch + pad * 2 + 6 });
  const c = cv.getContext("2d");
  let lastKey = "";
  const badge = h("div", { class: "lcdinfo" });
  return {
    el: h("div", { class: "lcdwrap" }, cv, badge),
    update(kit, ctx) {
      const lcd = kit.lcd;
      const rows = lcd.view();
      const cur = lcd.cursorPos();
      const blinkPhase = Math.floor(ctx.wall / 500) & 1;
      const key = rows.map((r) => r.join(",")).join("|") + lcd.cg.join(",") + (cur ? cur.row + ":" + cur.col : "") + lcd.on + lcd.cur + lcd.blink + (lcd.blink ? blinkPhase : 0);
      const info = lcd.ignored ? `${lcd.ignored} command(s) ignored: the LCD was busy` : lcd.on ? (lcd.initialised ? "" : "not initialised: function set missing") : "display off";
      if (badge.textContent !== info) { badge.textContent = info; badge.classList.toggle("warn", !!lcd.ignored); }
      if (key === lastKey) return;
      lastKey = key;
      const cs = getComputedStyle(document.documentElement);
      c.fillStyle = cs.getPropertyValue("--lcdbg").trim() || "#9dbb3a";
      c.fillRect(0, 0, cv.width, cv.height);
      const ink = cs.getPropertyValue("--lcdink").trim() || "#1d2a0c";
      const faint = cs.getPropertyValue("--lcdfaint").trim() || "rgba(30,50,10,.10)";
      for (let r = 0; r < 2; r++) for (let col = 0; col < W; col++) {
        const x0 = pad + col * cw, y0 = pad + r * (ch + 6);
        const code = lcd.on ? rows[r][col] : 0x20;
        const bits = glyphRows(code, lcd.cg);
        const isCur = cur && cur.row === r && cur.col === col;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) {
          const on = (bits[y] >> (4 - x)) & 1;
          let draw = on;
          if (isCur && lcd.cur && y === 7) draw = 1;
          if (isCur && lcd.blink && blinkPhase) draw = 1;
          c.fillStyle = draw ? ink : faint;
          c.fillRect(x0 + x * 4, y0 + y * 4, 3, 3);
        }
      }
    },
  };
}

// ------------------------------------------------------------------ motors, lamps
export function stepperWidget() {
  const el = sv("svg", { viewBox: "0 0 150 130", class: "motor" });
  el.append(sv("circle", { cx: 60, cy: 65, r: 50, class: "stator" }));
  const coils = [];
  [["A", 0], ["B", 90], ["C", 180], ["D", 270]].forEach(([n, a], i) => {
    const x = 60 + 38 * Math.cos((a * Math.PI) / 180), y = 65 - 38 * Math.sin((a * Math.PI) / 180);
    const c = sv("circle", { cx: x, cy: y, r: 9, class: "coil" });
    el.append(c, sv("text", { x, y: y + 3.5, class: "ct", "text-anchor": "middle" }, document.createTextNode(n)));
    coils.push(c);
  });
  const rotor = sv("g", {}, sv("circle", { cx: 60, cy: 65, r: 19, class: "rotor" }), sv("path", { d: "M60,65 L60,44", class: "needle" }), sv("path", { d: "M54,50 L60,43 L66,50Z", class: "needleh" }));
  el.append(rotor);
  const txt = h("div", { class: "motxt" });
  let last = "";
  return {
    el: h("div", { class: "motorwrap" }, el, txt),
    update(kit) {
      const s = kit.stepper;
      // rotor angle: 0 deg points along +x like the coil layout (A at the right)
      rotor.setAttribute("transform", `rotate(${(90 - s.angle).toFixed(1)} 60 65)`);
      coils.forEach((c, i) => c.classList.toggle("on", !!((s.coils >> i) & 1)));
      const t = `${s.angle.toFixed(1)}° | ${s.steps} steps${s.missed ? ` | ${s.missed} missed` : ""}`;
      if (t !== last) { last = t; txt.textContent = t; txt.classList.toggle("warn", s.missed > 0); }
    },
  };
}

export function dcMotorWidget() {
  const el = sv("svg", { viewBox: "0 0 130 110", class: "motor" });
  el.append(sv("circle", { cx: 60, cy: 55, r: 46, class: "stator" }));
  const fan = sv("g", {});
  for (let i = 0; i < 4; i++) fan.append(sv("path", { d: "M60,55 Q70,25 82,38 Q76,50 60,55Z", class: "blade", transform: `rotate(${i * 90} 60 55)` }));
  fan.append(sv("circle", { cx: 60, cy: 55, r: 5, class: "hub" }));
  el.append(fan);
  const txt = h("div", { class: "motxt" });
  let angle = 0, speed = 0, last = "";
  return {
    el: h("div", { class: "motorwrap" }, el, txt),
    update(kit, ctx) {
      const duty = kit.motorEn.read(kit.t)[0];
      const target = duty * (kit.motorDir ? -1 : 1) * 900; // degrees per second at full speed (display scale)
      speed += (target - speed) * Math.min(1, ctx.dtWall / 250);
      angle = (angle + (speed * ctx.dtWall) / 1000) % 360;
      fan.setAttribute("transform", `rotate(${angle.toFixed(1)} 60 55)`);
      const t = `${Math.round(Math.abs(duty) * 100)} % drive | ${kit.motorDir ? "CCW" : "CW"}`;
      if (t !== last) { last = t; txt.textContent = t; }
    },
  };
}

export function relayWidget() {
  const el = sv("svg", { viewBox: "0 0 130 70", class: "relay" });
  el.append(sv("rect", { x: 8, y: 14, width: 48, height: 40, rx: 5, class: "stator" }), sv("path", { d: "M16,34 h8 l3,-8 6,16 6,-16 3,8 h8", class: "needle", fill: "none" }));
  const arm = sv("path", { d: "M80,50 L108,30", class: "needle" });
  el.append(arm, sv("circle", { cx: 80, cy: 50, r: 3, class: "hub" }), sv("circle", { cx: 112, cy: 28, r: 3, class: "hub" }), sv("circle", { cx: 112, cy: 52, r: 3, class: "hub" }));
  const lamp = h("i", { class: "led green" });
  const txt = h("div", { class: "motxt", text: "coil off" });
  let on = -1, clicks = 0;
  return {
    el: h("div", { class: "motorwrap" }, el, h("div", { class: "rline" }, lamp, txt)),
    update(kit) {
      if (kit.relay !== on) {
        on = kit.relay;
        arm.setAttribute("d", on ? "M80,50 L108,52" : "M80,50 L108,30");
        lamp.style.setProperty("--b", on ? 1 : 0);
        txt.textContent = on ? "coil on: contact closed" : "coil off";
      }
      if (kit.relayClicks !== clicks) { clicks = kit.relayClicks; audio.click(); }
    },
  };
}

export function trafficWidget() {
  const el = sv("svg", { viewBox: "0 0 210 170", class: "traffic" });
  el.append(sv("rect", { x: 0, y: 70, width: 210, height: 30, class: "road" }), sv("rect", { x: 90, y: 0, width: 30, height: 170, class: "road" }));
  for (let x = 4; x < 80; x += 16) el.append(sv("path", { d: `M${x},85 h8`, class: "dash" }));
  for (let x = 130; x < 206; x += 16) el.append(sv("path", { d: `M${x},85 h8`, class: "dash" }));
  for (let y = 4; y < 60; y += 16) el.append(sv("path", { d: `M105,${y} v8`, class: "dash" }));
  for (let y = 110; y < 166; y += 16) el.append(sv("path", { d: `M105,${y} v8`, class: "dash" }));
  const lamps = [];
  const head = (x, y, base, label) => {
    el.append(sv("rect", { x, y, width: 22, height: 62, rx: 5, class: "head" }));
    ["R", "Y", "G"].forEach((c, i) => {
      const l = sv("circle", { cx: x + 11, cy: y + 12 + i * 19, r: 7, class: "lamp " + c });
      el.append(l);
      lamps[base + i] = l;
    });
    el.append(sv("text", { x: x + 11, y: y + 76, class: "ct", "text-anchor": "middle" }, document.createTextNode(label)));
  };
  head(126, 4, 0, "Road 1");
  head(62, 104, 3, "Road 2");
  const last = new Array(6).fill(-1);
  return {
    el: h("div", { class: "motorwrap" }, el),
    update(kit) {
      const d = kit.traffic.read(kit.t);
      for (let i = 0; i < 6; i++) {
        const b = Math.round(lum(d[i]) * 10) / 10;
        if (b !== last[i]) { last[i] = b; lamps[i].style.opacity = 0.14 + 0.86 * b; }
      }
    },
  };
}

// ------------------------------------------------------------------ DAC scope and ADC
export function scopeWidget() {
  const cv = h("canvas", { class: "scope", width: 420, height: 180 });
  const c = cv.getContext("2d");
  const sel = h("select", { title: "Time per division" });
  const divs = [["20 µs", 20e-6], ["50 µs", 50e-6], ["100 µs", 100e-6], ["200 µs", 200e-6], ["500 µs", 500e-6], ["1 ms", 1e-3], ["2 ms", 2e-3], ["5 ms", 5e-3], ["10 ms", 10e-3], ["50 ms", 50e-3], ["0.2 s", 0.2]];
  divs.forEach(([t], i) => sel.append(h("option", { value: i, text: t + "/div" })));
  sel.value = "5";
  const stat = h("div", { class: "scstat" });
  const el = h("div", { class: "scopewrap" }, cv, h("div", { class: "scctl" }, sel, stat));
  let lastKey = "";
  return {
    el,
    update(kit) {
      const ev = kit.dac.ev;
      const key = ev.length + ":" + sel.value + ":" + (ev.length ? ev[ev.length - 2] : 0) + document.documentElement.dataset.theme;
      if (key === lastKey) return;
      lastKey = key;
      const cs = getComputedStyle(document.documentElement);
      const W = cv.width, H = cv.height, L = 34, B = 18, T = 8, R = 6;
      const pw = W - L - R, ph = H - T - B;
      c.fillStyle = cs.getPropertyValue("--plot").trim() || "#fff";
      c.fillRect(0, 0, W, H);
      c.strokeStyle = cs.getPropertyValue("--line").trim() || "#ccc";
      c.fillStyle = cs.getPropertyValue("--mute").trim() || "#777";
      c.font = "10px sans-serif";
      c.lineWidth = 1;
      for (let i = 0; i <= 10; i++) { const x = L + (pw * i) / 10; c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke(); }
      for (let v = 0; v <= 5; v++) { const y = T + ph - (ph * v) / 5; c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.fillText(v + " V", 4, y + 3); }
      const span = divs[+sel.value][1] * 10;
      const n = ev.length / 2;
      if (!n) { stat.textContent = "no DAC output yet"; return; }
      // trigger on the latest rising edge through mid-scale that leaves a full window after it
      const tEnd = ev[ev.length - 2];
      let t0 = Math.max(0, tEnd - span);
      for (let i = n - 1; i > 0; i--) {
        if (ev[i * 2 - 1] < 128 && ev[i * 2 + 1] >= 128 && ev[i * 2] <= tEnd - span) { t0 = ev[i * 2]; break; }
        if (ev[i * 2] < tEnd - span * 3) break;
      }
      const X = (t) => L + ((t - t0) / span) * pw;
      const Y = (code) => T + ph - (ph * (code / 256) * 5) / 5;
      c.strokeStyle = cs.getPropertyValue("--trace1").trim() || "#2f6fed";
      c.lineWidth = 1.6;
      c.beginPath();
      let started = false, cur = 0;
      let i0 = 0;
      while (i0 < n && ev[i0 * 2] < t0) { cur = ev[i0 * 2 + 1]; i0++; }
      c.moveTo(X(t0), Y(cur));
      let vmax = cur, vmin = cur;
      const rises = [];
      let prev = cur, hiTime = 0;
      for (let i = i0; i < n; i++) {
        const t = ev[i * 2], v = ev[i * 2 + 1];
        if (t > t0 + span) break;
        c.lineTo(X(t), Y(prev)); c.lineTo(X(t), Y(v));
        if (prev < 128 && v >= 128) rises.push(t);
        if (prev >= 128) hiTime += Math.min(t, t0 + span) - (i > i0 ? ev[(i - 1) * 2] : t0);
        prev = v; vmax = Math.max(vmax, v); vmin = Math.min(vmin, v);
      }
      c.lineTo(X(Math.min(t0 + span, Math.max(tEnd, t0))), Y(prev));
      c.stroke();
      void started;
      const f = rises.length >= 2 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : 0;
      const fmt = (x) => (x >= 1000 ? (x / 1000).toFixed(2) + " kHz" : x.toFixed(1) + " Hz");
      stat.textContent = `Vmax ${(vmax / 256 * 5).toFixed(2)} V  Vmin ${(vmin / 256 * 5).toFixed(2)} V  Vpp ${((vmax - vmin) / 256 * 5).toFixed(2)} V  f ${f ? fmt(f) : "-"}  out ${kit.dac.volts.toFixed(2)} V`;
    },
  };
}

export function adcWidget() {
  const rows = [];
  const names = ["CH0 pot 1", "CH1 pot 2", "CH2 LM35", "CH3 LDR", "CH4", "CH5", "CH6", "CH7"];
  const box = h("div", { class: "adcs" });
  let kitRef = null;
  names.forEach((n, i) => {
    const out = h("output", { text: "" });
    const r = h("input", { type: "range", min: 0, max: 5, step: 0.01, value: 0, "aria-label": n });
    r.addEventListener("input", () => { if (kitRef) { kitRef.adc.inputs[i] = +r.value; draw(i); } });
    const draw = (j) => { const v = kitRef.adc.inputs[j]; out.textContent = j === 2 ? `${(v * 100).toFixed(0)} °C` : `${v.toFixed(2)} V`; };
    rows.push({ r, out, draw });
    box.append(h("label", { class: "adcrow" }, h("span", { text: n }), r, out));
  });
  const stat = h("div", { class: "scstat" });
  box.append(stat);
  return {
    el: box,
    update(kit) {
      kitRef = kit;
      rows.forEach((x, i) => {
        if (document.activeElement !== x.r && +x.r.value !== kit.adc.inputs[i]) x.r.value = kit.adc.inputs[i];
        x.draw(i);
      });
      stat.textContent = `last result ${hex(kit.adc.data)}H (${kit.adc.data}) | channel ${kit.adc.ch} | ${kit.adc.converting ? "converting" : "EOC"} | ${kit.adc.conv || 0} conversions`;
    },
  };
}

// ------------------------------------------------------------------ terminal
export function terminalWidget({ send }) {
  const pre = h("pre", { class: "termout" });
  const input = h("input", { type: "text", class: "terminp", placeholder: "click here and type; Enter sends CR", spellcheck: "false", autocomplete: "off" });
  input.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter") { send(13); e.preventDefault(); }
    else if (e.key === "Backspace") { send(8); e.preventDefault(); }
    else if (e.key.length === 1) { send(e.key.charCodeAt(0)); e.preventDefault(); }
  });
  let last = -1, txt = "";
  return {
    el: h("div", { class: "term" }, pre, input),
    update(kit) {
      if (kit.term.length === last) return;
      last = kit.term.length;
      txt = "";
      for (const c of kit.term) {
        if (c === 13) continue;
        if (c === 8) txt = txt.slice(0, -1);
        else txt += c === 10 ? "\n" : c >= 32 && c < 127 ? String.fromCharCode(c) : `<${hex(c)}>`;
      }
      pre.textContent = txt;
      pre.scrollTop = pre.scrollHeight;
    },
  };
}
