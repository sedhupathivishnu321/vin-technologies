// LEARNERS LAB trainer kits: application shell (editor, runner, state panes, experiments).
import { Kit8085 } from "./kit8085.js";
import { Kit8051 } from "./kit8051.js";
import { assemble8085 } from "./a8085.js";
import { assemble8051 } from "./a8051.js";
import { disasm8085 } from "./i8085.js";
import { disasm8051 } from "./i8051.js";
import { EX8085 } from "./ex8085.js";
import { EX8051 } from "./ex8051.js";
import { h, mod, audio, ledRow, dipRow, pushButtons, sevenSeg, charDisplay, hexKeypad, monitorKeys, lcdWidget, stepperWidget, dcMotorWidget, relayWidget, trafficWidget, scopeWidget, adcWidget, terminalWidget } from "./widgets.js";
import { REFERENCE } from "./reference.js";

const hex = (v, n = 2) => (v >>> 0).toString(16).toUpperCase().padStart(n, "0");
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("ll-trainer:" + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ll-trainer:" + k, v); } catch { /* storage unavailable */ } },
};

// ------------------------------------------------------------------ per-kit definitions
const KITS = {
  8085: {
    name: "8085", make: () => new Kit8085(), asm: assemble8085, examples: EX8085, clock: (k) => k.hz, cycles: (k) => k.cpu.tstates, unit: "T-states",
    dis: (k, a) => disasm8085(k.cpu.mem, a), pc: (k) => k.cpu.pc, isCall: (k) => { const op = k.cpu.mem[k.cpu.pc]; return op === 0xcd || (op & 0xc7) === 0xc4 ? 3 : 0; },
    stubs: `        ORG 2000H\n        ; your program here\n        HLT\n`,
  },
  8051: {
    name: "8051", make: () => new Kit8051(), asm: assemble8051, examples: EX8051, clock: (k) => k.fosc / 12, cycles: (k) => k.cpu.cycles, unit: "machine cycles",
    dis: (k, a) => disasm8051(k.cpu.code, a), pc: (k) => k.cpu.pc, isCall: (k) => { const op = k.cpu.code[k.cpu.pc]; return op === 0x12 ? 3 : (op & 0x1f) === 0x11 ? 2 : 0; },
    stubs: `        ORG 0000H\n        ; your program here\n        SJMP $\n`,
  },
};

const app = {
  kitName: store.get("kit", "8085"),
  kits: {},
  tab: { left: "code", right: "cpu" },
  run: { running: false, mult: 1, ips: 0, ipsAcc: 0, skipBp: false, tempBp: null, lastWall: 0, simPrev: 0, wallPrev: 0, eff: 1 },
  boardUpdates: [],
  panes: {},
  frame: 0,
};
if (!KITS[app.kitName]) app.kitName = "8085";
const cur = () => app.kits[app.kitName];
const def = () => KITS[app.kitName];

const DEFAULT_EX = { 8085: "c-led", 8051: "i-chaser" };
function makeState(name) {
  const d = KITS[name];
  const saved = store.get("src:" + name, null);
  const dex = d.examples.find((e) => e.id === DEFAULT_EX[name]);
  return { name, kit: d.make(), src: saved === null ? (dex ? dex.code : d.stubs) : saved, exp: saved === null ? dex || null : null, asm: null, loaded: false, bps: new Set(), lineOfAddr: new Map(), addrOfLine: new Map(), errLines: new Set(), pcLine: 0, board: null, memSpace: name === "8085" ? "mem" : "iram", memBase: name === "8085" ? 0x2000 : 0x0000 };
}

// ------------------------------------------------------------------ status helpers
function setStatus(msg, kind = "") {
  $("stmsg").textContent = msg;
  $("stmsg").className = "st " + kind;
  $("sdot").className = "sdot " + (kind === "err" ? "err" : kind === "run" ? "ok" : kind === "busy" ? "busy" : "");
}
function toast(msg) { setStatus(msg); }

// ------------------------------------------------------------------ editor
const ed = { src: null, gnums: null, curline: null };
function initEditor() {
  ed.src = $("src"); ed.gnums = $("gnums"); ed.curline = $("curline");
  ed.src.addEventListener("input", () => { const s = cur(); s.src = ed.src.value; s.loaded = false; store.set("src:" + s.name, s.src); renderGutter(); });
  ed.src.addEventListener("scroll", () => { $("gutter").scrollTop = ed.src.scrollTop; placeCurLine(); });
  ed.src.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const a = ed.src.selectionStart, b = ed.src.selectionEnd;
      ed.src.setRangeText("    ", a, b, "end");
      ed.src.dispatchEvent(new Event("input"));
    }
  });
  $("gutter").addEventListener("click", (e) => {
    const t = e.target.closest("[data-l]");
    if (t) toggleBpLine(+t.dataset.l);
  });
}
function renderGutter() {
  const s = cur();
  const n = ed.src.value.split("\n").length;
  let html = "";
  for (let i = 1; i <= n; i++) {
    const cls = ["ln"];
    const a = s.addrOfLine.get(i);
    if (a !== undefined && s.bps.has(a)) cls.push("bp");
    if (s.errLines.has(i)) cls.push("err");
    if (s.pcLine === i) cls.push("pc");
    html += `<span class="${cls.join(" ")}" data-l="${i}">${i}</span>`;
  }
  ed.gnums.innerHTML = html;
}
function placeCurLine() {
  const s = cur();
  if (!s.pcLine) { ed.curline.style.display = "none"; return; }
  ed.curline.style.display = "block";
  ed.curline.style.top = ((s.pcLine - 1) * 19 + 8 - ed.src.scrollTop) + "px";
}
function toggleBpLine(line) {
  const s = cur();
  const a = s.addrOfLine.get(line);
  if (a === undefined) { toast("Breakpoints can only be set on instruction lines (assemble first)"); return; }
  if (s.bps.has(a)) s.bps.delete(a); else s.bps.add(a);
  renderGutter();
  app.dis = null;
}
function toggleBpAddr(a) {
  const s = cur();
  if (s.bps.has(a)) s.bps.delete(a); else s.bps.add(a);
  renderGutter();
  app.dis = null;
}
function scrollToLine(line) {
  const y = (line - 1) * 19;
  if (y < ed.src.scrollTop + 10 || y > ed.src.scrollTop + ed.src.clientHeight - 40) ed.src.scrollTop = Math.max(0, y - ed.src.clientHeight / 3);
}

// ------------------------------------------------------------------ assemble / load
function entryOf(r) { return r.segments.some((x) => x.start === 0) ? 0 : r.start; }

function assembleOnly() {
  const s = cur();
  const r = def().asm(s.src);
  s.asm = r;
  s.errLines = new Set(r.errors.map((e) => e.line));
  s.lineOfAddr = new Map(); s.addrOfLine = new Map();
  for (const e of r.listing) if (e.addr !== null && e.bytes.length) { if (!s.lineOfAddr.has(e.addr)) s.lineOfAddr.set(e.addr, e.line); s.addrOfLine.set(e.line, e.addr); }
  renderProblems();
  renderListing();
  renderGutter();
  return r;
}

function assembleAndLoad() {
  const s = cur();
  stopRun(true);
  const r = assembleOnly();
  if (r.errors.length) {
    setStatus(`${r.errors.length} error${r.errors.length > 1 ? "s" : ""}: line ${r.errors[0].line}: ${r.errors[0].msg}`, "err");
    selectLeft("code");
    scrollToLine(r.errors[0].line);
    return false;
  }
  const k = s.kit;
  k.clearMemory();
  k.reset();
  k.load(r.bytes, r.segments);
  if (s.exp && s.exp.setup) s.exp.setup(k);
  const entry = entryOf(r);
  if (s.name === "8085") {
    k.cpu.pc = entry;
    k.mon.mode = "ready"; k.mon.addr = hex(entry, 4); k.mon.data = hex(k.cpu.mem[entry], 2);
  } else k.cpu.pc = entry;
  s.loaded = true;
  s.prevSnap = null;
  const bytes = r.segments.reduce((n, x) => n + x.end - x.start, 0);
  setStatus(`Assembled: ${bytes} byte${bytes === 1 ? "" : "s"} loaded${r.warnings.length ? ", " + r.warnings.length + " warning(s)" : ""}. PC = ${hex(entry, 4)}H`);
  updateCursorLine();
  return true;
}

function updateCursorLine() {
  const s = cur();
  const pc = def().pc(s.kit);
  const line = s.lineOfAddr.get(pc) || 0;
  if (line !== s.pcLine) { s.pcLine = line; renderGutter(); if (line && !app.run.running) scrollToLine(line); }
  placeCurLine();
}

function renderProblems() {
  const s = cur();
  const box = $("problems");
  const r = s.asm;
  box.innerHTML = "";
  if (!r) return;
  const items = [...r.errors.map((e) => ({ ...e, k: "error" })), ...r.warnings.map((e) => ({ ...e, k: "warning" }))];
  for (const it of items) box.append(h("div", { class: "diag " + it.k, onclick: () => { if (it.line) { scrollToLine(it.line); ed.src.focus(); } } }, h("b", { text: it.line ? `Line ${it.line}: ` : "" }), it.msg));
  const b = $("stprob");
  b.textContent = r.errors.length ? `${r.errors.length} error${r.errors.length > 1 ? "s" : ""}` : r.warnings.length ? `${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""}` : "";
  b.className = "problems-badge " + (r.errors.length ? "bad" : "warn");
  box.hidden = items.length === 0;
}

function renderListing() {
  const s = cur();
  const r = s.asm;
  const pre = $("listing");
  if (!r) { pre.textContent = "Assemble the program to see the listing."; return; }
  const lines = [];
  lines.push("ADDR  BYTES           LINE  SOURCE");
  for (const e of r.listing) {
    const a = e.addr !== null && e.bytes.length ? hex(e.addr, 4) : "    ";
    const b = e.bytes.slice(0, 4).map((x) => hex(x)).join(" ").padEnd(11) + (e.bytes.length > 4 ? "+" : " ");
    lines.push(`${a}  ${b}   ${String(e.line).padStart(4)}  ${e.src}${e.error ? "      <-- " + e.error : ""}`);
  }
  const syms = [...r.symbols.entries()].filter(([n]) => !PREDEF_SKIP.has(n) && !(app.kitName === "8051" && PREDEF_8051.has(n)));
  if (syms.length) {
    lines.push("", "SYMBOLS");
    for (const [n, v] of syms.sort((a, b) => a[1] - b[1])) lines.push(`${hex(v, 4)}  ${n}`);
  }
  pre.textContent = lines.join("\n");
}
const PREDEF_SKIP = new Set();
const PREDEF_8051 = new Set("P0 SP DPL DPH PCON TCON TMOD TL0 TL1 TH0 TH1 P1 SCON SBUF P2 IE P3 IP PSW ACC B IT0 IE0 IT1 IE1 TR0 TF0 TR1 TF1 RI TI RB8 TB8 REN SM2 SM1 SM0 EX0 ET0 EX1 ET1 ES EA PX0 PT0 PX1 PT1 PS RXD TXD INT0 INT1 T0 T1 WR RD P OV RS0 RS1 F0 AC CY".split(" "));

// ------------------------------------------------------------------ board (modules)
function build8085Board(k) {
  const mods = [];
  const add = (m, ...ws) => { mods.push({ el: m, ws }); };
  // monitor
  const disp = charDisplay({ n: 6, tints: ["", "", "", "", "data", "data"], get: (kit) => kit.display() });
  const modeLbl = h("div", { class: "hint", text: "" });
  const keys = monitorKeys({ onKey: (key) => { k.key(key); if (k.mon.running && !app.run.running) startRun(true); refreshAll(true); } });
  add(mod("Keypad monitor", "address | data", h("div", { class: "mon" }, disp.el, modeLbl, keys.el), "wide"), disp, { update: (kit) => { const m = kit.mon; const t = m.running ? (m.prog ? "program is driving the display" : "program running") : { reset: "Reset. Press EXAM to enter an address.", ready: "Ready. EXAM = memory, REG = registers, GO = run, STEP = one instruction.", addr: "Type the address, then NEXT.", data: "Type data, NEXT stores and advances, PREV goes back.", go: "Type the start address, then EXEC.", reg: "NEXT/PREV selects a register, type to change it." }[m.mode]; if (modeLbl.textContent !== t) modeLbl.textContent = t; } });
  // interrupts
  const sod = h("i", { class: "led red" });
  const intState = h("div", { class: "hint" });
  const intSel = h("select", { title: "Instruction placed on the data bus when INTR is acknowledged", onchange: (e) => { k.intrOp = 0xc7 | (+e.target.value << 3); } }, [1, 2, 3, 4, 5, 6, 7].map((n) => h("option", { value: n, text: `RST ${n} (${hex(n * 8, 4)}H)` })));
  intSel.value = "7";
  const sidBtn = h("button", { class: "tog", type: "button", text: "SID = 0", onclick: () => { k.setSid(k.cpu.sid ? 0 : 1); } });
  const ib = pushButtons({ labels: ["TRAP", "RST 7.5", "RST 6.5", "RST 5.5", "INTR"], onDown: (i, t) => k.pressInt(["TRAP", "7.5", "6.5", "5.5", "INTR"][i], true), onUp: (i) => k.pressInt(["TRAP", "7.5", "6.5", "5.5", "INTR"][i], false) });
  add(mod("Interrupts and serial pins", "hold a button to keep the pin active", h("div", {}, ib.el, h("div", { class: "rowl" }, h("span", { text: "INTR vector" }), intSel), h("div", { class: "rowl" }, sidBtn, h("span", { text: "SOD" }), sod), intState)), { update: (kit) => { const c = kit.cpu; sod.style.setProperty("--b", c.sod); sidBtn.textContent = "SID = " + c.sid; sidBtn.classList.toggle("on", !!c.sid); const t = `IE=${c.ie} mask 7.5/6.5/5.5 = ${c.m75}${c.m65}${c.m55} | pending 7.5=${c.r75} 6.5=${c.pin65} 5.5=${c.pin55}`; if (intState.textContent !== t) intState.textContent = t; } });
  // PPI1
  const leds = ledRow({ names: ["PA0", "PA1", "PA2", "PA3", "PA4", "PA5", "PA6", "PA7"], get: (kit) => kit.led.read(kit.t) });
  const dip = dipRow({ names: ["PB0", "PB1", "PB2", "PB3", "PB4", "PB5", "PB6", "PB7"], get: (kit) => kit.dip, set: (i) => { k.dip ^= 1 << i; } });
  const pbs = pushButtons({ labels: ["PC0", "PC1", "PC2", "PC3"], onDown: (i) => { k.pb |= 1 << i; }, onUp: (i) => { k.pb &= ~(1 << i); } });
  add(mod("8255 #1 (ports 00H-03H)", "LEDs on PA, switches on PB, buttons on PC0-3", h("div", {}, h("div", { class: "lbl", text: "LED bar (PA)" }), leds.el, h("div", { class: "lbl", text: "DIP switches (PB)" }), dip.el, h("div", { class: "lbl", text: "Push buttons (PC0-3)" }), pbs.el)), leds, dip);
  // PPI2
  const seg = sevenSeg({ digits: 8, get: (kit) => kit.seg.read(kit.t) });
  const inv = h("label", { class: "chkl" }, h("input", { type: "checkbox", onchange: (e) => { k.seg.inv = e.target.checked; } }), "common anode (segments active low)");
  const kp = hexKeypad({ onChange: (key, on) => { if (on) k.kp.pressed.add(key); else k.kp.pressed.delete(key); } });
  add(mod("8255 #2 (ports 10H-13H)", "PA segments, PB digit select, PC keypad", h("div", {}, seg.el, inv, h("div", { class: "lbl", text: "4x4 keypad (rows PC0-3, columns PC4-7)" }), kp.el), "wide"), seg);
  // PPI3 motors
  const st = stepperWidget(), dc = dcMotorWidget(), rl = relayWidget();
  const bz = h("div", { class: "hint" });
  add(mod("8255 #3 (ports 20H-23H)", "PA0-3 stepper, PA4 relay, PA5 buzzer, PC0 motor, PC1 direction", h("div", { class: "trio" }, h("div", {}, h("div", { class: "lbl", text: "Stepper (PA0-3)" }), st.el), h("div", {}, h("div", { class: "lbl", text: "DC motor (PC0-1)" }), dc.el), h("div", {}, h("div", { class: "lbl", text: "Relay (PA4)" }), rl.el), bz), "wide"), st, dc, rl, { update: (kit) => { const f = kit.buzz.freq(kit.t); audio.tone("buzz", f); const t = f ? `buzzer ${f.toFixed(0)} Hz` : "buzzer silent"; if (bz.textContent !== t) bz.textContent = t; } });
  const tr = trafficWidget();
  add(mod("Traffic light (8255 #3 port B)", "PB0-2 road 1 R/Y/G, PB3-5 road 2 R/Y/G", tr.el), tr);
  // DAC / ADC
  const sc = scopeWidget(), ad = adcWidget();
  add(mod("DAC (port 30H) and ADC0809 (ports 40H/41H)", "scope shows the DAC output", h("div", { class: "split" }, sc.el, ad.el), "wide"), sc, ad);
  // 8253
  mods.push(pitModule(k));
  // USART
  const tm = terminalWidget({ send: (c) => k.usart.receive(c) });
  const us = h("div", { class: "hint" });
  add(mod("8251 USART terminal (ports 60H/61H)", "typed characters arrive in the receiver", h("div", {}, tm.el, us)), tm, { update: (kit) => { const t = `status ${hex(kit.usart.status(kit.t))}H (TxRDY=${kit.usart.status(kit.t) & 1} RxRDY=${(kit.usart.status(kit.t) >> 1) & 1})`; if (us.textContent !== t) us.textContent = t; } });
  const lcd = lcdWidget();
  add(mod("LCD 16x2 (ports 70H command/status, 71H data)", "HD44780 controller", lcd.el), lcd);
  return mods;
}

function pitModule(k) {
  const rows = [];
  const tbl = h("table", { class: "t pit" }, h("thead", {}, h("tr", {}, ["Counter", "Mode", "Count", "Current", "OUT", "GATE", "CLK"].map((x) => h("th", { text: x })))));
  const body = h("tbody");
  for (let i = 0; i < 3; i++) {
    const mode = h("td"), cnt = h("td"), curv = h("td"), out = h("i", { class: "led green" });
    const gate = h("button", { class: "tog on", type: "button", text: "1", title: "GATE input", onclick: () => { k.pit.setGate(i, k.pit.gate[i] ? 0 : 1); } });
    const clk = h("td", { text: i === 0 ? "1.5 MHz" : "1.5 MHz" });
    rows.push({ mode, cnt, curv, out, gate, clk });
    body.append(h("tr", {}, h("td", { text: "Counter " + i }), mode, cnt, curv, h("td", {}, out), h("td", {}, gate), clk));
  }
  tbl.append(body);
  const sel = h("select", { onchange: (e) => { k.irqOut0 = e.target.value; k.cpu.pin65 = 0; k.cpu.pin55 = 0; } }, ["6.5", "7.5", "5.5", "none"].map((x) => h("option", { value: x, text: x === "none" ? "not connected" : "RST " + x })));
  const c1 = h("label", { class: "chkl" }, h("input", { type: "checkbox", onchange: (e) => { k.pit.cascade[0] = e.target.checked; } }), "OUT0 → CLK1");
  const c2 = h("label", { class: "chkl" }, h("input", { type: "checkbox", onchange: (e) => { k.pit.cascade[1] = e.target.checked; } }), "OUT1 → CLK2");
  const ae = h("label", { class: "chkl" }, h("input", { type: "checkbox", onchange: (e) => { k.adcIrq = e.target.checked; } }), "ADC EOC → RST 5.5");
  const snd = h("button", { class: "tog sndtog", type: "button", onclick: () => toggleSound() }, "Sound: off");
  const fr = h("div", { class: "hint" });
  const names = ["mode 0 interrupt on terminal count", "mode 1 one-shot", "mode 2 rate generator", "mode 3 square wave", "mode 4 software strobe", "mode 5 hardware strobe"];
  return {
    el: mod("8253 timer (ports 50H-53H)", "clock 1.5 MHz", h("div", {}, tbl, h("div", { class: "rowl" }, h("span", { text: "OUT0 drives" }), sel), h("div", { class: "rowl wrap" }, c1, c2, ae), h("div", { class: "rowl" }, snd, fr)), "wide"),
    ws: [{
      update(kit) {
        for (let i = 0; i < 3; i++) {
          const c = kit.pit.c[i], r = rows[i];
          const m = c.loaded ? `${c.mode}` : "-";
          if (r.mode.textContent !== m) { r.mode.textContent = m; r.mode.title = c.loaded ? names[c.mode] : ""; }
          const cs = c.loaded ? hex(c.count === 0 ? 0 : c.count, 4) + "H" : "-";
          if (r.cnt.textContent !== cs) r.cnt.textContent = cs;
          const cv = hex(c.cur & 0xffff, 4) + "H";
          if (r.curv.textContent !== cv) r.curv.textContent = cv;
          r.out.style.setProperty("--b", c.out);
          const g = String(kit.pit.gate[i]);
          if (r.gate.textContent !== g) { r.gate.textContent = g; r.gate.classList.toggle("on", g === "1"); }
        }
        const f = kit.spk.freq(kit.t);
        audio.tone("spk", f);
        const t = f ? `OUT1 ≈ ${f.toFixed(0)} Hz` : "OUT1 not toggling";
        if (fr.textContent !== t) fr.textContent = t;
      },
    }],
  };
}

function toggleSound() {
  if (audio.on) audio.disable(); else if (!audio.enable()) { toast("Audio is not available in this browser"); return; }
  document.querySelectorAll(".sndtog").forEach((b) => { b.textContent = "Sound: " + (audio.on ? "on" : "off"); b.classList.toggle("on", audio.on); });
}

function build8051Board(k) {
  const mods = [];
  const add = (m, ...ws) => { mods.push({ el: m, ws }); };
  const leds = ledRow({ names: ["P0.0", "P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7"], get: (kit) => kit.led.read(kit.t) });
  const l2 = ledRow({ n: 2, names: ["P3.6", "P3.7"], color: "yellow", get: (kit) => kit.led2.read(kit.t) });
  const dip = dipRow({ names: ["P1.0", "P1.1", "P1.2", "P1.3", "P1.4", "P1.5", "P1.6", "P1.7"], get: (kit) => kit.dip, set: (i) => k.setDip(k.dip ^ (1 << i)) });
  add(mod("Ports P0, P1 and P3.6-7", "LED bar on P0, DIP switches on P1", h("div", {}, h("div", { class: "lbl", text: "LED bar (P0)" }), leds.el, h("div", { class: "lbl", text: "DIP switches (P1), ON = 1" }), dip.el, h("div", { class: "lbl", text: "Spare LEDs (P3.6, P3.7)" }), l2.el)), leds, dip, l2);
  const lcd = lcdWidget();
  add(mod("LCD 16x2 (MOVX C000H-C003H)", "C000 command, C001 data, C002 status, C003 read data", lcd.el, "wide"), lcd);
  const seg = sevenSeg({ digits: 4, get: (kit) => kit.seg.read(kit.t) });
  const inv = h("label", { class: "chkl" }, h("input", { type: "checkbox", onchange: (e) => { k.seg.inv = e.target.checked; } }), "common anode (segments active low)");
  const kp = hexKeypad({ onChange: (key, on) => { if (on) k.kp.pressed.add(key); else k.kp.pressed.delete(key); } });
  add(mod("8255 #1 (MOVX 8000H-8003H)", "PA segments, PB digit select (PB0-3), PC keypad", h("div", {}, seg.el, inv, h("div", { class: "lbl", text: "4x4 keypad (rows PC0-3, columns PC4-7)" }), kp.el)), seg);
  const st = stepperWidget(), dc = dcMotorWidget(), rl = relayWidget();
  const bz = h("div", { class: "hint" });
  const snd = h("button", { class: "tog sndtog", type: "button", onclick: () => toggleSound() }, "Sound: off");
  add(mod("Port P2 drivers", "P2.0-3 stepper, P2.4 relay, P2.5 buzzer, P2.6 motor enable, P2.7 direction", h("div", { class: "trio" }, h("div", {}, h("div", { class: "lbl", text: "Stepper (P2.0-3)" }), st.el), h("div", {}, h("div", { class: "lbl", text: "DC motor (P2.6-7)" }), dc.el), h("div", {}, h("div", { class: "lbl", text: "Relay (P2.4)" }), rl.el), h("div", {}, bz, snd)), "wide"), st, dc, rl, { update: (kit) => { const f = kit.buzz.freq(kit.t); audio.tone("buzz", f); const t = f ? `buzzer ${f.toFixed(0)} Hz` : "buzzer silent"; if (bz.textContent !== t) bz.textContent = t; } });
  const tr = trafficWidget();
  const bar = ledRow({ names: ["PB0", "PB1", "PB2", "PB3", "PB4", "PB5", "PB6", "PB7"], color: "green", get: (kit) => kit.bar.read(kit.t) });
  const pbs = pushButtons({ labels: ["PC0", "PC1", "PC2", "PC3"], onDown: (i) => { k.pb |= 1 << i; }, onUp: (i) => { k.pb &= ~(1 << i); } });
  add(mod("8255 #2 (MOVX 9000H-9003H)", "PA0-5 traffic light, PB bar LEDs, PC0-3 push buttons", h("div", {}, tr.el, h("div", { class: "lbl", text: "Bar LEDs (PB)" }), bar.el, h("div", { class: "lbl", text: "Push buttons (PC0-3)" }), pbs.el)), tr, bar);
  const ib = pushButtons({ labels: ["INT0 (P3.2)", "INT1 (P3.3)", "T1 (P3.5)"], onDown: (i) => k.button(["int0", "int1", "t1"][i], true), onUp: (i) => k.button(["int0", "int1", "t1"][i], false) });
  const pg = h("label", { class: "chkl" }, h("input", { type: "checkbox", onchange: (e) => { k.pulse.on = e.target.checked; } }), "pulse generator on T0 (P3.4)");
  const pf = h("select", { onchange: (e) => { k.pulse.hz = +e.target.value; } }, [1, 5, 10, 50, 100, 500, 1000, 2000, 5000, 10000, 50000].map((f) => h("option", { value: f, text: f >= 1000 ? f / 1000 + " kHz" : f + " Hz" })));
  pf.value = "1000";
  const crystal = h("select", { onchange: (e) => { k.fosc = +e.target.value; } }, [["11059200", "11.0592 MHz (9600 baud)"], ["12000000", "12 MHz"], ["6000000", "6 MHz"]].map(([v, t]) => h("option", { value: v, text: t })));
  const info = h("div", { class: "hint" });
  add(mod("Interrupt and timer inputs", "buttons pull the pin low while held", h("div", {}, ib.el, h("div", { class: "rowl wrap" }, pg, pf), h("div", { class: "rowl" }, h("span", { text: "Crystal" }), crystal), info)), { update: (kit) => { const t = `T0 count ${hex(kit.cpu.sfr[0x0c] << 8 | kit.cpu.sfr[0x0a], 4)}H | INT0=${(kit.cpu.ext[3] >> 2) & 1} INT1=${(kit.cpu.ext[3] >> 3) & 1}`; if (info.textContent !== t) info.textContent = t; } });
  const sc = scopeWidget(), ad = adcWidget();
  add(mod("DAC (MOVX A000H) and ADC0809 (B000H data, B001H EOC)", "scope shows the DAC output", h("div", { class: "split" }, sc.el, ad.el), "wide"), sc, ad);
  const tm = terminalWidget({ send: (c) => k.typeChar(c) });
  const ts = h("div", { class: "hint" });
  add(mod("UART terminal (P3.0 RXD / P3.1 TXD)", "needs SCON, Timer 1 and TR1 set up by your program", h("div", {}, tm.el, ts)), tm, { update: (kit) => { const c = kit.cpu; const t = `SCON=${hex(c.g(0x98))}H TH1=${hex(c.g(0x8d))}H RI=${c.g(0x98) & 1} TI=${(c.g(0x98) >> 1) & 1}`; if (ts.textContent !== t) ts.textContent = t; } });
  return mods;
}

function mountBoard() {
  const s = cur();
  const board = $("board");
  board.innerHTML = "";
  if (!s.board) s.board = app.kitName === "8085" ? build8085Board(s.kit) : build8051Board(s.kit);
  for (const m of s.board) board.append(m.el instanceof Node ? m.el : m.el);
  app.boardUpdates = s.board.flatMap((m) => m.ws);
}

// ------------------------------------------------------------------ state panes
const REGDEFS = {
  8085: (k) => {
    const c = k.cpu;
    return [
      { title: "Registers", cells: [["A", () => hex(c.r[7])], ["B", () => hex(c.r[0])], ["C", () => hex(c.r[1])], ["D", () => hex(c.r[2])], ["E", () => hex(c.r[3])], ["H", () => hex(c.r[4])], ["L", () => hex(c.r[5])], ["M", () => hex(c.mem[c.hl])]] },
      { title: "Pairs", cells: [["BC", () => hex(c.bc, 4)], ["DE", () => hex(c.de, 4)], ["HL", () => hex(c.hl, 4)], ["SP", () => hex(c.sp, 4)], ["PC", () => hex(c.pc, 4)], ["F", () => hex(c.f)]] },
      { title: "Flags", cells: [["S", () => c.s], ["Z", () => c.z], ["AC", () => c.ac], ["P", () => c.p], ["CY", () => c.cy]] },
      { title: "Interrupts", cells: [["IE", () => c.ie], ["M7.5", () => c.m75], ["M6.5", () => c.m65], ["M5.5", () => c.m55], ["I7.5", () => c.r75], ["SOD", () => c.sod], ["SID", () => c.sid], ["HLT", () => (c.halted ? 1 : 0)]] },
      { title: "Counters", cells: [["Instr", () => String(c.icount)], ["T-states", () => String(c.tstates)], ["Time", () => (k.t * 1000).toFixed(3) + " ms"], ["Last", () => disasm8085(c.mem, c.lastPc).text]], wide: true },
    ];
  },
  8051: (k) => {
    const c = k.cpu;
    const g = (a) => hex(c.g(a));
    return [
      { title: "Core", cells: [["A", () => hex(c.acc)], ["B", () => hex(c.b)], ["PSW", () => hex(c.psw)], ["SP", () => hex(c.sp)], ["DPTR", () => hex(c.dptr, 4)], ["PC", () => hex(c.pc, 4)]] },
      { title: "PSW flags", cells: [["CY", () => (c.psw >> 7) & 1], ["AC", () => (c.psw >> 6) & 1], ["F0", () => (c.psw >> 5) & 1], ["RS1", () => (c.psw >> 4) & 1], ["RS0", () => (c.psw >> 3) & 1], ["OV", () => (c.psw >> 2) & 1], ["P", () => c.psw & 1]] },
      { title: "Registers (bank " + 0 + ")", dyn: () => "Registers (bank " + (c.bank >> 3) + ")", cells: [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ["R" + n, () => hex(c.R(n))]) },
      { title: "Timers", cells: [["TMOD", () => g(0x89)], ["TCON", () => g(0x88)], ["TH0", () => g(0x8c)], ["TL0", () => g(0x8a)], ["TH1", () => g(0x8d)], ["TL1", () => g(0x8b)]] },
      { title: "Interrupts and serial", cells: [["IE", () => g(0xa8)], ["IP", () => g(0xb8)], ["SCON", () => g(0x98)], ["SBUF", () => hex(c.sbufRx)], ["PCON", () => g(0x87)], ["ISR lvl", () => (c.isr.length ? String(c.isr[c.isr.length - 1]) : "-")]] },
      { title: "Ports (latch / pin)", cells: [0, 1, 2, 3].map((n) => ["P" + n, () => hex(c.sfr[n * 0x10]) + " / " + hex(c.sfr[n * 0x10] & c.ext[n])]), wide: true },
      { title: "Counters", cells: [["Instr", () => String(c.icount)], ["Cycles", () => String(c.cycles)], ["Time", () => (k.t * 1000).toFixed(3) + " ms"], ["Last", () => disasm8051(c.code, c.lastPc).text]], wide: true },
    ];
  },
};

function buildCpuPane() {
  const s = cur(), box = $("pgCpu");
  box.innerHTML = "";
  const groups = REGDEFS[app.kitName](s.kit);
  const cells = [];
  for (const g of groups) {
    const gh = h("h5", { text: g.title });
    const grid = h("div", { class: "regs" + (g.wide ? " wide" : "") });
    for (const [name, fn] of g.cells) {
      const v = h("b", { text: "" });
      grid.append(h("div", { class: "reg" }, h("span", { text: name }), v));
      cells.push({ v, fn, last: null, t: 0 });
    }
    box.append(gh, grid);
    g.hd = gh;
  }
  app.cpuCells = cells;
  app.cpuGroups = groups;
}
function updateCpuPane(now) {
  for (const c of app.cpuCells || []) {
    const v = String(c.fn());
    if (v !== c.last) {
      c.v.textContent = v;
      if (c.last !== null) { c.v.classList.add("chg"); c.t = now; }
      c.last = v;
    } else if (c.t && now - c.t > 500) { c.v.classList.remove("chg"); c.t = 0; }
  }
  for (const g of app.cpuGroups || []) if (g.dyn) { const t = g.dyn(); if (g.hd.textContent !== t) g.hd.textContent = t; }
}

// memory pane
const SPACES = {
  8085: { mem: { name: "Memory (RAM)", size: 65536, get: (k, a) => k.cpu.mem[a], set: (k, a, v) => { k.cpu.mem[a] = v; } } },
  8051: {
    iram: { name: "Internal RAM", size: 256, get: (k, a) => k.cpu.iram[a], set: (k, a, v) => { k.cpu.iram[a] = v; } },
    sfr: { name: "SFR (80H-FFH)", size: 256, base: 0x80, get: (k, a) => (a >= 0x80 ? k.cpu.readDir(a, true) : 0), set: (k, a, v) => { if (a >= 0x80) k.cpu.writeDir(a, v); } },
    code: { name: "Code memory", size: 65536, get: (k, a) => k.cpu.code[a], set: (k, a, v) => { k.cpu.code[a] = v; } },
    xdata: { name: "External data RAM", size: 65536, get: (k, a) => k.cpu.xdata[a], set: (k, a, v) => { k.cpu.xdata[a] = v; } },
  },
};
const SFR_NAMES = { 0x80: "P0", 0x81: "SP", 0x82: "DPL", 0x83: "DPH", 0x87: "PCON", 0x88: "TCON", 0x89: "TMOD", 0x8a: "TL0", 0x8b: "TL1", 0x8c: "TH0", 0x8d: "TH1", 0x90: "P1", 0x98: "SCON", 0x99: "SBUF", 0xa0: "P2", 0xa8: "IE", 0xb0: "P3", 0xb8: "IP", 0xd0: "PSW", 0xe0: "ACC", 0xf0: "B" };

function buildMemPane() {
  const s = cur(), box = $("pgMem");
  box.innerHTML = "";
  const spaces = SPACES[app.kitName];
  const sel = h("select", { onchange: (e) => { s.memSpace = e.target.value; s.memBase = spaces[s.memSpace].base ?? 0; buildMemPane(); } }, Object.entries(spaces).map(([id, sp]) => h("option", { value: id, text: sp.name })));
  sel.value = s.memSpace;
  const addr = h("input", { type: "text", class: "addrin", value: hex(s.memBase, 4), "aria-label": "address", onkeydown: (e) => { if (e.key === "Enter") go(); } });
  const go = () => { const v = parseInt(addr.value, 16); if (!isNaN(v)) { const sp = spaces[s.memSpace]; s.memBase = (v & ~0xff) % sp.size; if (sp.base) s.memBase = Math.max(sp.base, s.memBase); addr.value = hex(s.memBase, 4); app.memLast = null; app.memSel = v; buildGrid(); } };
  const nav = (d) => { const sp = spaces[s.memSpace]; s.memBase = (s.memBase + d + sp.size) % sp.size; if (sp.size === 256) s.memBase = sp.base || 0; addr.value = hex(s.memBase, 4); buildGrid(); };
  box.append(h("div", { class: "mbar" }, sel, h("button", { class: "rb sm", onclick: () => nav(-256), text: "◀" }), addr, h("button", { class: "rb sm", onclick: go, text: "Go" }), h("button", { class: "rb sm", onclick: () => nav(256), text: "▶" })));
  const grid = h("div", { class: "memgrid" });
  box.append(grid, h("div", { class: "hint", text: "Click a byte to edit it (hex). Pointers: PC, SP" + (app.kitName === "8085" ? ", HL" : ", R0/R1, DPTR") + "." }));
  function buildGrid() {
    grid.innerHTML = "";
    const sp = spaces[s.memSpace];
    app.memCells = [];
    grid.append(h("div", { class: "mh" }), ...Array.from({ length: 16 }, (_, i) => h("div", { class: "mh", text: i.toString(16).toUpperCase() })));
    const rows = sp.size === 256 && sp.base ? 8 : 16;
    for (let r = 0; r < rows; r++) {
      const ra = s.memBase + r * 16;
      grid.append(h("div", { class: "ma", text: hex(ra, 4) + (s.memSpace === "sfr" ? "" : "") }));
      for (let c = 0; c < 16; c++) {
        const a = ra + c;
        const cell = h("div", { class: "mb", "data-a": a, title: s.memSpace === "sfr" && SFR_NAMES[a] ? SFR_NAMES[a] : hex(a, 4) + "H" });
        cell.addEventListener("click", () => editByte(cell, a));
        grid.append(cell);
        app.memCells.push({ cell, a, last: -1, t: 0 });
      }
    }
    app.memLast = null;
  }
  function editByte(cell, a) {
    if (cell.querySelector("input")) return;
    const sp = spaces[s.memSpace];
    const inp = h("input", { type: "text", value: hex(sp.get(s.kit, a)), class: "bedit", maxlength: 2 });
    cell.textContent = "";
    cell.append(inp);
    inp.focus(); inp.select();
    const done = (save) => {
      if (save) { const v = parseInt(inp.value, 16); if (!isNaN(v)) { sp.set(s.kit, a, v & 255); s.loaded = true; } }
      inp.remove();
      const m = app.memCells.find((x) => x.a === a); if (m) m.last = -1;
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") done(true); else if (e.key === "Escape") done(false); });
    inp.addEventListener("blur", () => done(true));
  }
  buildGrid();
  app.buildMemGrid = buildGrid;
}
function updateMemPane(now) {
  const s = cur(), sp = SPACES[app.kitName][s.memSpace], k = s.kit;
  if (!sp || !app.memCells) return;
  const ptrs = new Map();
  const pc = def().pc(k);
  if (app.kitName === "8085") { ptrs.set(k.cpu.sp, "sp"); ptrs.set(k.cpu.hl, "hl"); if (s.memSpace === "mem") ptrs.set(pc, "pc"); }
  else {
    if (s.memSpace === "code") ptrs.set(pc, "pc");
    if (s.memSpace === "iram") { ptrs.set(k.cpu.sp, "sp"); ptrs.set(k.cpu.R(0), "hl"); ptrs.set(k.cpu.R(1), "hl"); }
    if (s.memSpace === "xdata") ptrs.set(k.cpu.dptr, "hl");
  }
  for (const m of app.memCells) {
    if (m.asc) {
      let t = "";
      for (let c = 0; c < 16; c++) { const v = sp.get(k, m.ra + c); t += v >= 32 && v < 127 ? String.fromCharCode(v) : "·"; }
      if (t !== m.last) { m.asc.textContent = t; m.last = t; }
      continue;
    }
    if (m.cell.querySelector("input")) continue;
    const v = sp.get(k, m.a);
    const p = ptrs.get(m.a) || "";
    if (v !== m.last) {
      m.cell.textContent = hex(v);
      if (m.last !== -1) { m.cell.classList.add("chg"); m.t = now; }
      m.last = v;
    } else if (m.t && now - m.t > 600) { m.cell.classList.remove("chg"); m.t = 0; }
    if (m.p !== p) { m.p = p; m.cell.dataset.p = p; }
  }
}

// disassembly pane
function buildDisPane() {
  const box = $("pgDis");
  box.innerHTML = "";
  box.append(h("div", { class: "hint", text: "Click the dot in front of an instruction to set a breakpoint." }), h("div", { class: "dis", id: "disBody" }));
}
function updateDisPane() {
  const s = cur(), k = s.kit, pc = def().pc(k);
  const body = $("disBody");
  if (!body) return;
  // anchor at an instruction boundary from the assembled listing, else at PC
  const starts = s.asm ? [...s.lineOfAddr.keys()].sort((a, b) => a - b) : [];
  let from = pc;
  const idx = starts.indexOf(pc);
  if (idx >= 0) from = starts[Math.max(0, idx - 4)];
  const key = pc + ":" + from + ":" + [...s.bps].join(",") + ":" + (app.kitName === "8085" ? k.cpu.mem[pc] : k.cpu.code[pc]);
  if (app.dis === key) return;
  app.dis = key;
  body.innerHTML = "";
  let a = from;
  for (let i = 0; i < 20; i++) {
    const d = def().dis(k, a);
    const bytes = [];
    const src = app.kitName === "8085" ? k.cpu.mem : k.cpu.code;
    for (let j = 0; j < d.len; j++) bytes.push(hex(src[(a + j) & 0xffff]));
    const line = s.lineOfAddr.get(a);
    const row = h("div", { class: "drow" + (a === pc ? " pc" : "") + (s.bps.has(a) ? " bp" : "") }, h("button", { class: "bpdot", title: "Toggle breakpoint", onclick: ((aa) => () => toggleBpAddr(aa))(a) }), h("span", { class: "da", text: hex(a, 4) }), h("span", { class: "db", text: bytes.join(" ") }), h("span", { class: "dm", text: d.text }), line ? h("span", { class: "dl", text: "L" + line }) : null);
    body.append(row);
    a = (a + d.len) & 0xffff;
  }
}

// chips pane
function updateIoPane(now) {
  const s = cur(), k = s.kit, box = $("pgIo");
  if (now - (app.ioT || 0) < 150 || app.tab.right !== "io") return;
  app.ioT = now;
  const rows = [];
  const ppiRow = (p) => {
    const ctrl = p.configured ? hex(p.ctrl) + "H" : "not set";
    const dir = (inn) => (inn ? "in" : "out");
    return `<tr><td>${p.name}</td><td>${ctrl}</td><td>A ${dir(p.aIn)} ${hex(p.la)}</td><td>B ${dir(p.bIn)} ${hex(p.lb)}</td><td>C ${dir(p.cuIn)}/${dir(p.clIn)} ${hex(p.lc)}</td></tr>${p.badMode ? '<tr><td colspan="5" class="warn">mode 1/2 requested: only mode 0 and BSR are emulated</td></tr>' : ""}`;
  };
  rows.push(`<h5>8255 PPI</h5><table class="t"><thead><tr><th>Chip</th><th>Control</th><th>Port A</th><th>Port B</th><th>Port C</th></tr></thead><tbody>${k.ppi.map(ppiRow).join("")}</tbody></table>`);
  if (app.kitName === "8085") {
    rows.push(`<h5>8251 USART</h5><div class="mono">status ${hex(k.usart.status(k.t))}H | mode ${hex(k.usart.mode)}H command ${hex(k.usart.cmd)}H | RX queue ${k.usart.rx.length}</div>`);
    rows.push(`<h5>I/O log (last 14)</h5><div class="mono log">${k.ioLog.slice(-14).reverse().map((e) => `${(e[2] * 1000).toFixed(3)} ms  OUT ${hex(e[0])}H ← ${hex(e[1])}H`).join("<br>") || "nothing yet"}</div>`);
    rows.push(`<h5>DAC</h5><div class="mono">code ${hex(k.dac.code)}H = ${k.dac.volts.toFixed(3)} V</div>`);
  } else {
    rows.push(`<h5>LCD controller</h5><div class="mono">DDRAM addr ${hex(k.lcd.addr & 0x7f)}H | display ${k.lcd.on ? "on" : "off"} cursor ${k.lcd.cur} blink ${k.lcd.blink} | ${k.lcd.lines2 ? "2 lines" : "1 line"} | ignored ${k.lcd.ignored}</div>`);
    rows.push(`<h5>Port writes (last 10)</h5><div class="mono log">${k.portLog.slice(-10).reverse().map((e) => `${(e[2] * 1000).toFixed(3)} ms  P${e[0]} ← ${hex(e[1])}H`).join("<br>") || "nothing yet"}</div>`);
    rows.push(`<h5>External bus writes (last 10)</h5><div class="mono log">${k.xLog.slice(-10).reverse().map((e) => `${(e[2] * 1000).toFixed(3)} ms  [${hex(e[0], 4)}H] ← ${hex(e[1])}H`).join("<br>") || "nothing yet"}</div>`);
  }
  box.innerHTML = rows.join("");
}

// ------------------------------------------------------------------ experiments
function openExperiments() {
  const menu = $("exMenu");
  if (!menu.hidden) { menu.hidden = true; return; }
  const list = def().examples;
  menu.innerHTML = "";
  const search = h("input", { type: "search", placeholder: `Search ${list.length} ${app.kitName} experiments`, "aria-label": "search" });
  const body = h("div", { class: "exlist" });
  const draw = () => {
    body.innerHTML = "";
    const q = search.value.trim().toLowerCase();
    let group = null;
    for (const ex of list) {
      if (q && !(ex.title + " " + ex.group + " " + ex.aim).toLowerCase().includes(q)) continue;
      if (ex.group !== group) { group = ex.group; body.append(h("h4", { text: group })); }
      body.append(h("button", { class: "card" + (cur().exp === ex ? " on" : ""), onclick: () => { menu.hidden = true; selectExperiment(ex); } }, h("span", { class: "tx" }, h("b", { text: ex.title }))));
    }
    if (!body.children.length) body.append(h("div", { class: "empty", text: "No experiment matches." }));
  };
  search.addEventListener("input", draw);
  draw();
  menu.append(h("div", { class: "exhead" }, h("b", { text: `${app.kitName} experiments` }), h("span", { class: "mute", text: `${list.length} with automatic checking` })), search, body);
  const r = $("bEx").getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = r.bottom + 6 + "px";
  menu.hidden = false;
  search.focus();
}

function selectExperiment(ex) {
  const s = cur();
  stopRun(true);
  s.exp = ex;
  s.src = ex.code;
  store.set("src:" + s.name, s.src);
  ed.src.value = ex.code;
  s.bps.clear();
  assembleAndLoad();
  renderLab();
  selectLeft("lab");
  store.set("exp:" + s.name, ex.id);
  if (innerWidth <= 900) selectPane("mid");
}

function renderLab() {
  const s = cur(), box = $("pgLab"), ex = s.exp;
  box.innerHTML = "";
  if (!ex) {
    box.append(h("div", { class: "empty" }, h("h3", { text: "Pick an experiment" }), h("p", { text: `Open the Experiments menu to load one of ${def().examples.length} ${app.kitName} lab experiments. Each has an aim, theory, procedure, viva questions and an automatic result check.` })));
    return;
  }
  const verdict = h("div", { class: "verdict", hidden: true });
  const reload = () => { ed.src.value = ex.code; s.src = ex.code; store.set("src:" + s.name, s.src); assembleAndLoad(); };
  box.append(
    h("h3", { text: ex.title }), h("div", { class: "mute", text: ex.group }),
    h("h5", { text: "Aim" }), h("p", { text: ex.aim }),
    h("h5", { text: "Theory" }), h("p", { text: ex.theory }),
    h("h5", { text: "Procedure" }), h("ol", {}, ex.steps.map((x) => h("li", { text: x }))),
    h("h5", { text: "Viva questions" }), h("ul", {}, ex.questions.map((x) => h("li", { text: x }))),
    h("div", { class: "btnrow" }, h("button", { class: "rb", onclick: reload, text: "Reload original program" }), h("button", { class: "rb go", onclick: () => checkExperiment(ex, verdict), text: "Check my result" })),
    verdict,
  );
}

function checkExperiment(ex, verdict) {
  const s = cur();
  const d = def();
  const r = d.asm(s.src);
  verdict.hidden = false;
  if (r.errors.length) { verdict.className = "verdict bad"; verdict.textContent = `The program does not assemble: line ${r.errors[0].line}: ${r.errors[0].msg}`; return; }
  const k = d.make();
  k.clearMemory(); k.reset(); k.load(r.bytes, r.segments);
  ex.setup && ex.setup(k);
  k.cpu.pc = entryOf(r);
  if (k.mon) k.mon.running = false;
  let c;
  try {
    k.run(ex.run ?? 2e6);
    c = ex.check(k);
  } catch (e) { c = { ok: false, msg: "check failed: " + e.message }; }
  verdict.className = "verdict " + (c.ok ? "ok" : "bad");
  verdict.textContent = (c.ok ? "PASS: " : "Not yet: ") + c.msg;
}

// ------------------------------------------------------------------ reference pane
function renderHelp() {
  $("pgHelp").innerHTML = REFERENCE[app.kitName];
}

// ------------------------------------------------------------------ run control
function setRunUi() {
  const r = app.run.running;
  const b = $("bRun");
  b.querySelector("span").textContent = r ? "Pause" : "Run";
  b.querySelector("use").setAttribute("href", r ? "#i-pause" : "#i-play");
  b.classList.toggle("go", !r);
  b.classList.toggle("warn", r);
}
function readSpeed() {
  const [t, v] = $("speed").value.split(":");
  if (t === "r") { app.run.ips = +v; app.run.mult = 0; } else { app.run.mult = +v; app.run.ips = 0; }
}
function startRun(skipAsm = false) {
  const s = cur();
  if (!skipAsm && !s.loaded && !assembleAndLoad()) return;
  readSpeed();
  const k = s.kit;
  if (app.kitName === "8085") { if (k.cpu.halted && !k.canWake()) k.cpu.halted = false; k.mon.running = true; k.mon.prog = false; }
  app.run.running = true;
  app.run.skipBp = true;
  app.run.ipsAcc = 0;
  app.run.simPrev = k.t;
  app.run.wallPrev = performance.now();
  setRunUi();
  setStatus("Running", "run");
}
function stopRun(silent) {
  const s = cur();
  if (app.run.running && !silent) setStatus(`Paused at ${hex(def().pc(s.kit), 4)}H`);
  app.run.running = false;
  app.run.tempBp = null;
  if (s && app.kitName === "8085" && s.kit.mon.running) s.kit.onProgramEnd();
  setRunUi();
}
function advanceRun(dtWall) {
  const s = cur(), k = s.kit, d = def(), r = app.run;
  const bps = r.tempBp !== null ? new Set([...s.bps, r.tempBp]) : s.bps;
  const t0 = performance.now();
  let reason = "budget";
  if (r.mult) {
    const mult = r.tempBp !== null ? 1000 : r.mult;
    let remaining = (dtWall / 1000) * mult * d.clock(k);
    let first = r.skipBp;
    while (remaining > 0 && performance.now() - t0 < 12) {
      const chunk = Math.min(remaining, 4000);
      const c0 = d.cycles(k);
      reason = k.run(chunk, bps, first);
      first = false;
      remaining -= Math.max(1, d.cycles(k) - c0);
      if (reason !== "budget") break;
    }
    r.skipBp = false;
  } else {
    r.ipsAcc += (dtWall / 1000) * r.ips;
    let n = Math.floor(r.ipsAcc);
    r.ipsAcc -= n;
    n = Math.min(n, 50);
    while (n-- > 0) {
      if (!r.skipBp && bps.has(d.pc(k))) { reason = "break"; break; }
      r.skipBp = false;
      if (k.cpu.halted && app.kitName === "8085" && !k.canWake()) { reason = "halt"; k.onProgramEnd(); break; }
      k.step();
    }
  }
  if (r.tempBp !== null && reason === "break" && d.pc(k) === r.tempBp) { r.tempBp = null; stopRun(); return; }
  if (reason === "break") { stopRun(true); setStatus(`Breakpoint at ${hex(d.pc(k), 4)}H`); }
  else if (reason === "halt") { stopRun(true); setStatus(`HLT at ${hex(k.cpu.pc - 1, 4)}H: program finished`); }
}
function stepOnce() {
  const s = cur();
  if (app.run.running) stopRun();
  if (!s.loaded && !assembleAndLoad()) return;
  const k = s.kit;
  if (app.kitName === "8085") { if (k.cpu.halted) k.cpu.halted = false; k.mon.running = false; }
  k.step();
  setStatus(`Stepped to ${hex(def().pc(k), 4)}H`);
  refreshAll(true);
}
function stepOver() {
  const s = cur();
  if (app.run.running) stopRun();
  if (!s.loaded && !assembleAndLoad()) return;
  const k = s.kit, len = def().isCall(k);
  if (!len) { stepOnce(); return; }
  app.run.tempBp = (def().pc(k) + len) & 0xffff;
  startRun();
  app.run.tempBp = (def().pc(k) + len) & 0xffff;
}
function resetCpu() {
  const s = cur();
  stopRun(true);
  const k = s.kit;
  if (app.kitName === "8085") k.softReset();
  else { const code = k.cpu.code.slice(), x = k.cpu.xdata.slice(); k.reset(); k.cpu.code.set(code); k.cpu.xdata.set(x); }
  if (s.exp && s.exp.setup && app.kitName === "8051") { /* data preset only applies on load */ }
  if (s.asm && !s.asm.errors.length) { const e = entryOf(s.asm); if (app.kitName === "8085") { k.cpu.pc = e; k.mon.mode = "ready"; k.mon.addr = hex(e, 4); k.mon.data = hex(k.cpu.mem[e], 2); } else k.cpu.pc = e; }
  setStatus("Reset: CPU and devices cleared, program kept");
  refreshAll(true);
}

// ------------------------------------------------------------------ file menu
function hexDump(r) {
  const out = [];
  const rec = (addr, type, data) => {
    const bytes = [data.length, addr >> 8, addr & 255, type, ...data];
    const sum = (256 - (bytes.reduce((a, b) => a + b, 0) & 255)) & 255;
    out.push(":" + [...bytes, sum].map((b) => hex(b)).join(""));
  };
  for (const seg of r.segments) for (let a = seg.start; a < seg.end; a += 16) rec(a, 0, Array.from(r.bytes.slice(a, Math.min(seg.end, a + 16))));
  rec(0, 1, []);
  return out.join("\n") + "\n";
}
function download(name, text, type = "text/plain") {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function openMore(e) {
  const m = $("moreMenu");
  if (!m.hidden) { m.hidden = true; return; }
  m.innerHTML = "";
  const item = (t, fn) => m.append(h("button", { onclick: () => { m.hidden = true; fn(); }, text: t }));
  item("Save program (.asm)", () => download(`program-${app.kitName}.asm`, cur().src));
  item("Open program from file", () => { const i = h("input", { type: "file", accept: ".asm,.s,.txt" }); i.onchange = async () => { const t = await i.files[0].text(); ed.src.value = t; ed.src.dispatchEvent(new Event("input")); cur().exp = null; renderLab(); }; i.click(); });
  item("Export Intel HEX", () => { if (assembleAndLoad()) download(`program-${app.kitName}.hex`, hexDump(cur().asm)); });
  m.append(h("hr"));
  item("Clear memory and reset", () => { stopRun(true); const k = cur().kit; k.clearMemory(); k.reset(); cur().loaded = false; setStatus("Memory cleared"); });
  item(audio.on ? "Turn sound off" : "Turn sound on", () => { toggleSound(); });
  item("Show all keyboard shortcuts", () => modal("<h3>Keyboard shortcuts</h3><p><kbd>F5</kbd> run / pause &nbsp; <kbd>F10</kbd> step &nbsp; <kbd>F8</kbd> step over &nbsp; <kbd>F7</kbd> assemble &nbsp; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> assemble and run</p><p>Click a line number to set or clear a breakpoint.</p>"));
  item("About this trainer", () => modal(`<h3>LEARNERS LAB trainer kits</h3><p>8085 and 8051 emulators with assemblers and interfacing boards, written for teaching. Timing is derived from instruction cycle counts (8085 at 3 MHz, 8051 at 11.0592 MHz) so delay loops behave like the real kit.</p><p>Not emulated: 8255 modes 1 and 2 (handshake), 8253 BCD counting, 8279 keyboard/display controller, 8051 timer 2 and external-memory bus timing.</p><p class="mute">VIN Technologies</p>`));
  const r = $("bMore").getBoundingClientRect();
  m.style.top = r.bottom + 6 + "px";
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - 240)) + "px";
  m.hidden = false;
  e.stopPropagation();
}
function modal(html) {
  $("modalbox").innerHTML = html + '<button class="rb" id="mclose">Close</button>';
  $("modal").hidden = false;
  $("mclose").onclick = () => { $("modal").hidden = true; };
}

// ------------------------------------------------------------------ tabs and layout
function selectLeft(t) {
  app.tab.left = t;
  document.querySelectorAll("#tabsLeft button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  $("pgCode").hidden = t !== "code"; $("pgList").hidden = t !== "list"; $("pgLab").hidden = t !== "lab"; $("pgHelp").hidden = t !== "help";
  if (t === "list") renderListing();
}
function selectRight(t) {
  app.tab.right = t;
  document.querySelectorAll("#tabsRight button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  $("pgCpu").hidden = t !== "cpu"; $("pgMem").hidden = t !== "mem"; $("pgDis").hidden = t !== "dis"; $("pgIo").hidden = t !== "io";
  app.dis = null; app.ioT = 0;
}
function selectPane(p) {
  document.body.dataset.p = p;
  document.querySelectorAll("#mtabs button").forEach((b) => b.classList.toggle("on", b.dataset.p === p));
}

// ------------------------------------------------------------------ kit switching
function switchKit(name) {
  if (!KITS[name]) return;
  if (app.run.running) stopRun(true);
  app.kitName = name;
  store.set("kit", name);
  document.querySelectorAll("#kitseg button").forEach((b) => b.classList.toggle("on", b.dataset.kit === name));
  document.body.dataset.kit = name;
  if (!app.kits[name]) app.kits[name] = makeState(name);
  const s = cur();
  if (!s.exp) { const id = store.get("exp:" + name, ""); const ex = def().examples.find((e) => e.id === id); if (ex && s.src === ex.code) s.exp = ex; }
  ed.src.value = s.src;
  mountBoard();
  buildCpuPane(); buildMemPane(); buildDisPane();
  renderHelp(); renderLab();
  assembleOnly();
  renderGutter();
  s.pcLine = 0;
  setRunUi();
  app.dis = null;
  setStatus(`${name} trainer ready` + (s.loaded ? "" : ": press Assemble or pick an experiment"));
}

// ------------------------------------------------------------------ frame loop
function refreshAll(force) {
  const now = performance.now();
  const s = cur();
  const ctx = { wall: now, dtWall: Math.min(100, now - (app.lastFrame || now)) };
  app.lastFrame = now;
  for (const w of app.boardUpdates) w.update(s.kit, ctx);
  if (force || now - (app.paneT || 0) > 90) {
    app.paneT = now;
    updateCpuPane(now);
    if (app.tab.right === "mem") updateMemPane(now);
    if (app.tab.right === "dis") updateDisPane();
    updateIoPane(now);
    updateCursorLine();
    const k = s.kit;
    $("stpc").textContent = `PC ${hex(def().pc(k), 4)}H  ${def().dis(k, def().pc(k)).text}`;
    const sim = k.t, wall = now;
    if (app.run.running) {
      if (wall - app.run.wallPrev > 400) { app.run.eff = (sim - app.run.simPrev) / ((wall - app.run.wallPrev) / 1000); app.run.simPrev = sim; app.run.wallPrev = wall; }
    }
    $("clock").textContent = `${sim.toFixed(sim < 10 ? 4 : 2)} s${app.run.running && app.run.mult ? ` · ${app.run.eff.toFixed(app.run.eff < 10 ? 2 : 0)}x` : ""}`;
  }
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(100, now - (app.runLast || now));
  app.runLast = now;
  if (app.run.running) {
    try { advanceRun(dt); } catch (e) { stopRun(true); setStatus("Simulation error: " + e.message, "err"); console.error(e); }
  }
  refreshAll(false);
}

// ------------------------------------------------------------------ init
function init() {
  const theme = store.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  $("bTheme").querySelector("use").setAttribute("href", theme === "dark" ? "#i-sun" : "#i-moon");
  initEditor();
  document.querySelectorAll("#kitseg button").forEach((b) => b.addEventListener("click", () => switchKit(b.dataset.kit)));
  document.querySelectorAll("#tabsLeft button").forEach((b) => b.addEventListener("click", () => selectLeft(b.dataset.t)));
  document.querySelectorAll("#tabsRight button").forEach((b) => b.addEventListener("click", () => selectRight(b.dataset.t)));
  document.querySelectorAll("#mtabs button").forEach((b) => b.addEventListener("click", () => selectPane(b.dataset.p)));
  $("bEx").addEventListener("click", (e) => { openExperiments(); e.stopPropagation(); });
  $("bAsm").addEventListener("click", () => assembleAndLoad());
  $("bRun").addEventListener("click", () => { if (app.run.running) stopRun(); else startRun(); });
  $("bStep").addEventListener("click", stepOnce);
  $("bOver").addEventListener("click", stepOver);
  $("bReset").addEventListener("click", resetCpu);
  $("bMore").addEventListener("click", openMore);
  $("speed").addEventListener("change", readSpeed);
  $("bTheme").addEventListener("click", () => {
    const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t; store.set("theme", t);
    $("bTheme").querySelector("use").setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
  });
  document.addEventListener("click", (e) => {
    if (!$("exMenu").contains(e.target)) $("exMenu").hidden = true;
    if (!$("moreMenu").contains(e.target)) $("moreMenu").hidden = true;
    if (e.target === $("modal")) $("modal").hidden = true;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "F5") { e.preventDefault(); $("bRun").click(); }
    else if (e.key === "F10") { e.preventDefault(); stepOnce(); }
    else if (e.key === "F8") { e.preventDefault(); stepOver(); }
    else if (e.key === "F7") { e.preventDefault(); assembleAndLoad(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (assembleAndLoad()) startRun(); }
    else if (e.key === "Escape") { $("exMenu").hidden = true; $("moreMenu").hidden = true; $("modal").hidden = true; }
  });
  selectPane("left");
  switchKit(app.kitName);
  // restore the last experiment's lab text when its program is still in the editor
  requestAnimationFrame(loop);
  window.__trainer = app; // handy for debugging and automated tests
  window.__trainer.api = { assembleAndLoad, startRun, stopRun, stepOnce, selectExperiment, switchKit, KITS };
}
init();
