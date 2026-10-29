// The 8085 trainer: CPU + 64 KB RAM + keypad monitor + I/O board (3x 8255, 8253, 8251, DAC, ADC, LEDs, switches,
// 7-segment display, matrix keypad, stepper, traffic light, DC motor, relay, buzzer) wired to fixed I/O addresses.
import { I8085 } from "./i8085.js";
import { Duty, PPI8255, PIT8253, USART8251, LCD1602, Stepper, SevenSeg, Keypad4x4, DAC, ADC, ToneMeter } from "./devices.js";

export const SEG_FONT = {
  "0": 0x3f, "1": 0x06, "2": 0x5b, "3": 0x4f, "4": 0x66, "5": 0x6d, "6": 0x7d, "7": 0x07, "8": 0x7f, "9": 0x6f,
  A: 0x77, B: 0x7c, C: 0x39, D: 0x5e, E: 0x79, F: 0x71, b: 0x7c, d: 0x5e, H: 0x76, L: 0x38, P: 0x73, S: 0x6d, r: 0x50, U: 0x3e, u: 0x1c, n: 0x54, o: 0x5c, "-": 0x40, " ": 0,
};

export const MON = { GETKEY: 0x0300, RDKBD: 0x0303, UPDAD: 0x0306, UPDDT: 0x0309, CLEAR: 0x030c, DELAY: 0x030f, BEEP: 0x0312 };
export const KEY = { EXEC: 0x10, NEXT: 0x11, PREV: 0x12, EXAM: 0x13, REG: 0x14, GO: 0x15, STEP: 0x16 };
const REGS = ["A", "B", "C", "D", "E", "H", "L", "F", "SPH", "SPL", "PCH", "PCL"];

export class Kit8085 {
  constructor() {
    this.hz = 3_000_000;
    this.cpu = new I8085({ in: (p) => this.ioIn(p), out: (p, v) => this.ioOut(p, v) });
    this.t = 0;
    this.pitFrac = 0;
    // I/O board
    this.ppi = [new PPI8255("8255 #1"), new PPI8255("8255 #2"), new PPI8255("8255 #3")];
    this.pit = new PIT8253();
    this.usart = new USART8251();
    this.dac = new DAC();
    this.adc = new ADC();
    this.led = new Duty(8);
    this.dip = 0; // DIP switches, 1 = on
    this.pb = 0; // push buttons PC0-3 on PPI#1
    this.seg = new SevenSeg(8);
    this.kp = new Keypad4x4();
    this.stepper = new Stepper();
    this.traffic = new Duty(6);
    this.motorEn = new Duty(1);
    this.motorDir = 0;
    this.relay = 0;
    this.relayClicks = 0;
    this.buzz = new ToneMeter();
    this.spk = new ToneMeter();
    this.out2 = 0;
    this.term = [];
    this.irqOut0 = "6.5"; // where 8253 OUT0 is jumpered
    this.adcIrq = false;
    this.intrOp = 0xff;
    this.lcd = new LCD1602(); // optional LCD board on I/O 70H/71H
    this.ioLog = [];
    this.wire();
    this.mon = { mode: "reset", addr: "8085", data: "--", buf: "", cur: 0, reg: 0, edited: false, running: false, prog: false, progAddr: "    ", progData: "  ", keys: [] };
    this.reset();
  }

  wire() {
    const [p1, p2, p3] = this.ppi;
    p1.ext.b = () => this.dip;
    p1.ext.c = () => 0xf0 | this.pb;
    p1.onChange = (p) => this.led.setMask(p.out.a, this.t);
    p2.ext.c = () => {
      const rows = p2.clIn ? 0x0f : (p2.lc & 0x0f);
      return (this.kp.scan(rows) << 4) | 0x0f;
    };
    p2.onChange = (p) => {
      this.seg.drive(p.out.a, p.out.b, this.t);
    };
    p3.onChange = (p) => {
      const o = p.out;
      this.stepper.drive(o.a & 15, this.t);
      const r = (o.a >> 4) & 1;
      if (r !== this.relay) { this.relay = r; this.relayClicks++; }
      this.buzz.set((o.a >> 5) & 1, this.t);
      this.traffic.setMask(o.b & 0x3f, this.t);
      this.motorEn.setMask(o.c & 1, this.t);
      this.motorDir = (o.c >> 1) & 1;
    };
    this.pit.onOut = (i, v) => {
      if (i === 0) {
        if (this.irqOut0 === "7.5") { if (v) this.cpu.raise75(); }
        else if (this.irqOut0 === "6.5") this.cpu.pin65 = v;
        else if (this.irqOut0 === "5.5") this.cpu.pin55 = v;
      } else if (i === 1) this.spk.set(v, this.t);
      else this.out2 = v;
    };
    this.usart.onTx = (c) => { this.term.push(c); if (this.term.length > 4000) this.term.splice(0, 1000); };
  }

  reset() {
    this.cpu.reset();
    this.cpu.sid = this._sid ?? 0;
    this.t = 0;
    this.pitFrac = 0;
    for (const p of this.ppi) p.reset();
    this.pit.reset();
    this.usart.reset();
    this.dac.reset();
    this.adc.reset();
    this.stepper.reset();
    this.led.reset(0); this.traffic.reset(0); this.motorEn.reset(0);
    this.seg = Object.assign(new SevenSeg(8), { inv: this.seg ? this.seg.inv : false });
    this.lcd.reset();
    this.relay = 0;
    this.out2 = 0;
    this.term = [];
    this.mon.mode = "reset"; this.mon.addr = "8085"; this.mon.data = "--"; this.mon.buf = ""; this.mon.running = false; this.mon.prog = false; this.mon.keys = [];
    this.lastEnd = null;
    this.ioLog = [];
    this.sodToggles = 0;
    this._sod = 0;
  }

  // ----- memory helpers -----
  load(bytes, segments) {
    for (const s of segments) for (let a = s.start; a < s.end; a++) this.cpu.mem[a] = bytes[a];
  }
  clearMemory() { this.cpu.mem.fill(0); }

  // ----- I/O map -----
  ioIn(p) {
    const hi = p >> 4, lo = p & 3;
    if (hi <= 2) return this.ppi[hi].read(lo);
    if (hi === 4) {
      if (lo === 0) { this.cpu.pin55 = 0; return this.adc.read(this.t); }
      if (lo === 1) return this.adc.eoc(this.t) ? 1 : 0;
      return 0xff;
    }
    if (hi === 5) return this.pit.read(lo);
    if (hi === 6) return this.usart.read(p & 1, this.t);
    if (hi === 7) return (p & 1) ? this.lcd.readData(this.t) : this.lcd.status(this.t);
    return 0xff;
  }
  ioOut(p, v) {
    this.ioLog.push([p, v, this.t]);
    if (this.ioLog.length > 6000) this.ioLog.splice(0, 2000);
    const hi = p >> 4, lo = p & 3;
    if (hi <= 2) this.ppi[hi].write(lo, v);
    else if (hi === 3) this.dac.write(v, this.t);
    else if (hi === 4) { this.adc.start(v, this.t); this.adcPending = true; }
    else if (hi === 5) this.pit.write(lo, v);
    else if (hi === 6) this.usart.write(p & 1, v, this.t);
    else if (hi === 7) { if (p & 1) this.lcd.writeData(v, this.t); else this.lcd.command(v, this.t); }
  }

  // ----- time -----
  advanceT(n) {
    while (n > 0) {
      const chunk = n > 48 ? 48 : n; // keep device timestamps accurate across long delays
      n -= chunk;
      this.t += chunk / this.hz;
      this.pitFrac += chunk / 2; // 8253 clock = CPU clock / 2
      const whole = Math.floor(this.pitFrac);
      if (whole) { this.pitFrac -= whole; this.pit.advance(whole); }
    }
    if (this.adcPending) {
      this.adc.update(this.t);
      if (!this.adc.converting) { this.adcPending = false; if (this.adcIrq) this.cpu.pin55 = 1; }
    }
  }

  // ----- monitor service routines (CALL 0300H etc.) -----
  hook() {
    const c = this.cpu, pc = c.pc;
    if (pc < 0x300 || pc > 0x313) return 0;
    const ret = () => { c.pc = c.pop16(); return 10; };
    switch (pc) {
      case MON.GETKEY:
        if (this.mon.keys.length) { c.r[7] = this.mon.keys.shift(); return ret(); }
        return 6;
      case MON.RDKBD:
        c.r[7] = this.mon.keys.length ? this.mon.keys.shift() : 0xff;
        return ret();
      case MON.UPDAD: this.mon.prog = true; this.mon.progAddr = c.hl.toString(16).toUpperCase().padStart(4, "0"); return ret();
      case MON.UPDDT: this.mon.prog = true; this.mon.progData = c.r[7].toString(16).toUpperCase().padStart(2, "0"); return ret();
      case MON.CLEAR: this.mon.prog = true; this.mon.progAddr = "    "; this.mon.progData = "  "; return ret();
      case MON.DELAY: { // delay BC milliseconds
        const ms = c.bc;
        const t = ret();
        return t + ms * (this.hz / 1000);
      }
      case MON.BEEP: this.beepUntil = this.t + 0.1; return ret();
    }
    return 0;
  }

  /** Executes one instruction; returns T-states. */
  step() {
    let t = this.hook();
    if (!t) t = this.cpu.step();
    this.advanceT(t);
    if (this.cpu.sod !== this._sod) { this._sod = this.cpu.sod; this.sodToggles++; }
    return t;
  }

  canWake() {
    const c = this.cpu;
    return !!((c.ie && (!c.m75 || !c.m65 || !c.m55 || c.intrReq)) || c.trapPending);
  }

  /**
   * Runs until the budget of T-states is used, a breakpoint is hit, or the program halts for good.
   * Returns "budget" | "break" | "halt".
   */
  run(budget, breakpoints, skipFirstBreak = false) {
    const c = this.cpu;
    let used = 0;
    let first = skipFirstBreak;
    while (used < budget) {
      if (c.halted && !this.canWake()) { this.onProgramEnd(); return "halt"; }
      if (!first && breakpoints && breakpoints.has(c.pc) && !c.halted) return "break";
      first = false;
      used += this.step();
    }
    return "budget";
  }

  onProgramEnd() {
    this.mon.running = false;
    this.mon.mode = "data";
    this.mon.addr = this.cpu.pc.toString(16).toUpperCase().padStart(4, "0");
    this.mon.data = this.cpu.mem[this.cpu.pc].toString(16).toUpperCase().padStart(2, "0");
    this.mon.cur = this.cpu.pc;
  }

  // ----- front panel -----
  setSid(v) { this._sid = v ? 1 : 0; this.cpu.sid = this._sid; }
  pressInt(name, down) {
    const c = this.cpu;
    switch (name) {
      case "TRAP": if (down) c.trap(); break;
      case "7.5": if (down) c.raise75(); break;
      case "6.5": c.pin65 = down ? 1 : 0; break;
      case "5.5": c.pin55 = down ? 1 : 0; break;
      case "INTR": c.setIntr(down, this.intrOp); break;
    }
  }

  hexDisp(v, n) { return v.toString(16).toUpperCase().padStart(n, "0").slice(-n); }

  /** A key on the monitor keypad. Returns true if it was a monitor command. */
  key(k) {
    const m = this.mon, c = this.cpu;
    if (k === "RESET") { this.softReset(); return; }
    if (k === "INT") { c.raise75(); return; }
    const code = typeof k === "number" ? k : k in KEY ? KEY[k] : parseInt(k, 16);
    if (m.running) { m.keys.push(code); if (m.keys.length > 16) m.keys.shift(); return; }
    const isDigit = code < 16;
    const digit = (s, n) => (s + code.toString(16).toUpperCase()).slice(-n);
    switch (m.mode) {
      case "reset": case "ready":
        if (code === KEY.EXAM) { m.mode = "addr"; m.buf = ""; m.addr = "    "; m.data = "  "; }
        else if (code === KEY.REG) { m.mode = "reg"; m.reg = 0; this.showReg(); }
        else if (code === KEY.GO) { m.mode = "go"; m.buf = ""; m.addr = "    "; m.data = "  "; }
        else if (code === KEY.STEP) this.monStep();
        break;
      case "addr":
        if (isDigit) { m.buf = digit(m.buf, 4); m.addr = m.buf.padStart(4, " "); m.data = "  "; }
        else if (code === KEY.NEXT) { m.cur = m.buf ? parseInt(m.buf, 16) : 0; m.mode = "data"; this.showData(); }
        else if (code === KEY.GO) { m.mode = "go"; }
        else if (code === KEY.REG) { m.mode = "reg"; m.reg = 0; this.showReg(); }
        break;
      case "data":
        if (isDigit) { m.buf = digit(m.edited ? m.buf : "", 2); m.edited = true; m.data = m.buf.padStart(2, " "); }
        else if (code === KEY.NEXT) { this.commitData(); m.cur = (m.cur + 1) & 0xffff; this.showData(); }
        else if (code === KEY.PREV) { this.commitData(); m.cur = (m.cur - 1) & 0xffff; this.showData(); }
        else if (code === KEY.EXAM) { this.commitData(); m.mode = "addr"; m.buf = ""; m.addr = "    "; m.data = "  "; }
        else if (code === KEY.GO) { this.commitData(); m.mode = "go"; m.buf = ""; m.addr = this.hexDisp(m.cur, 4); m.data = "  "; }
        else if (code === KEY.STEP) { this.commitData(); c.pc = m.cur; this.monStep(); }
        else if (code === KEY.REG) { this.commitData(); m.mode = "reg"; m.reg = 0; this.showReg(); }
        break;
      case "go":
        if (isDigit) { m.buf = digit(m.buf, 4); m.addr = m.buf.padStart(4, " "); }
        else if (code === KEY.EXEC) {
          if (m.buf) c.pc = parseInt(m.buf, 16);
          m.running = true; m.prog = false; m.progAddr = "    "; m.progData = "  ";
          m.keys = [];
          c.halted = false;
        } else if (code === KEY.EXAM) { m.mode = "addr"; m.buf = ""; m.addr = "    "; m.data = "  "; }
        break;
      case "reg":
        if (isDigit) { m.buf = digit(m.edited ? m.buf : "", 2); m.edited = true; m.data = m.buf.padStart(2, " "); }
        else if (code === KEY.NEXT) { this.commitReg(); m.reg = (m.reg + 1) % REGS.length; this.showReg(); }
        else if (code === KEY.PREV) { this.commitReg(); m.reg = (m.reg + REGS.length - 1) % REGS.length; this.showReg(); }
        else if (code === KEY.EXAM) { this.commitReg(); m.mode = "addr"; m.buf = ""; m.addr = "    "; m.data = "  "; }
        else if (code === KEY.GO) { this.commitReg(); m.mode = "go"; m.buf = ""; m.addr = this.hexDisp(c.pc, 4); }
        break;
    }
  }

  softReset() {
    const mem = this.cpu.mem.slice();
    const sid = this._sid;
    this.reset();
    this.cpu.mem.set(mem);
    this.setSid(sid);
  }

  showData() {
    const m = this.mon;
    m.addr = this.hexDisp(m.cur, 4);
    m.data = this.hexDisp(this.cpu.mem[m.cur], 2);
    m.buf = ""; m.edited = false;
  }
  commitData() { const m = this.mon; if (m.edited && m.buf) this.cpu.mem[m.cur] = parseInt(m.buf, 16); m.edited = false; m.buf = ""; }
  regValue(i) {
    const c = this.cpu;
    switch (REGS[i]) {
      case "A": return c.r[7]; case "B": return c.r[0]; case "C": return c.r[1]; case "D": return c.r[2]; case "E": return c.r[3];
      case "H": return c.r[4]; case "L": return c.r[5]; case "F": return c.f;
      case "SPH": return c.sp >> 8; case "SPL": return c.sp & 255; case "PCH": return c.pc >> 8; default: return c.pc & 255;
    }
  }
  showReg() {
    const m = this.mon, n = REGS[m.reg];
    m.addr = (n + "    ").slice(0, 4).replace("SPH", "SPH ").replace("SPL", "SPL ").replace("PCH", "PCH ").replace("PCL", "PCL ");
    m.addr = n.padEnd(4, " ");
    m.data = this.hexDisp(this.regValue(m.reg), 2);
    m.buf = ""; m.edited = false;
  }
  commitReg() {
    const m = this.mon, c = this.cpu;
    if (!(m.edited && m.buf)) return;
    const v = parseInt(m.buf, 16) & 255;
    switch (REGS[m.reg]) {
      case "A": c.r[7] = v; break; case "B": c.r[0] = v; break; case "C": c.r[1] = v; break; case "D": c.r[2] = v; break; case "E": c.r[3] = v; break;
      case "H": c.r[4] = v; break; case "L": c.r[5] = v; break; case "F": c.f = v; break;
      case "SPH": c.sp = (v << 8) | (c.sp & 255); break; case "SPL": c.sp = (c.sp & 0xff00) | v; break;
      case "PCH": c.pc = (v << 8) | (c.pc & 255); break; default: c.pc = (c.pc & 0xff00) | v;
    }
    m.edited = false; m.buf = "";
  }
  monStep() {
    const c = this.cpu, m = this.mon;
    c.halted = false;
    this.step();
    m.mode = "data"; m.cur = c.pc; this.showData();
  }

  /** Six display characters (4 address + 2 data) for the front-panel 7-segment digits. */
  display() {
    const m = this.mon;
    if (m.running) return m.prog ? m.progAddr + m.progData : "rUn   ";
    return m.addr.padEnd(4, " ").slice(0, 4) + m.data.padEnd(2, " ").slice(0, 2);
  }
}
