// Intel 8085 CPU core: all documented instructions, flags incl. AC, T-state counts, TRAP/RST7.5/6.5/5.5/INTR, SID/SOD, RIM/SIM.

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 1, v = i;
  while (v) { p ^= v & 1; v >>= 1; }
  PARITY[i] = p; // 1 = even parity
}

export const REG_NAMES = ["B", "C", "D", "E", "H", "L", "M", "A"];

export class I8085 {
  constructor(io) {
    this.mem = new Uint8Array(65536);
    this.io = io || { in: () => 0xff, out: () => {} };
    this.reset();
  }

  reset() {
    this.r = new Uint8Array(8); // B C D E H L (M) A
    this.pc = 0;
    this.sp = 0;
    this.s = this.z = this.ac = this.p = this.cy = 0;
    this.ie = 0;
    this.m55 = this.m65 = this.m75 = 1; // masked after reset
    this.r75 = 0; // RST7.5 edge latch
    this.pin55 = this.pin65 = 0; // level inputs
    this.trapPending = 0;
    this.intrReq = false;
    this.intrOp = 0xff;
    this.eiDelay = 0;
    this.halted = false;
    this.sod = 0;
    this.sid = 0;
    this.tstates = 0;
    this.icount = 0;
    this.lastOp = 0;
    this.lastPc = 0;
  }

  // ----- registers -----
  get a() { return this.r[7]; }
  set a(v) { this.r[7] = v & 255; }
  get hl() { return (this.r[4] << 8) | this.r[5]; }
  set hl(v) { this.r[4] = (v >> 8) & 255; this.r[5] = v & 255; }
  get bc() { return (this.r[0] << 8) | this.r[1]; }
  get de() { return (this.r[2] << 8) | this.r[3]; }
  get f() { return (this.s << 7) | (this.z << 6) | (this.ac << 4) | (this.p << 2) | this.cy; }
  set f(v) { this.s = (v >> 7) & 1; this.z = (v >> 6) & 1; this.ac = (v >> 4) & 1; this.p = (v >> 2) & 1; this.cy = v & 1; }

  rd(a) { return this.mem[a & 0xffff]; }
  wr(a, v) { this.mem[a & 0xffff] = v & 255; }
  fetch8() { const v = this.mem[this.pc]; this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const lo = this.fetch8(); return lo | (this.fetch8() << 8); }
  get8(i) { return i === 6 ? this.mem[this.hl] : this.r[i]; }
  set8(i, v) { if (i === 6) this.mem[this.hl] = v & 255; else this.r[i] = v & 255; }
  getRP(i) { return i === 3 ? this.sp : (this.r[i * 2] << 8) | this.r[i * 2 + 1]; }
  setRP(i, v) { v &= 0xffff; if (i === 3) this.sp = v; else { this.r[i * 2] = v >> 8; this.r[i * 2 + 1] = v & 255; } }
  push16(v) { this.sp = (this.sp - 1) & 0xffff; this.mem[this.sp] = v >> 8; this.sp = (this.sp - 1) & 0xffff; this.mem[this.sp] = v & 255; }
  pop16() { const lo = this.mem[this.sp]; this.sp = (this.sp + 1) & 0xffff; const hi = this.mem[this.sp]; this.sp = (this.sp + 1) & 0xffff; return (hi << 8) | lo; }

  szp(v) { this.s = (v >> 7) & 1; this.z = v === 0 ? 1 : 0; this.p = PARITY[v]; }

  add(a, b, c) {
    const t = a + b + c;
    this.ac = ((a & 15) + (b & 15) + c) > 15 ? 1 : 0;
    this.cy = t > 255 ? 1 : 0;
    const v = t & 255;
    this.szp(v);
    return v;
  }

  sub(a, b, c) {
    const nb = (~b) & 255, ci = c ? 0 : 1;
    const t = a + nb + ci;
    this.ac = ((a & 15) + (nb & 15) + ci) > 15 ? 1 : 0;
    this.cy = t > 255 ? 0 : 1;
    const v = t & 255;
    this.szp(v);
    return v;
  }

  alu(k, v) {
    const a = this.r[7];
    switch (k) {
      case 0: this.r[7] = this.add(a, v, 0); break;
      case 1: this.r[7] = this.add(a, v, this.cy); break;
      case 2: this.r[7] = this.sub(a, v, 0); break;
      case 3: this.r[7] = this.sub(a, v, this.cy); break;
      case 4: this.r[7] = a & v; this.szp(this.r[7]); this.cy = 0; this.ac = 1; break;
      case 5: this.r[7] = a ^ v; this.szp(this.r[7]); this.cy = 0; this.ac = 0; break;
      case 6: this.r[7] = a | v; this.szp(this.r[7]); this.cy = 0; this.ac = 0; break;
      case 7: this.sub(a, v, 0); break;
    }
  }

  cond(c) {
    switch (c) {
      case 0: return !this.z;
      case 1: return !!this.z;
      case 2: return !this.cy;
      case 3: return !!this.cy;
      case 4: return !this.p;
      case 5: return !!this.p;
      case 6: return !this.s;
      default: return !!this.s;
    }
  }

  // ----- external pins -----
  trap() { this.trapPending = 1; }
  raise75() { this.r75 = 1; }
  setIntr(on, op = 0xff) { this.intrReq = !!on; this.intrOp = op; }

  vector(addr) {
    this.push16(this.pc);
    this.pc = addr;
    this.ie = 0;
    this.halted = false;
    return 12;
  }

  pollInt() {
    if (this.trapPending) { this.trapPending = 0; return this.vector(0x24); }
    if (!this.ie) return 0;
    if (this.r75 && !this.m75) { this.r75 = 0; return this.vector(0x3c); }
    if (this.pin65 && !this.m65) return this.vector(0x34);
    if (this.pin55 && !this.m55) return this.vector(0x2c);
    if (this.intrReq) {
      this.intrReq = false;
      this.ie = 0;
      this.halted = false;
      const op = this.intrOp;
      if ((op & 0xc7) === 0xc7) { this.push16(this.pc); this.pc = op & 0x38; return 12; }
      if (op === 0xcd) { this.push16(this.pc); this.pc = 0; return 18; }
      return 12;
    }
    return 0;
  }

  /** Executes one instruction (or services an interrupt). Returns the T-states consumed. */
  step() {
    const block = this.eiDelay;
    this.eiDelay = 0;
    if (!block) {
      const t = this.pollInt();
      if (t) { this.tstates += t; return t; }
    }
    if (this.halted) { this.tstates += 3; return 3; }
    this.lastPc = this.pc;
    const op = this.fetch8();
    this.lastOp = op;
    const t = this.exec(op);
    this.tstates += t;
    this.icount++;
    return t;
  }

  exec(op) {
    if (op >= 0x40 && op <= 0x7f) {
      if (op === 0x76) { this.halted = true; return 5; }
      const d = (op >> 3) & 7, s = op & 7;
      this.set8(d, this.get8(s));
      return d === 6 || s === 6 ? 7 : 4;
    }
    if (op >= 0x80 && op <= 0xbf) {
      this.alu((op >> 3) & 7, this.get8(op & 7));
      return (op & 7) === 6 ? 7 : 4;
    }
    switch (op & 0xc7) {
      case 0x06: { const d = (op >> 3) & 7; this.set8(d, this.fetch8()); return d === 6 ? 10 : 7; }
      case 0x04: { const d = (op >> 3) & 7, v = this.get8(d), n = (v + 1) & 255; this.ac = (v & 15) === 15 ? 1 : 0; this.szp(n); this.set8(d, n); return d === 6 ? 10 : 4; }
      case 0x05: { const d = (op >> 3) & 7, v = this.get8(d), n = (v - 1) & 255; this.ac = (v & 15) !== 0 ? 1 : 0; this.szp(n); this.set8(d, n); return d === 6 ? 10 : 4; }
      case 0xc7: this.push16(this.pc); this.pc = op & 0x38; return 12;
      case 0xc0: { if (this.cond((op >> 3) & 7)) { this.pc = this.pop16(); return 12; } return 6; }
      case 0xc2: { const a = this.fetch16(); if (this.cond((op >> 3) & 7)) this.pc = a; return this.cond((op >> 3) & 7) ? 10 : 7; }
      case 0xc4: { const a = this.fetch16(); if (this.cond((op >> 3) & 7)) { this.push16(this.pc); this.pc = a; return 18; } return 9; }
      case 0xc6: this.alu((op >> 3) & 7, this.fetch8()); return 7;
    }
    switch (op & 0xcf) {
      case 0x01: this.setRP((op >> 4) & 3, this.fetch16()); return 10;
      case 0x03: this.setRP((op >> 4) & 3, this.getRP((op >> 4) & 3) + 1); return 6;
      case 0x0b: this.setRP((op >> 4) & 3, this.getRP((op >> 4) & 3) - 1); return 6;
      case 0x09: { const t = this.hl + this.getRP((op >> 4) & 3); this.cy = t > 0xffff ? 1 : 0; this.hl = t; return 10; }
      case 0xc1: {
        const i = (op >> 4) & 3, v = this.pop16();
        if (i === 3) { this.f = v & 255; this.r[7] = v >> 8; } else this.setRP(i, v);
        return 10;
      }
      case 0xc5: {
        const i = (op >> 4) & 3;
        this.push16(i === 3 ? (this.r[7] << 8) | this.f : this.getRP(i));
        return 12;
      }
    }
    switch (op) {
      case 0x00: case 0x08: case 0x10: case 0x18: case 0x28: case 0x38: case 0xcb: case 0xd9: case 0xdd: case 0xed: case 0xfd: return 4;
      case 0x02: this.wr(this.bc, this.r[7]); return 7;
      case 0x12: this.wr(this.de, this.r[7]); return 7;
      case 0x0a: this.r[7] = this.rd(this.bc); return 7;
      case 0x1a: this.r[7] = this.rd(this.de); return 7;
      case 0x07: { const c = this.r[7] >> 7; this.r[7] = ((this.r[7] << 1) | c) & 255; this.cy = c; return 4; }
      case 0x0f: { const c = this.r[7] & 1; this.r[7] = (this.r[7] >> 1) | (c << 7); this.cy = c; return 4; }
      case 0x17: { const c = this.r[7] >> 7; this.r[7] = ((this.r[7] << 1) | this.cy) & 255; this.cy = c; return 4; }
      case 0x1f: { const c = this.r[7] & 1; this.r[7] = (this.r[7] >> 1) | (this.cy << 7); this.cy = c; return 4; }
      case 0x20: { // RIM
        this.r[7] = (this.sid << 7) | (this.r75 << 6) | (this.pin65 << 5) | (this.pin55 << 4) | (this.ie << 3) | (this.m75 << 2) | (this.m65 << 1) | this.m55;
        return 4;
      }
      case 0x30: { // SIM
        const a = this.r[7];
        if (a & 0x08) { this.m55 = a & 1; this.m65 = (a >> 1) & 1; this.m75 = (a >> 2) & 1; }
        if (a & 0x10) this.r75 = 0;
        if (a & 0x40) this.sod = (a >> 7) & 1;
        return 4;
      }
      case 0x22: { const a = this.fetch16(); this.wr(a, this.r[5]); this.wr(a + 1, this.r[4]); return 16; }
      case 0x2a: { const a = this.fetch16(); this.r[5] = this.rd(a); this.r[4] = this.rd(a + 1); return 16; }
      case 0x32: this.wr(this.fetch16(), this.r[7]); return 13;
      case 0x3a: this.r[7] = this.rd(this.fetch16()); return 13;
      case 0x27: { // DAA
        let a = this.r[7], c = this.cy, ac = 0;
        if ((a & 15) > 9 || this.ac) { ac = ((a & 15) + 6) > 15 ? 1 : 0; a += 6; if (a > 255) c = 1; a &= 255; }
        if ((a >> 4) > 9 || c) { a += 0x60; if (a > 255) c = 1; a &= 255; }
        this.r[7] = a; this.szp(a); this.cy = c; this.ac = ac;
        return 4;
      }
      case 0x2f: this.r[7] ^= 255; return 4;
      case 0x37: this.cy = 1; return 4;
      case 0x3f: this.cy ^= 1; return 4;
      case 0xc3: this.pc = this.fetch16(); return 10;
      case 0xc9: this.pc = this.pop16(); return 10;
      case 0xcd: { const a = this.fetch16(); this.push16(this.pc); this.pc = a; return 18; }
      case 0xd3: this.io.out(this.fetch8(), this.r[7]); return 10;
      case 0xdb: { const v = this.io.in(this.fetch8()); this.r[7] = v === undefined ? 0xff : v & 255; return 10; }
      case 0xe3: { const lo = this.rd(this.sp), hi = this.rd(this.sp + 1); this.wr(this.sp, this.r[5]); this.wr(this.sp + 1, this.r[4]); this.r[5] = lo; this.r[4] = hi; return 16; }
      case 0xe9: this.pc = this.hl; return 6;
      case 0xeb: { const d = this.r[2], e = this.r[3]; this.r[2] = this.r[4]; this.r[3] = this.r[5]; this.r[4] = d; this.r[5] = e; return 4; }
      case 0xf3: this.ie = 0; return 4;
      case 0xfb: this.ie = 1; this.eiDelay = 1; return 4;
      case 0xf9: this.sp = this.hl; return 6;
    }
    return 4;
  }
}

// Mnemonic text for the disassembly column / trace.
const ALU = ["ADD", "ADC", "SUB", "SBB", "ANA", "XRA", "ORA", "CMP"];
const ALUI = ["ADI", "ACI", "SUI", "SBI", "ANI", "XRI", "ORI", "CPI"];
const CC = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
const RPN = ["B", "D", "H", "SP"];
const RPP = ["B", "D", "H", "PSW"];
const hx = (v, n) => v.toString(16).toUpperCase().padStart(n, "0");

/** Disassembles the instruction at addr; returns {text, len}. */
export function disasm8085(mem, addr) {
  const op = mem[addr & 0xffff];
  const b1 = mem[(addr + 1) & 0xffff], b2 = mem[(addr + 2) & 0xffff];
  const w = (b2 << 8) | b1;
  const R = (i) => REG_NAMES[i];
  if (op >= 0x40 && op <= 0x7f) return op === 0x76 ? { text: "HLT", len: 1 } : { text: `MOV ${R((op >> 3) & 7)},${R(op & 7)}`, len: 1 };
  if (op >= 0x80 && op <= 0xbf) return { text: `${ALU[(op >> 3) & 7]} ${R(op & 7)}`, len: 1 };
  switch (op & 0xc7) {
    case 0x06: return { text: `MVI ${R((op >> 3) & 7)},${hx(b1, 2)}H`, len: 2 };
    case 0x04: return { text: `INR ${R((op >> 3) & 7)}`, len: 1 };
    case 0x05: return { text: `DCR ${R((op >> 3) & 7)}`, len: 1 };
    case 0xc7: return { text: `RST ${(op >> 3) & 7}`, len: 1 };
    case 0xc0: return { text: `R${CC[(op >> 3) & 7]}`, len: 1 };
    case 0xc2: return { text: `J${CC[(op >> 3) & 7]} ${hx(w, 4)}H`, len: 3 };
    case 0xc4: return { text: `C${CC[(op >> 3) & 7]} ${hx(w, 4)}H`, len: 3 };
    case 0xc6: return { text: `${ALUI[(op >> 3) & 7]} ${hx(b1, 2)}H`, len: 2 };
  }
  switch (op & 0xcf) {
    case 0x01: return { text: `LXI ${RPN[(op >> 4) & 3]},${hx(w, 4)}H`, len: 3 };
    case 0x03: return { text: `INX ${RPN[(op >> 4) & 3]}`, len: 1 };
    case 0x0b: return { text: `DCX ${RPN[(op >> 4) & 3]}`, len: 1 };
    case 0x09: return { text: `DAD ${RPN[(op >> 4) & 3]}`, len: 1 };
    case 0xc1: return { text: `POP ${RPP[(op >> 4) & 3]}`, len: 1 };
    case 0xc5: return { text: `PUSH ${RPP[(op >> 4) & 3]}`, len: 1 };
  }
  const T = {
    0x00: ["NOP"], 0x02: ["STAX B"], 0x12: ["STAX D"], 0x0a: ["LDAX B"], 0x1a: ["LDAX D"], 0x07: ["RLC"], 0x0f: ["RRC"],
    0x17: ["RAL"], 0x1f: ["RAR"], 0x20: ["RIM"], 0x30: ["SIM"], 0x27: ["DAA"], 0x2f: ["CMA"], 0x37: ["STC"], 0x3f: ["CMC"],
    0xc9: ["RET"], 0xe3: ["XTHL"], 0xe9: ["PCHL"], 0xeb: ["XCHG"], 0xf3: ["DI"], 0xfb: ["EI"], 0xf9: ["SPHL"],
  };
  if (T[op]) return { text: T[op][0], len: 1 };
  switch (op) {
    case 0x22: return { text: `SHLD ${hx(w, 4)}H`, len: 3 };
    case 0x2a: return { text: `LHLD ${hx(w, 4)}H`, len: 3 };
    case 0x32: return { text: `STA ${hx(w, 4)}H`, len: 3 };
    case 0x3a: return { text: `LDA ${hx(w, 4)}H`, len: 3 };
    case 0xc3: return { text: `JMP ${hx(w, 4)}H`, len: 3 };
    case 0xcd: return { text: `CALL ${hx(w, 4)}H`, len: 3 };
    case 0xd3: return { text: `OUT ${hx(b1, 2)}H`, len: 2 };
    case 0xdb: return { text: `IN ${hx(b1, 2)}H`, len: 2 };
  }
  return { text: `DB ${hx(op, 2)}H`, len: 1 };
}
