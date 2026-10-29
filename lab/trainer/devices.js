// Peripheral models shared by both trainer kits. Times are in seconds of simulated time.

/** Time-averaged brightness for a bank of on/off lines (so multiplexed and PWM outputs look right). */
export class Duty {
  constructor(n) { this.n = n; this.cur = new Array(n).fill(0); this.acc = new Float64Array(n); this.last = 0; this.t0 = 0; }
  accum(t) {
    const dt = t - this.last;
    if (dt > 0) for (let i = 0; i < this.n; i++) if (this.cur[i]) this.acc[i] += dt;
    this.last = t;
  }
  set(lines, t) { this.accum(t); for (let i = 0; i < this.n; i++) this.cur[i] = lines[i] ? 1 : 0; }
  setMask(mask, t) { this.accum(t); for (let i = 0; i < this.n; i++) this.cur[i] = (mask >> i) & 1; }
  read(t) {
    this.accum(t);
    const el = t - this.t0;
    const out = [];
    for (let i = 0; i < this.n; i++) out.push(el > 1e-9 ? Math.min(1, this.acc[i] / el) : this.cur[i]);
    this.acc.fill(0);
    this.t0 = t;
    return out;
  }
  reset(t = 0) { this.cur.fill(0); this.acc.fill(0); this.last = t; this.t0 = t; }
}

/** Intel 8255 PPI, mode 0 and BSR. Modes 1 and 2 are reported but not emulated. */
export class PPI8255 {
  constructor(name = "8255") {
    this.name = name;
    this.ext = { a: () => 0xff, b: () => 0xff, c: () => 0xff }; // levels forced by the outside world on input pins
    this.onChange = null;
    this.reset();
  }
  reset() {
    this.ctrl = 0x9b;
    this.la = this.lb = this.lc = 0;
    this.configured = false;
    this.badMode = false;
    this.notify();
  }
  notify() { if (this.onChange) this.onChange(this); }
  get aIn() { return !!(this.ctrl & 0x10); }
  get bIn() { return !!(this.ctrl & 0x02); }
  get cuIn() { return !!(this.ctrl & 0x08); }
  get clIn() { return !!(this.ctrl & 0x01); }
  /** Masks of the pins this chip is driving. */
  get mask() { return { a: this.aIn ? 0 : 0xff, b: this.bIn ? 0 : 0xff, c: (this.cuIn ? 0 : 0xf0) | (this.clIn ? 0 : 0x0f) }; }
  /** Levels the chip drives (0 on pins that are inputs). */
  get out() { const m = this.mask; return { a: this.la & m.a, b: this.lb & m.b, c: this.lc & m.c }; }
  write(reg, v) {
    v &= 255;
    if (reg === 0) this.la = v;
    else if (reg === 1) this.lb = v;
    else if (reg === 2) this.lc = v;
    else if (v & 0x80) {
      this.ctrl = v;
      this.la = this.lb = this.lc = 0;
      this.configured = true;
      this.badMode = !!(v & 0x64);
    } else {
      const bit = (v >> 1) & 7;
      this.lc = v & 1 ? this.lc | (1 << bit) : this.lc & ~(1 << bit);
    }
    this.notify();
  }
  read(reg) {
    if (reg === 0) return this.aIn ? this.ext.a() : this.la;
    if (reg === 1) return this.bIn ? this.ext.b() : this.lb;
    if (reg === 2) {
      const e = this.ext.c();
      return ((this.cuIn ? e : this.lc) & 0xf0) | ((this.clIn ? e : this.lc) & 0x0f);
    }
    return 0xff; // control register is write-only
  }
}

/** Intel 8253/8254 programmable interval timer (binary counting, modes 0-5). */
export class PIT8253 {
  constructor() {
    this.gate = [1, 1, 1];
    this.cascade = [false, false]; // CLK1 <- OUT0, CLK2 <- OUT1
    this.onOut = null; // (index, level)
    this.reset();
  }
  reset() {
    this.c = [0, 1, 2].map(() => ({ mode: 0, rw: 3, count: 0, cur: 0, out: 1, wstate: 0, rstate: 0, wlsb: 0, latched: null, running: false, armed: false, strobe: false, loaded: false, bcd: false, phase: 0 }));
    this.gate = [1, 1, 1];
    this.clocks = 0;
    this.bcdUsed = false;
  }
  setOut(i, v) {
    const c = this.c[i];
    if (c.out !== v) { c.out = v; if (this.onOut) this.onOut(i, v); }
  }
  write(reg, v) {
    v &= 255;
    if (reg === 3) {
      const sc = v >> 6;
      if (sc === 3) return; // 8254 read-back not modelled
      const c = this.c[sc], rw = (v >> 4) & 3;
      if (rw === 0) { c.latched = c.cur & 0xffff; c.rstate = 0; return; }
      let m = (v >> 1) & 7; if (m >= 6) m -= 4;
      c.rw = rw; c.mode = m;
      c.bcd = !!(v & 1); if (c.bcd) this.bcdUsed = true;
      c.wstate = 0; c.rstate = 0; c.running = false; c.armed = false; c.loaded = false; c.strobe = false;
      this.setOut(sc, c.mode === 0 ? 0 : 1);
      return;
    }
    const c = this.c[reg];
    if (c.rw === 1) c.count = v;
    else if (c.rw === 2) c.count = v << 8;
    else if (c.wstate === 0) { c.wlsb = v; c.wstate = 1; return; }
    else { c.count = (v << 8) | c.wlsb; c.wstate = 0; }
    if (c.rw === 3 && c.wstate === 1) return;
    this.load(reg);
  }
  load(i) {
    const c = this.c[i];
    c.loaded = true;
    const n = c.count === 0 ? 65536 : c.count;
    switch (c.mode) {
      case 0: c.cur = n; this.setOut(i, 0); c.running = true; break;
      case 1: c.cur = n; c.armed = true; c.running = false; break; // waits for a gate trigger
      case 2: if (!c.running) { c.cur = n; this.setOut(i, 1); c.running = true; } break;
      case 3: if (!c.running) { c.phase = Math.ceil(n / 2); c.cur = c.phase; this.setOut(i, 1); c.running = true; } break;
      case 4: c.cur = n; this.setOut(i, 1); c.running = true; c.strobe = false; break;
      case 5: c.cur = n; c.armed = true; c.running = false; this.setOut(i, 1); break;
    }
  }
  read(reg) {
    const c = this.c[reg];
    const v = c.latched !== null ? c.latched : c.cur & 0xffff;
    let r;
    if (c.rw === 1) { r = v & 255; c.latched = null; }
    else if (c.rw === 2) { r = v >> 8; c.latched = null; }
    else if (c.rstate === 0) { r = v & 255; c.rstate = 1; }
    else { r = v >> 8; c.rstate = 0; c.latched = null; }
    return r;
  }
  setGate(i, level) {
    level = level ? 1 : 0;
    const c = this.c[i], was = this.gate[i];
    this.gate[i] = level;
    if (level && !was) {
      const n = c.count === 0 ? 65536 : c.count;
      if (c.mode === 1 || c.mode === 5) { c.cur = n; c.running = true; c.armed = false; if (c.mode === 1) this.setOut(i, 0); }
      if (c.mode === 2 || c.mode === 3) { c.cur = c.mode === 3 ? Math.ceil(n / 2) : n; c.phase = c.cur; if (c.loaded) { this.setOut(i, 1); c.running = true; } }
    }
    if (!level && (c.mode === 2 || c.mode === 3)) this.setOut(i, 1);
  }
  /** One input clock pulse on counter i. */
  clk(i) {
    const c = this.c[i];
    if (!c.running) return;
    if (c.mode === 4 || c.mode === 5) {
      if (c.strobe) { this.setOut(i, 1); c.strobe = false; c.running = false; return; }
    }
    if (!this.gate[i] && c.mode !== 1 && c.mode !== 5) return;
    const n = c.count === 0 ? 65536 : c.count;
    switch (c.mode) {
      case 0:
        c.cur = (c.cur - 1) & 0xffff;
        if (c.cur === 0) this.setOut(i, 1);
        break;
      case 1:
        c.cur = (c.cur - 1) & 0xffff;
        if (c.cur === 0) { this.setOut(i, 1); }
        break;
      case 2:
        c.cur--;
        if (c.cur === 1) this.setOut(i, 0);
        if (c.cur <= 0) { c.cur = n; this.setOut(i, 1); }
        break;
      case 3: {
        c.cur--;
        if (c.cur <= 0) {
          const hi = Math.ceil(n / 2), lo = Math.floor(n / 2) || 1;
          const nextOut = c.out ? 0 : 1;
          this.setOut(i, nextOut);
          c.cur = nextOut ? hi : lo;
        }
        break;
      }
      case 4: case 5:
        c.cur = (c.cur - 1) & 0xffff;
        if (c.cur === 0) { this.setOut(i, 0); c.strobe = true; }
        break;
    }
  }
  /** Advance by n input clock periods. */
  advance(n) {
    for (let k = 0; k < n; k++) {
      const o0 = this.c[0].out, o1 = this.c[1].out;
      this.clk(0);
      if (this.cascade[0]) { if (!o0 && this.c[0].out) this.clk(1); } else this.clk(1);
      if (this.cascade[1]) { if (!o1 && this.c[1].out) this.clk(2); } else this.clk(2);
    }
  }
}

/** Intel 8251 USART (asynchronous, framing time not modelled except TX busy). */
export class USART8251 {
  constructor() {
    this.onTx = null;
    this.baud = 9600;
    this.reset();
  }
  reset() { this.state = "mode"; this.mode = 0; this.cmd = 0; this.rx = []; this.pending = []; this.txBusyUntil = 0; this.nextRx = 0; this.overrun = false; }
  /** Typed characters arrive one frame (10 bit times) apart. */
  poll(t) {
    if (this.pending.length && !this.rx.length && t >= this.nextRx) { this.rx.push(this.pending.shift()); this.nextRx = t + 10 / this.baud; }
  }
  status(t) {
    this.poll(t);
    let s = 0x04 | 0x80; // TxEMPTY, DSR
    const txOn = this.cmd & 1;
    const ready = txOn && t >= this.txBusyUntil;
    if (ready) s |= 0x01; else s &= ~0x04;
    if (this.rx.length) s |= 0x02;
    if (this.overrun) s |= 0x10;
    return s;
  }
  write(reg, v, t) {
    if (reg === 0) {
      if (!(this.cmd & 1) || t < this.txBusyUntil) return; // transmitter disabled or busy: byte lost
      this.txBusyUntil = t + 10 / this.baud;
      if (this.onTx) this.onTx(v & 255);
      return;
    }
    if (this.state === "mode") { this.mode = v; this.state = "cmd"; return; }
    this.cmd = v;
    if (v & 0x40) { this.state = "mode"; this.cmd = 0; this.rx = []; }
    if (v & 0x10) this.overrun = false;
  }
  read(reg, t) {
    this.poll(t);
    if (reg === 1) return this.status(t);
    if (!(this.cmd & 4)) return 0xff;
    return this.rx.length ? this.rx.shift() : 0xff;
  }
  receive(c) { this.pending.push(c & 255); if (this.pending.length > 64) this.pending.shift(); }
}

// 5x7 glyphs for ASCII 0x20-0x7F (HD44780-style), columns LSB = top row.
const FONT = [
  0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x5f,0x00,0x00, 0x00,0x07,0x00,0x07,0x00, 0x14,0x7f,0x14,0x7f,0x14, 0x24,0x2a,0x7f,0x2a,0x12,
  0x23,0x13,0x08,0x64,0x62, 0x36,0x49,0x55,0x22,0x50, 0x00,0x05,0x03,0x00,0x00, 0x00,0x1c,0x22,0x41,0x00, 0x00,0x41,0x22,0x1c,0x00,
  0x14,0x08,0x3e,0x08,0x14, 0x08,0x08,0x3e,0x08,0x08, 0x00,0x50,0x30,0x00,0x00, 0x08,0x08,0x08,0x08,0x08, 0x00,0x60,0x60,0x00,0x00,
  0x20,0x10,0x08,0x04,0x02, 0x3e,0x51,0x49,0x45,0x3e, 0x00,0x42,0x7f,0x40,0x00, 0x42,0x61,0x51,0x49,0x46, 0x21,0x41,0x45,0x4b,0x31,
  0x18,0x14,0x12,0x7f,0x10, 0x27,0x45,0x45,0x45,0x39, 0x3c,0x4a,0x49,0x49,0x30, 0x01,0x71,0x09,0x05,0x03, 0x36,0x49,0x49,0x49,0x36,
  0x06,0x49,0x49,0x29,0x1e, 0x00,0x36,0x36,0x00,0x00, 0x00,0x56,0x36,0x00,0x00, 0x08,0x14,0x22,0x41,0x00, 0x14,0x14,0x14,0x14,0x14,
  0x00,0x41,0x22,0x14,0x08, 0x02,0x01,0x51,0x09,0x06, 0x32,0x49,0x79,0x41,0x3e, 0x7e,0x11,0x11,0x11,0x7e, 0x7f,0x49,0x49,0x49,0x36,
  0x3e,0x41,0x41,0x41,0x22, 0x7f,0x41,0x41,0x22,0x1c, 0x7f,0x49,0x49,0x49,0x41, 0x7f,0x09,0x09,0x09,0x01, 0x3e,0x41,0x49,0x49,0x7a,
  0x7f,0x08,0x08,0x08,0x7f, 0x00,0x41,0x7f,0x41,0x00, 0x20,0x40,0x41,0x3f,0x01, 0x7f,0x08,0x14,0x22,0x41, 0x7f,0x40,0x40,0x40,0x40,
  0x7f,0x02,0x0c,0x02,0x7f, 0x7f,0x04,0x08,0x10,0x7f, 0x3e,0x41,0x41,0x41,0x3e, 0x7f,0x09,0x09,0x09,0x06, 0x3e,0x41,0x51,0x21,0x5e,
  0x7f,0x09,0x19,0x29,0x46, 0x46,0x49,0x49,0x49,0x31, 0x01,0x01,0x7f,0x01,0x01, 0x3f,0x40,0x40,0x40,0x3f, 0x1f,0x20,0x40,0x20,0x1f,
  0x3f,0x40,0x38,0x40,0x3f, 0x63,0x14,0x08,0x14,0x63, 0x07,0x08,0x70,0x08,0x07, 0x61,0x51,0x49,0x45,0x43, 0x00,0x7f,0x41,0x41,0x00,
  0x02,0x04,0x08,0x10,0x20, 0x00,0x41,0x41,0x7f,0x00, 0x04,0x02,0x01,0x02,0x04, 0x40,0x40,0x40,0x40,0x40, 0x00,0x01,0x02,0x04,0x00,
  0x20,0x54,0x54,0x54,0x78, 0x7f,0x48,0x44,0x44,0x38, 0x38,0x44,0x44,0x44,0x20, 0x38,0x44,0x44,0x48,0x7f, 0x38,0x54,0x54,0x54,0x18,
  0x08,0x7e,0x09,0x01,0x02, 0x0c,0x52,0x52,0x52,0x3e, 0x7f,0x08,0x04,0x04,0x78, 0x00,0x44,0x7d,0x40,0x00, 0x20,0x40,0x44,0x3d,0x00,
  0x7f,0x10,0x28,0x44,0x00, 0x00,0x41,0x7f,0x40,0x00, 0x7c,0x04,0x18,0x04,0x78, 0x7c,0x08,0x04,0x04,0x78, 0x38,0x44,0x44,0x44,0x38,
  0x7c,0x14,0x14,0x14,0x08, 0x08,0x14,0x14,0x18,0x7c, 0x7c,0x08,0x04,0x04,0x08, 0x48,0x54,0x54,0x54,0x20, 0x04,0x3f,0x44,0x40,0x20,
  0x3c,0x40,0x40,0x20,0x7c, 0x1c,0x20,0x40,0x20,0x1c, 0x3c,0x40,0x30,0x40,0x3c, 0x44,0x28,0x10,0x28,0x44, 0x0c,0x50,0x50,0x50,0x3c,
  0x44,0x64,0x54,0x4c,0x44, 0x00,0x08,0x36,0x41,0x00, 0x00,0x00,0x7f,0x00,0x00, 0x00,0x41,0x36,0x08,0x00, 0x08,0x08,0x2a,0x1c,0x08,
  0x08,0x1c,0x2a,0x08,0x08,
];

/** Returns the 5x8 bitmap of a character code as 8 rows of 5 bits (bit4 = leftmost). */
export function glyphRows(code, cgram) {
  if (code < 16) {
    const base = (code & 7) * 8;
    return Array.from({ length: 8 }, (_, r) => cgram[base + r] & 31);
  }
  let g;
  if (code >= 0x20 && code <= 0x7f) g = FONT.slice((code - 0x20) * 5, (code - 0x20) * 5 + 5);
  else g = [0x7f, 0x41, 0x41, 0x41, 0x7f]; // box for unmapped codes
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let bits = 0;
    for (let c = 0; c < 5; c++) if ((g[c] >> r) & 1 && r < 7) bits |= 1 << (4 - c);
    rows.push(bits);
  }
  return rows;
}

/** HD44780 16x2 LCD controller, 8-bit interface. Commands written while busy are ignored (as on the real part). */
export class LCD1602 {
  constructor() { this.reset(); }
  reset() {
    this.dd = new Uint8Array(80).fill(0x20);
    this.cg = new Uint8Array(64);
    this.addr = 0;
    this.inCg = false;
    this.id = 1; this.sh = 0; // entry mode
    this.on = 0; this.cur = 0; this.blink = 0;
    this.shift = 0;
    this.lines2 = 0; this.fn8 = 1; this.big = 0;
    this.busyUntil = 0;
    this.ignored = 0;
    this.initialised = false;
  }
  busy(t) { return t < this.busyUntil; }
  status(t) { return (this.busy(t) ? 0x80 : 0) | (this.addr & 0x7f); }
  command(v, t) {
    if (this.busy(t)) { this.ignored++; return; }
    let us = 37;
    if (v & 0x80) { this.inCg = false; this.addr = v & 0x7f; }
    else if (v & 0x40) { this.inCg = true; this.addr = v & 0x3f; }
    else if (v & 0x20) { this.fn8 = (v >> 4) & 1; this.lines2 = (v >> 3) & 1; this.big = (v >> 2) & 1; this.initialised = true; }
    else if (v & 0x10) {
      const sc = (v >> 3) & 1, rl = (v >> 2) & 1;
      if (sc) this.shift = (this.shift + (rl ? 1 : -1) + 40) % 40;
      else this.addr = (this.addr + (rl ? 1 : -1)) & 0x7f;
    } else if (v & 0x08) { this.on = (v >> 2) & 1; this.cur = (v >> 1) & 1; this.blink = v & 1; }
    else if (v & 0x04) { this.id = (v >> 1) & 1; this.sh = v & 1; }
    else if (v & 0x02) { this.addr = 0; this.shift = 0; this.inCg = false; us = 1520; }
    else if (v & 0x01) { this.dd.fill(0x20); this.addr = 0; this.shift = 0; this.id = 1; this.inCg = false; us = 1520; }
    this.busyUntil = t + us * 1e-6;
  }
  ddIndex(a) { // DDRAM address -> storage index
    if (this.lines2) return a >= 0x40 ? 40 + (a - 0x40) : a;
    return a;
  }
  writeData(v, t) {
    if (this.busy(t)) { this.ignored++; return; }
    if (this.inCg) this.cg[this.addr & 63] = v & 31;
    else {
      const i = this.ddIndex(this.addr & 0x7f);
      if (i < 80) this.dd[i] = v;
    }
    this.advance();
    this.busyUntil = t + 37e-6;
  }
  advance() {
    if (this.inCg) { this.addr = (this.addr + (this.id ? 1 : -1)) & 63; return; }
    if (this.sh) this.shift = (this.shift + (this.id ? -1 : 1) + 40) % 40;
    this.addr = (this.addr + (this.id ? 1 : -1)) & 0x7f;
    if (this.lines2) {
      if (this.id && this.addr === 0x28) this.addr = 0x40;
      else if (this.id && this.addr === 0x68) this.addr = 0;
      else if (!this.id && this.addr === 0x3f) this.addr = 0x27;
      else if (!this.id && this.addr === 0x7f) this.addr = 0x67;
    } else if (this.id && this.addr === 0x50) this.addr = 0;
  }
  readData(t) {
    if (this.busy(t)) return 0xff;
    let v;
    if (this.inCg) v = this.cg[this.addr & 63];
    else { const i = this.ddIndex(this.addr & 0x7f); v = i < 80 ? this.dd[i] : 0; }
    this.advance();
    return v;
  }
  /** Visible characters: rows of 16 codes (or blanks if the display is off). */
  view() {
    const rows = [[], []];
    for (let r = 0; r < (this.lines2 ? 2 : 1); r++)
      for (let c = 0; c < 16; c++) rows[r].push(this.on ? this.dd[this.lines2 ? r * 40 + ((c + this.shift) % 40) : (c + this.shift) % 80] : 0x20);
    if (!this.lines2) rows[1] = new Array(16).fill(0x20);
    return rows;
  }
  cursorPos() {
    if (this.inCg) return null;
    const a = this.addr & 0x7f;
    let row = 0, col = a;
    if (this.lines2 && a >= 0x40) { row = 1; col = a - 0x40; }
    col -= this.shift;
    if (col < 0 || col > 15 || !this.on) return null;
    return { row, col };
  }
}

/** Unipolar 4-phase stepper (7.5 deg/step). Follows the stator field; misses steps above ~500 steps/s. */
export class Stepper {
  constructor() { this.reset(); }
  reset() { this.angle = 0; this.phi = null; this.lastMove = -1; this.steps = 0; this.missed = 0; this.dir = 0; this.coils = 0; this.energised = 0; }
  drive(mask, t) {
    mask &= 15;
    this.coils = mask;
    let x = 0, y = 0;
    for (let i = 0; i < 4; i++) if ((mask >> i) & 1) { x += Math.cos((i * Math.PI) / 2); y += Math.sin((i * Math.PI) / 2); }
    this.energised = mask ? 1 : 0;
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) return;
    const phi = (Math.atan2(y, x) * 180) / Math.PI;
    if (this.phi === null) { this.phi = phi; return; }
    let d = phi - this.phi;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    if (Math.abs(d) > 135 || Math.abs(d) < 1) { this.phi = phi; return; }
    if (this.lastMove >= 0 && t - this.lastMove < 0.002) { this.missed++; this.phi = phi; return; }
    this.angle += d / 12;
    this.phi = phi;
    this.lastMove = t;
    this.steps += Math.round(Math.abs(d) / 45) / 2;
    this.dir = d > 0 ? 1 : -1;
  }
}

/** Seven-segment bank with per-segment duty measurement; segs bit0=a..bit6=g, bit7=dp. */
export class SevenSeg {
  constructor(digits) {
    this.digits = digits;
    this.inv = false; // true = active-low segments
    this.acc = Array.from({ length: digits }, () => new Float64Array(8));
    this.cur = Array.from({ length: digits }, () => new Uint8Array(8));
    this.last = 0; this.t0 = 0;
  }
  accum(t) {
    const dt = t - this.last;
    if (dt > 0) for (let d = 0; d < this.digits; d++) for (let s = 0; s < 8; s++) if (this.cur[d][s]) this.acc[d][s] += dt;
    this.last = t;
  }
  drive(segs, sel, t) {
    this.accum(t);
    const sv = this.inv ? ~segs & 255 : segs & 255;
    for (let d = 0; d < this.digits; d++) for (let s = 0; s < 8; s++) this.cur[d][s] = (sel >> d) & 1 && (sv >> s) & 1 ? 1 : 0;
  }
  read(t) {
    this.accum(t);
    const el = t - this.t0;
    const out = this.acc.map((a, d) => Array.from(a, (v, s) => (el > 1e-9 ? Math.min(1, v / el) : this.cur[d][s])));
    for (const a of this.acc) a.fill(0);
    this.t0 = t;
    return out;
  }
}

/** 4x4 hex keypad: rows driven low select a row, pressed keys pull their column low. */
export class Keypad4x4 {
  constructor() { this.pressed = new Set(); }
  scan(rowBits) { // rowBits: 4 bits, 0 = row driven low
    let cols = 0x0f;
    for (const k of this.pressed) {
      const r = k >> 2, c = k & 3;
      if (!((rowBits >> r) & 1)) cols &= ~(1 << c);
    }
    return cols;
  }
}

/** 8-bit DAC with a waveform recorder for the scope view. */
export class DAC {
  constructor() { this.code = 0; this.ev = []; this.max = 60000; }
  write(v, t) {
    this.code = v & 255;
    this.ev.push(t, this.code);
    if (this.ev.length > this.max * 2) this.ev.splice(0, this.max);
  }
  get volts() { return (this.code / 256) * 5; }
  reset() { this.code = 0; this.ev = []; }
}

/** ADC0809: 8 channels, 5 V reference, ~100 us conversion. */
export class ADC {
  constructor() {
    this.inputs = [2.5, 1.25, 0.25, 3.0, 1.25, 2.5, 3.75, 5.0]; // volts; fixed references on the last four
    this.reset();
  }
  reset() { this.data = 0; this.eocAt = 0; this.ch = 0; this.converting = false; this.conv = 0; }
  start(ch, t) { this.ch = ch & 7; this.eocAt = t + 100e-6; this.converting = true; this.starts = (this.starts || 0) + 1; }
  update(t) {
    if (this.converting && t >= this.eocAt) {
      this.converting = false;
      this.data = Math.max(0, Math.min(255, Math.round((this.inputs[this.ch] / 5) * 256 - 0.5 + 0.0001)));
      this.conv++;
    }
  }
  eoc(t) { this.update(t); return !this.converting; }
  read(t) { this.update(t); return this.data; }
}

/** Estimates the frequency of a digital line from its rising edges (for the speaker/buzzer). */
export class ToneMeter {
  constructor() { this.level = 0; this.rises = []; }
  set(level, t) {
    level = level ? 1 : 0;
    if (level && !this.level) { this.rises.push(t); if (this.rises.length > 12) this.rises.shift(); }
    this.level = level;
  }
  freq(t) {
    const r = this.rises;
    if (r.length < 3 || t - r[r.length - 1] > 0.06) return 0;
    return (r.length - 1) / (r[r.length - 1] - r[0]);
  }
}
