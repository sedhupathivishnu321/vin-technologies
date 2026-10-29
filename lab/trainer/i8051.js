// Intel 8051/8052 core: all 255 opcodes, 256 B internal RAM, SFRs, timers 0/1 (modes 0-3), UART (modes 0-3),
// 5 interrupt sources with two priority levels, idle/power-down. Time unit = machine cycle (12 oscillator clocks).

export const SFR = {
  P0: 0x80, SP: 0x81, DPL: 0x82, DPH: 0x83, PCON: 0x87, TCON: 0x88, TMOD: 0x89, TL0: 0x8a, TL1: 0x8b, TH0: 0x8c, TH1: 0x8d,
  P1: 0x90, SCON: 0x98, SBUF: 0x99, P2: 0xa0, IE: 0xa8, P3: 0xb0, IP: 0xb8, PSW: 0xd0, ACC: 0xe0, B: 0xf0,
};
const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let p = 0, v = i; while (v) { p ^= v & 1; v >>= 1; } PARITY[i] = p; }

export class I8051 {
  constructor(hooks = {}) {
    this.code = new Uint8Array(65536);
    this.xdata = new Uint8Array(65536);
    this.hooks = hooks; // xread(addr), xwrite(addr,v), portWrite(n,v), txByte(v)
    this.reset();
  }

  reset() {
    this.iram = new Uint8Array(256);
    this.sfr = new Uint8Array(128); // index = addr - 0x80
    this.sfr[SFR.P0 - 0x80] = this.sfr[SFR.P1 - 0x80] = this.sfr[SFR.P2 - 0x80] = this.sfr[SFR.P3 - 0x80] = 0xff;
    this.sfr[SFR.SP - 0x80] = 7;
    this.pc = 0;
    this.ext = [0xff, 0xff, 0xff, 0xff]; // external pin levels (wired-AND with the latch)
    this.cycles = 0;
    this.icount = 0;
    this.isr = []; // priority levels currently in service
    this.irqBlock = 0;
    this.idle = false;
    this.powerDown = false;
    this.txRemain = 0;
    this.txByte = 0;
    this.rxRemain = 0;
    this.rxByte = 0;
    this.rxQueue = [];
    this.sbufRx = 0;
    this.lastPc = 0;
    this.lastOp = 0;
  }

  // ----- SFR plumbing -----
  g(a) { return this.sfr[a - 0x80]; }
  s(a, v) { this.sfr[a - 0x80] = v & 255; }
  get acc() { return this.sfr[0x60]; }
  set acc(v) { this.sfr[0x60] = v & 255; }
  get b() { return this.sfr[0x70]; }
  get psw() { return (this.sfr[0x50] & 0xfe) | PARITY[this.sfr[0x60]]; }
  get sp() { return this.sfr[1]; }
  get dptr() { return (this.sfr[3] << 8) | this.sfr[2]; }
  set dptr(v) { this.sfr[3] = (v >> 8) & 255; this.sfr[2] = v & 255; }
  get cy() { return (this.sfr[0x50] >> 7) & 1; }
  set cy(v) { this.sfr[0x50] = (this.sfr[0x50] & 0x7f) | (v ? 0x80 : 0); }
  get bank() { return (this.sfr[0x50] & 0x18); }
  R(n) { return this.iram[this.bank + n]; }
  setR(n, v) { this.iram[this.bank + n] = v & 255; }

  readPort(n, rmw) {
    const latch = this.sfr[n * 0x10];
    return rmw ? latch : latch & this.ext[n];
  }

  readDir(a, rmw = false) {
    if (a < 0x80) return this.iram[a];
    switch (a) {
      case 0x80: return this.readPort(0, rmw);
      case 0x90: return this.readPort(1, rmw);
      case 0xa0: return this.readPort(2, rmw);
      case 0xb0: return this.readPort(3, rmw);
      case 0xd0: return this.psw;
      case 0x99: return this.sbufRx;
    }
    return this.sfr[a - 0x80];
  }

  writeDir(a, v) {
    v &= 255;
    if (a < 0x80) { this.iram[a] = v; return; }
    if (a === 0x99) { this.startTx(v); return; }
    if (a === 0xa8 || a === 0xb8) this.irqBlock = 1;
    if (a === 0x87) { if (v & 1) this.idle = true; if (v & 2) this.powerDown = true; }
    this.sfr[a - 0x80] = v;
    if (a === 0x80 || a === 0x90 || a === 0xa0 || a === 0xb0) {
      if (this.hooks.portWrite) this.hooks.portWrite((a - 0x80) >> 4, v);
    }
  }

  bitAddr(b) { return b < 0x80 ? { a: 0x20 + (b >> 3), m: 1 << (b & 7) } : { a: b & 0xf8, m: 1 << (b & 7) }; }
  readBit(b, rmw = false) { const { a, m } = this.bitAddr(b); return (this.readDir(a, rmw) & m) ? 1 : 0; }
  writeBit(b, v) {
    const { a, m } = this.bitAddr(b);
    const cur = this.readDir(a, true);
    this.writeDir(a, v ? cur | m : cur & ~m);
  }

  push(v) { const sp = (this.sfr[1] + 1) & 255; this.sfr[1] = sp; this.iram[sp] = v & 255; }
  pop() { const sp = this.sfr[1]; const v = this.iram[sp]; this.sfr[1] = (sp - 1) & 255; return v; }
  fetch() { const v = this.code[this.pc]; this.pc = (this.pc + 1) & 0xffff; return v; }
  rel() { const r = this.fetch(); this.pc = (this.pc + (r < 128 ? r : r - 256)) & 0xffff; }

  xr(a) { return this.hooks.xread ? this.hooks.xread(a & 0xffff) : this.xdata[a & 0xffff]; }
  xw(a, v) { if (this.hooks.xwrite) this.hooks.xwrite(a & 0xffff, v & 255); else this.xdata[a & 0xffff] = v & 255; }

  // ----- external pins -----
  /** Drives a port pin from outside (switches, push buttons, pulse generator). */
  setPin(port, bit, level) {
    const old = (this.ext[port] >> bit) & 1;
    level = level ? 1 : 0;
    if (old === level) return;
    this.ext[port] = level ? this.ext[port] | (1 << bit) : this.ext[port] & ~(1 << bit);
    if (port !== 3 || level) return;
    const tcon = this.g(SFR.TCON);
    if (bit === 2 && (tcon & 0x01)) this.s(SFR.TCON, this.g(SFR.TCON) | 0x02); // IT0 edge
    if (bit === 3 && (tcon & 0x04)) this.s(SFR.TCON, this.g(SFR.TCON) | 0x08); // IT1 edge
    if (bit === 4) this.countExt(0);
    if (bit === 5) this.countExt(1);
  }
  setPort(port, value) { this.ext[port] = value & 255; }

  countExt(t) {
    const tmod = this.g(SFR.TMOD), tcon = this.g(SFR.TCON);
    const nib = t === 0 ? tmod & 15 : tmod >> 4;
    if (!(nib & 4)) return; // timer mode, not counter
    const run = (tcon & (t === 0 ? 0x10 : 0x40)) && (!(nib & 8) || ((this.ext[3] >> (t === 0 ? 2 : 3)) & 1));
    if (run) this.incTimer(t);
  }

  // ----- timers -----
  incTimer(t) {
    const tmod = this.g(SFR.TMOD);
    const mode = (t === 0 ? tmod : tmod >> 4) & 3;
    const L = t === 0 ? SFR.TL0 : SFR.TL1, H = t === 0 ? SFR.TH0 : SFR.TH1;
    const flag = t === 0 ? 0x20 : 0x80;
    let tl = this.g(L), th = this.g(H), ovf = false;
    if (mode === 0) {
      tl = (tl + 1) & 0x1f;
      if (tl === 0) { th = (th + 1) & 255; if (th === 0) ovf = true; }
    } else if (mode === 1) {
      tl = (tl + 1) & 255;
      if (tl === 0) { th = (th + 1) & 255; if (th === 0) ovf = true; }
    } else if (mode === 2) {
      tl = (tl + 1) & 255;
      if (tl === 0) { ovf = true; tl = th; }
    } else { // mode 3: only timer 0 gets here, as TL0 with TF0
      tl = (tl + 1) & 255;
      if (tl === 0) ovf = true;
    }
    this.s(L, tl); this.s(H, th);
    if (ovf) this.s(SFR.TCON, this.g(SFR.TCON) | flag);
  }

  tickCycle() {
    const tmod = this.g(SFR.TMOD), tcon = this.g(SFR.TCON);
    const int0 = (this.ext[3] >> 2) & 1, int1 = (this.ext[3] >> 3) & 1;
    // level-triggered external interrupts follow the pin
    if (!(tcon & 0x01)) this.s(SFR.TCON, (this.g(SFR.TCON) & ~0x02) | (int0 ? 0 : 0x02));
    if (!(tcon & 0x04)) this.s(SFR.TCON, (this.g(SFR.TCON) & ~0x08) | (int1 ? 0 : 0x08));
    const m0 = tmod & 3, m1 = (tmod >> 4) & 3;
    // timer 0 (TL0)
    if ((tcon & 0x10) && !(tmod & 4) && (!(tmod & 8) || int0)) this.incTimer(0);
    // timer 0 mode 3: TH0 is a second 8-bit timer controlled by TR1, flag TF1
    if (m0 === 3 && (tcon & 0x40)) {
      const th = (this.g(SFR.TH0) + 1) & 255;
      this.s(SFR.TH0, th);
      if (th === 0) this.s(SFR.TCON, this.g(SFR.TCON) | 0x80);
    }
    // timer 1 (stops in mode 3). With timer 0 in mode 3 it runs free (TR1/TF1 belong to TH0).
    if (m1 !== 3) {
      if (m0 !== 3) { if ((tcon & 0x40) && !(tmod & 0x40) && (!(tmod & 0x80) || int1)) this.incTimer(1); }
      else if (!(tmod & 0x40)) this.tickT1Free(m1);
    }
    // serial
    if (this.txRemain > 0 && --this.txRemain === 0) {
      this.s(SFR.SCON, this.g(SFR.SCON) | 0x02);
      if (this.hooks.txByte) this.hooks.txByte(this.txByte);
    }
    if (this.rxRemain > 0) {
      if (--this.rxRemain === 0) { this.sbufRx = this.rxByte; this.s(SFR.SCON, this.g(SFR.SCON) | 0x01); }
    } else if ((this.g(SFR.SCON) & 0x10) && this.rxQueue.length) {
      this.rxByte = this.rxQueue.shift();
      this.rxRemain = this.frameCycles();
    }
  }

  tickT1Free(m1) {
    const L = SFR.TL1, H = SFR.TH1;
    let tl = this.g(L), th = this.g(H);
    if (m1 === 2) { tl = (tl + 1) & 255; if (tl === 0) tl = th; this.s(L, tl); }
    else if (m1 === 1) { tl = (tl + 1) & 255; if (tl === 0) { th = (th + 1) & 255; this.s(H, th); } this.s(L, tl); }
  }

  // ----- serial port -----
  frameCycles() {
    const scon = this.g(SFR.SCON), mode = (scon >> 6) & 3, smod = (this.g(SFR.PCON) >> 7) & 1;
    if (mode === 0) return 8;
    if (mode === 2) return Math.round((11 * 64) / 12 / (1 + smod));
    const tmod = this.g(SFR.TMOD) >> 4;
    const per = (tmod & 3) === 2 ? 256 - this.g(SFR.TH1) : (tmod & 3) === 1 ? 65536 - ((this.g(SFR.TH1) << 8) | this.g(SFR.TL1)) : 8192;
    const bit = (32 / (1 + smod)) * per; // machine cycles per bit
    return Math.round((mode === 1 ? 10 : 11) * bit);
  }
  startTx(v) {
    this.txByte = v & 255;
    this.txRemain = this.frameCycles();
    if ((this.g(SFR.SCON) >> 6) !== 0 && !(this.g(SFR.TCON) & 0x40) && ((this.g(SFR.SCON) >> 6) & 3) !== 2) this.txRemain = 0x7fffffff; // timer 1 stopped: no baud clock
  }
  rxChar(c) { this.rxQueue.push(c & 255); }

  // ----- interrupts -----
  irqPending() {
    const ie = this.g(SFR.IE), tcon = this.g(SFR.TCON), ip = this.g(SFR.IP), scon = this.g(SFR.SCON);
    const src = [
      (tcon & 0x02) && (ie & 0x01), (tcon & 0x20) && (ie & 0x02), (tcon & 0x08) && (ie & 0x04),
      (tcon & 0x80) && (ie & 0x08), (scon & 0x03) && (ie & 0x10),
    ];
    const active = this.isr.length ? Math.max(...this.isr) : -1;
    for (let lvl = 1; lvl >= 0; lvl--) {
      if (lvl <= active) break;
      for (let i = 0; i < 5; i++) if (src[i] && (((ip >> i) & 1) === lvl)) return { i, lvl };
    }
    return null;
  }

  takeIrq() {
    if (!(this.g(SFR.IE) & 0x80)) return 0;
    const p = this.irqPending();
    if (!p) return 0;
    this.idle = false;
    const tcon = this.g(SFR.TCON);
    if (p.i === 0 && (tcon & 1)) this.s(SFR.TCON, tcon & ~0x02);
    if (p.i === 1) this.s(SFR.TCON, tcon & ~0x20);
    if (p.i === 2 && (tcon & 4)) this.s(SFR.TCON, tcon & ~0x08);
    if (p.i === 3) this.s(SFR.TCON, tcon & ~0x80);
    this.push(this.pc & 255);
    this.push(this.pc >> 8);
    this.pc = [0x03, 0x0b, 0x13, 0x1b, 0x23][p.i];
    this.isr.push(p.lvl);
    return 2;
  }

  advance(n) {
    for (let i = 0; i < n; i++) this.tickCycle();
    this.cycles += n;
  }

  /** Executes one instruction or interrupt entry; returns machine cycles used. */
  step() {
    if (this.powerDown) { this.advance(1); return 1; }
    const wasBlocked = this.irqBlock;
    if (this.irqBlock) this.irqBlock--;
    if (!wasBlocked || this.idle) {
      const c = this.takeIrq();
      if (c) { this.advance(c); return c; }
    }
    if (this.idle) { this.advance(1); return 1; }
    this.lastPc = this.pc;
    const op = this.fetch();
    this.lastOp = op;
    const c = this.exec(op);
    this.advance(c);
    this.icount++;
    return c;
  }

  operand(lo) {
    if (lo === 4) return this.fetch();
    if (lo === 5) return this.readDir(this.fetch());
    if (lo < 8) return this.iram[this.R(lo & 1)];
    return this.R(lo & 7);
  }

  add(v, c) {
    const a = this.acc, t = a + v + c;
    const cy = t > 255 ? 1 : 0;
    const ac = ((a & 15) + (v & 15) + c) > 15 ? 1 : 0;
    const c6 = ((a & 127) + (v & 127) + c) > 127 ? 1 : 0;
    this.acc = t;
    let p = this.sfr[0x50] & ~0xc4;
    p |= (cy << 7) | (ac << 6) | ((cy ^ c6) << 2);
    this.sfr[0x50] = p;
  }
  subb(v) {
    const a = this.acc, c = this.cy, t = a - v - c;
    const cy = t < 0 ? 1 : 0;
    const ac = ((a & 15) - (v & 15) - c) < 0 ? 1 : 0;
    const c6 = ((a & 127) - (v & 127) - c) < 0 ? 1 : 0;
    this.acc = t;
    let p = this.sfr[0x50] & ~0xc4;
    p |= (cy << 7) | (ac << 6) | ((cy ^ c6) << 2);
    this.sfr[0x50] = p;
  }

  exec(op) {
    const lo = op & 15, hi = op >> 4;
    if (lo === 1) {
      const lo8 = this.fetch();
      const target = (this.pc & 0xf800) | ((op >> 5) << 8) | lo8;
      if (op & 0x10) { this.push(this.pc & 255); this.push(this.pc >> 8); }
      this.pc = target;
      return 2;
    }
    if (lo < 4) {
      switch (op) {
        case 0x00: return 1;
        case 0x02: { const h = this.fetch(); this.pc = (h << 8) | this.fetch(); return 2; }
        case 0x12: { const h = this.fetch(), l = this.fetch(); this.push(this.pc & 255); this.push(this.pc >> 8); this.pc = (h << 8) | l; return 2; }
        case 0x22: case 0x32: {
          const h = this.pop(), l = this.pop();
          this.pc = (h << 8) | l;
          if (op === 0x32) { this.isr.pop(); this.irqBlock = 1; }
          return 2;
        }
        case 0x03: this.acc = (this.acc >> 1) | ((this.acc & 1) << 7); return 1;
        case 0x13: { const c = this.cy; this.cy = this.acc & 1; this.acc = (this.acc >> 1) | (c << 7); return 1; }
        case 0x23: this.acc = (this.acc << 1) | (this.acc >> 7); return 1;
        case 0x33: { const c = this.cy; this.cy = this.acc >> 7; this.acc = (this.acc << 1) | c; return 1; }
        case 0x10: { const b = this.fetch(); if (this.readBit(b, true)) { this.writeBit(b, 0); this.rel(); } else this.fetch(); return 2; }
        case 0x20: { const b = this.fetch(); if (this.readBit(b)) this.rel(); else this.fetch(); return 2; }
        case 0x30: { const b = this.fetch(); if (!this.readBit(b)) this.rel(); else this.fetch(); return 2; }
        case 0x40: if (this.cy) this.rel(); else this.fetch(); return 2;
        case 0x50: if (!this.cy) this.rel(); else this.fetch(); return 2;
        case 0x60: if (this.acc === 0) this.rel(); else this.fetch(); return 2;
        case 0x70: if (this.acc !== 0) this.rel(); else this.fetch(); return 2;
        case 0x80: this.rel(); return 2;
        case 0x90: { const h = this.fetch(); this.dptr = (h << 8) | this.fetch(); return 2; }
        case 0xa0: { const b = this.fetch(); this.cy = this.cy | (this.readBit(b) ^ 1); return 2; }
        case 0xb0: { const b = this.fetch(); this.cy = this.cy & (this.readBit(b) ^ 1); return 2; }
        case 0xc0: this.push(this.readDir(this.fetch())); return 2;
        case 0xd0: this.writeDir(this.fetch(), this.pop()); return 2;
        case 0xe0: this.acc = this.xr(this.dptr); return 2;
        case 0xf0: this.xw(this.dptr, this.acc); return 2;
        case 0x42: { const d = this.fetch(); this.writeDir(d, this.readDir(d, true) | this.acc); return 1; }
        case 0x52: { const d = this.fetch(); this.writeDir(d, this.readDir(d, true) & this.acc); return 1; }
        case 0x62: { const d = this.fetch(); this.writeDir(d, this.readDir(d, true) ^ this.acc); return 1; }
        case 0x43: { const d = this.fetch(), i = this.fetch(); this.writeDir(d, this.readDir(d, true) | i); return 2; }
        case 0x53: { const d = this.fetch(), i = this.fetch(); this.writeDir(d, this.readDir(d, true) & i); return 2; }
        case 0x63: { const d = this.fetch(), i = this.fetch(); this.writeDir(d, this.readDir(d, true) ^ i); return 2; }
        case 0x72: { const b = this.fetch(); this.cy = this.cy | this.readBit(b); return 2; }
        case 0x82: { const b = this.fetch(); this.cy = this.cy & this.readBit(b); return 2; }
        case 0x92: this.writeBit(this.fetch(), this.cy); return 2;
        case 0xa2: this.cy = this.readBit(this.fetch()); return 1;
        case 0xb2: { const b = this.fetch(); this.writeBit(b, this.readBit(b, true) ^ 1); return 1; }
        case 0xc2: this.writeBit(this.fetch(), 0); return 1;
        case 0xd2: this.writeBit(this.fetch(), 1); return 1;
        case 0x73: this.pc = (this.dptr + this.acc) & 0xffff; return 2;
        case 0x83: this.acc = this.code[(this.pc + this.acc) & 0xffff]; return 2;
        case 0x93: this.acc = this.code[(this.dptr + this.acc) & 0xffff]; return 2;
        case 0xa3: this.dptr = this.dptr + 1; return 2;
        case 0xb3: this.cy ^= 1; return 1;
        case 0xc3: this.cy = 0; return 1;
        case 0xd3: this.cy = 1; return 1;
        case 0xe2: case 0xe3: this.acc = this.xr(((this.sfr[0x20] << 8) | this.R(op & 1))); return 2;
        case 0xf2: case 0xf3: this.xw((this.sfr[0x20] << 8) | this.R(op & 1), this.acc); return 2;
      }
      return 1;
    }
    // lo >= 4
    switch (hi) {
      case 0: // INC
      case 1: { // DEC
        const d = hi === 0 ? 1 : -1;
        if (lo === 4) this.acc = this.acc + d;
        else if (lo === 5) { const a = this.fetch(); this.writeDir(a, this.readDir(a, true) + d); }
        else if (lo < 8) { const r = this.R(lo & 1); this.iram[r] = this.iram[r] + d; }
        else this.setR(lo & 7, this.R(lo & 7) + d);
        return 1;
      }
      case 2: this.add(this.operand(lo), 0); return 1;
      case 3: this.add(this.operand(lo), this.cy); return 1;
      case 4: this.acc = this.acc | this.operand(lo); return 1;
      case 5: this.acc = this.acc & this.operand(lo); return 1;
      case 6: this.acc = this.acc ^ this.operand(lo); return 1;
      case 9: this.subb(this.operand(lo)); return 1;
      case 7: // MOV x,#imm
        if (lo === 4) this.acc = this.fetch();
        else if (lo === 5) { const a = this.fetch(); this.writeDir(a, this.fetch()); return 2; }
        else if (lo < 8) this.iram[this.R(lo & 1)] = this.fetch();
        else this.setR(lo & 7, this.fetch());
        return 1;
      case 8:
        if (lo === 4) { // DIV AB
          const b = this.b;
          let p = this.sfr[0x50] & ~0x84; // clear CY, OV
          if (b === 0) p |= 0x04;
          else { const q = Math.floor(this.acc / b), r = this.acc % b; this.acc = q; this.sfr[0x70] = r; }
          this.sfr[0x50] = p;
          return 4;
        }
        if (lo === 5) { const src = this.fetch(), dst = this.fetch(); this.writeDir(dst, this.readDir(src)); return 2; }
        { const a = this.fetch(); this.writeDir(a, lo < 8 ? this.iram[this.R(lo & 1)] : this.R(lo & 7)); return 2; }
      case 0xa:
        if (lo === 4) { // MUL AB
          const t = this.acc * this.b;
          this.acc = t; this.sfr[0x70] = (t >> 8) & 255;
          let p = this.sfr[0x50] & ~0x84;
          if (t > 255) p |= 0x04;
          this.sfr[0x50] = p;
          return 4;
        }
        if (lo === 5) return 1;
        { const v = this.readDir(this.fetch()); if (lo < 8) this.iram[this.R(lo & 1)] = v; else this.setR(lo & 7, v); return 2; }
      case 0xb: { // CJNE
        let a, b;
        if (lo === 4) { a = this.acc; b = this.fetch(); }
        else if (lo === 5) { a = this.acc; b = this.readDir(this.fetch()); }
        else if (lo < 8) { a = this.iram[this.R(lo & 1)]; b = this.fetch(); }
        else { a = this.R(lo & 7); b = this.fetch(); }
        this.cy = a < b ? 1 : 0;
        if (a !== b) this.rel(); else this.fetch();
        return 2;
      }
      case 0xc: // SWAP / XCH
        if (lo === 4) { this.acc = (this.acc << 4) | (this.acc >> 4); return 1; }
        if (lo === 5) { const a = this.fetch(), v = this.readDir(a, true); this.writeDir(a, this.acc); this.acc = v; }
        else if (lo < 8) { const r = this.R(lo & 1), v = this.iram[r]; this.iram[r] = this.acc; this.acc = v; }
        else { const v = this.R(lo & 7); this.setR(lo & 7, this.acc); this.acc = v; }
        return 1;
      case 0xd:
        if (lo === 4) { // DA A
          let a = this.acc, c = this.cy;
          if ((a & 15) > 9 || (this.sfr[0x50] & 0x40)) { a += 6; if (a > 255) c = 1; }
          if (((a & 0x1f0) >> 4) > 9 || c) { a += 0x60; if (a > 255) c = 1; }
          this.acc = a; this.cy = c;
          return 1;
        }
        if (lo === 5) { const a = this.fetch(), v = (this.readDir(a, true) - 1) & 255; this.writeDir(a, v); if (v !== 0) this.rel(); else this.fetch(); return 2; }
        if (lo === 6 || lo === 7) { const r = this.R(lo & 1), v = this.iram[r]; this.iram[r] = (v & 0xf0) | (this.acc & 15); this.acc = (this.acc & 0xf0) | (v & 15); return 1; }
        { const v = (this.R(lo & 7) - 1) & 255; this.setR(lo & 7, v); if (v !== 0) this.rel(); else this.fetch(); return 2; }
      case 0xe:
        if (lo === 4) this.acc = 0;
        else if (lo === 5) this.acc = this.readDir(this.fetch());
        else if (lo < 8) this.acc = this.iram[this.R(lo & 1)];
        else this.acc = this.R(lo & 7);
        return 1;
      case 0xf:
        if (lo === 4) this.acc = this.acc ^ 255;
        else if (lo === 5) this.writeDir(this.fetch(), this.acc);
        else if (lo < 8) this.iram[this.R(lo & 1)] = this.acc;
        else this.setR(lo & 7, this.acc);
        return 1;
    }
    return 1;
  }
}

const hx = (v, n) => v.toString(16).toUpperCase().padStart(n, "0");
const SFRN = { 0x80: "P0", 0x81: "SP", 0x82: "DPL", 0x83: "DPH", 0x87: "PCON", 0x88: "TCON", 0x89: "TMOD", 0x8a: "TL0", 0x8b: "TL1", 0x8c: "TH0", 0x8d: "TH1", 0x90: "P1", 0x98: "SCON", 0x99: "SBUF", 0xa0: "P2", 0xa8: "IE", 0xb0: "P3", 0xb8: "IP", 0xd0: "PSW", 0xe0: "ACC", 0xf0: "B" };
const dirName = (a) => SFRN[a] || hx(a, 2) + "H";
const bitName = (b) => {
  if (b < 0x80) return `${hx(0x20 + (b >> 3), 2)}H.${b & 7}`;
  const a = b & 0xf8;
  return `${SFRN[a] || hx(a, 2) + "H"}.${b & 7}`;
};

/** Disassembles one instruction; returns {text, len}. */
export function disasm8051(code, pc) {
  const f = (i) => code[(pc + i) & 0xffff];
  const op = f(0), lo = op & 15, hi = op >> 4;
  const rel = (i) => { const r = f(i); return hx((pc + i + 1 + (r < 128 ? r : r - 256)) & 0xffff, 4) + "H"; };
  const w = (i) => hx((f(i) << 8) | f(i + 1), 4) + "H";
  if (lo === 1) {
    const t = ((pc + 2) & 0xf800) | ((op >> 5) << 8) | f(1);
    return { text: `${op & 0x10 ? "ACALL" : "AJMP"} ${hx(t, 4)}H`, len: 2 };
  }
  const T = {
    0x00: "NOP", 0x03: "RR A", 0x13: "RRC A", 0x23: "RL A", 0x33: "RLC A", 0x22: "RET", 0x32: "RETI", 0x73: "JMP @A+DPTR",
    0x83: "MOVC A,@A+PC", 0x93: "MOVC A,@A+DPTR", 0xa3: "INC DPTR", 0xb3: "CPL C", 0xc3: "CLR C", 0xd3: "SETB C",
    0xe0: "MOVX A,@DPTR", 0xf0: "MOVX @DPTR,A", 0xe2: "MOVX A,@R0", 0xe3: "MOVX A,@R1", 0xf2: "MOVX @R0,A", 0xf3: "MOVX @R1,A",
    0x84: "DIV AB", 0xa4: "MUL AB", 0xc4: "SWAP A", 0xd4: "DA A", 0xe4: "CLR A", 0xf4: "CPL A", 0xa5: "DB 0A5H", 0x04: "INC A", 0x14: "DEC A",
  };
  if (T[op]) return { text: T[op], len: 1 };
  const X = (l) => (l === 4 ? [`#${hx(f(1), 2)}H`, 2] : l === 5 ? [dirName(f(1)), 2] : l < 8 ? [`@R${l & 1}`, 1] : [`R${l & 7}`, 1]);
  if (lo < 4) {
    switch (op) {
      case 0x02: return { text: `LJMP ${w(1)}`, len: 3 };
      case 0x12: return { text: `LCALL ${w(1)}`, len: 3 };
      case 0x10: return { text: `JBC ${bitName(f(1))},${rel(2)}`, len: 3 };
      case 0x20: return { text: `JB ${bitName(f(1))},${rel(2)}`, len: 3 };
      case 0x30: return { text: `JNB ${bitName(f(1))},${rel(2)}`, len: 3 };
      case 0x40: return { text: `JC ${rel(1)}`, len: 2 };
      case 0x50: return { text: `JNC ${rel(1)}`, len: 2 };
      case 0x60: return { text: `JZ ${rel(1)}`, len: 2 };
      case 0x70: return { text: `JNZ ${rel(1)}`, len: 2 };
      case 0x80: return { text: `SJMP ${rel(1)}`, len: 2 };
      case 0x90: return { text: `MOV DPTR,#${w(1)}`, len: 3 };
      case 0xa0: return { text: `ORL C,/${bitName(f(1))}`, len: 2 };
      case 0xb0: return { text: `ANL C,/${bitName(f(1))}`, len: 2 };
      case 0xc0: return { text: `PUSH ${dirName(f(1))}`, len: 2 };
      case 0xd0: return { text: `POP ${dirName(f(1))}`, len: 2 };
      case 0x42: return { text: `ORL ${dirName(f(1))},A`, len: 2 };
      case 0x52: return { text: `ANL ${dirName(f(1))},A`, len: 2 };
      case 0x62: return { text: `XRL ${dirName(f(1))},A`, len: 2 };
      case 0x43: return { text: `ORL ${dirName(f(1))},#${hx(f(2), 2)}H`, len: 3 };
      case 0x53: return { text: `ANL ${dirName(f(1))},#${hx(f(2), 2)}H`, len: 3 };
      case 0x63: return { text: `XRL ${dirName(f(1))},#${hx(f(2), 2)}H`, len: 3 };
      case 0x72: return { text: `ORL C,${bitName(f(1))}`, len: 2 };
      case 0x82: return { text: `ANL C,${bitName(f(1))}`, len: 2 };
      case 0x92: return { text: `MOV ${bitName(f(1))},C`, len: 2 };
      case 0xa2: return { text: `MOV C,${bitName(f(1))}`, len: 2 };
      case 0xb2: return { text: `CPL ${bitName(f(1))}`, len: 2 };
      case 0xc2: return { text: `CLR ${bitName(f(1))}`, len: 2 };
      case 0xd2: return { text: `SETB ${bitName(f(1))}`, len: 2 };
    }
  }
  const [x, xl] = X(lo);
  switch (hi) {
    case 0: return { text: `INC ${x}`, len: xl };
    case 1: return { text: `DEC ${x}`, len: xl };
    case 2: return { text: `ADD A,${x}`, len: xl };
    case 3: return { text: `ADDC A,${x}`, len: xl };
    case 4: return { text: `ORL A,${x}`, len: xl };
    case 5: return { text: `ANL A,${x}`, len: xl };
    case 6: return { text: `XRL A,${x}`, len: xl };
    case 9: return { text: `SUBB A,${x}`, len: xl };
    case 7:
      if (lo === 5) return { text: `MOV ${dirName(f(1))},#${hx(f(2), 2)}H`, len: 3 };
      return { text: `MOV ${lo === 4 ? "A" : lo < 8 ? `@R${lo & 1}` : `R${lo & 7}`},#${hx(f(1), 2)}H`, len: 2 };
    case 8:
      if (lo === 5) return { text: `MOV ${dirName(f(2))},${dirName(f(1))}`, len: 3 };
      return { text: `MOV ${dirName(f(1))},${lo < 8 ? `@R${lo & 1}` : `R${lo & 7}`}`, len: 2 };
    case 0xa:
      return { text: `MOV ${lo < 8 ? `@R${lo & 1}` : `R${lo & 7}`},${dirName(f(1))}`, len: 2 };
    case 0xb: {
      const [y, yl] = X(lo);
      const first = lo < 6 ? "A" : x.replace(/^#.*/, "");
      if (lo === 4) return { text: `CJNE A,#${hx(f(1), 2)}H,${rel(2)}`, len: 3 };
      if (lo === 5) return { text: `CJNE A,${dirName(f(1))},${rel(2)}`, len: 3 };
      return { text: `CJNE ${lo < 8 ? `@R${lo & 1}` : `R${lo & 7}`},#${hx(f(1), 2)}H,${rel(2)}`, len: 3 };
    }
    case 0xc: return { text: `XCH A,${x}`, len: xl };
    case 0xd:
      if (lo === 5) return { text: `DJNZ ${dirName(f(1))},${rel(2)}`, len: 3 };
      if (lo < 8) return { text: `XCHD A,@R${lo & 1}`, len: 1 };
      return { text: `DJNZ R${lo & 7},${rel(1)}`, len: 2 };
    case 0xe: return { text: `MOV A,${x}`, len: xl };
    case 0xf: return { text: `MOV ${x},A`, len: xl };
  }
  return { text: `DB ${hx(op, 2)}H`, len: 1 };
}
