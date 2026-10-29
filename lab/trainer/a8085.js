// Two-pass 8085 assembler. Directives: ORG, EQU, SET, DB, DW, DS, END. Output = bytes by address plus a listing.
import { AsmError, UndefinedSymbol, evalExpr, parseLine, splitArgs, dbBytes, hex } from "./common.js";

const REG = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, M: 6, A: 7 };
const RP = { B: 0, BC: 0, D: 1, DE: 1, H: 2, HL: 2, SP: 3 };
const RPP = { B: 0, BC: 0, D: 1, DE: 1, H: 2, HL: 2, PSW: 3 };

const NOARG = {
  NOP: 0x00, HLT: 0x76, RLC: 0x07, RRC: 0x0f, RAL: 0x17, RAR: 0x1f, DAA: 0x27, CMA: 0x2f, STC: 0x37, CMC: 0x3f,
  XCHG: 0xeb, XTHL: 0xe3, SPHL: 0xf9, PCHL: 0xe9, RET: 0xc9, EI: 0xfb, DI: 0xf3, RIM: 0x20, SIM: 0x30,
  RNZ: 0xc0, RZ: 0xc8, RNC: 0xd0, RC: 0xd8, RPO: 0xe0, RPE: 0xe8, RP: 0xf0, RM: 0xf8,
};
const REG_SRC = { ADD: 0x80, ADC: 0x88, SUB: 0x90, SBB: 0x98, ANA: 0xa0, XRA: 0xa8, ORA: 0xb0, CMP: 0xb8 };
const REG_DST = { INR: 0x04, DCR: 0x05 };
const RP_OP = { INX: 0x03, DCX: 0x0b, DAD: 0x09 };
const IMM8 = { ADI: 0xc6, ACI: 0xce, SUI: 0xd6, SBI: 0xde, ANI: 0xe6, XRI: 0xee, ORI: 0xf6, CPI: 0xfe };
const ADDR16 = {
  JMP: 0xc3, JNZ: 0xc2, JZ: 0xca, JNC: 0xd2, JC: 0xda, JPO: 0xe2, JPE: 0xea, JP: 0xf2, JM: 0xfa,
  CALL: 0xcd, CNZ: 0xc4, CZ: 0xcc, CNC: 0xd4, CC: 0xdc, CPO: 0xe4, CPE: 0xec, CP: 0xf4, CM: 0xfc,
  LDA: 0x3a, STA: 0x32, LHLD: 0x2a, SHLD: 0x22,
};
const PORT = { IN: 0xdb, OUT: 0xd3 };

export const MNEMONICS_8085 = new Set([
  ...Object.keys(NOARG), ...Object.keys(REG_SRC), ...Object.keys(REG_DST), ...Object.keys(RP_OP), ...Object.keys(IMM8),
  ...Object.keys(ADDR16), ...Object.keys(PORT), "MOV", "MVI", "LXI", "PUSH", "POP", "STAX", "LDAX", "RST",
]);

function regOf(s, what = "register") {
  const r = REG[s.trim().toUpperCase()];
  if (r === undefined) throw new AsmError(`expected ${what}, got '${s}'`);
  return r;
}

/** Assembles source text. Returns {bytes: Uint8Array(65536), segments, listing, symbols, errors, warnings, start}. */
export function assemble8085(source) {
  const lines = source.split(/\r?\n/);
  const symbols = new Map();
  let errors = [], warnings = [];
  const bytes = new Uint8Array(65536);
  let listing = [];
  let segments = [];
  let start = null;

  for (let pass = 1; pass <= 2; pass++) {
    let pc = 0;
    errors = []; warnings = []; listing = []; segments = [];
    let seg = null;
    const ctx = {
      get pc() { return pc; },
      lookup: (n) => symbols.get(n.toUpperCase()),
    };
    const emit = (list) => {
      if (!list.length) return;
      if (!seg || seg.end !== pc) { seg = { start: pc, end: pc }; segments.push(seg); }
      for (const b of list) { if (pass === 2) bytes[pc] = b & 255; pc = (pc + 1) & 0xffff; seg.end = pc; }
    };
    const val = (s) => {
      try { return evalExpr(s, ctx); } catch (e) {
        if (e instanceof UndefinedSymbol && pass === 1) return 0;
        throw e;
      }
    };
    const imm8 = (s) => {
      const v = val(s);
      if (v < -128 || v > 255) throw new AsmError(`value ${v} does not fit in 8 bits`);
      return v & 255;
    };
    const a16 = (s) => {
      const v = val(s);
      if (v < -32768 || v > 65535) throw new AsmError(`value ${v} does not fit in 16 bits`);
      return v & 0xffff;
    };

    lines.forEach((raw, idx) => {
      const ln = idx + 1;
      const startPc = pc;
      let out = [];
      try {
        const { label, op, rest, definer } = parseLine(raw);
        if (label && !(definer && (op === "EQU" || op === "SET"))) {
          const key = label.toUpperCase();
          if (pass === 1 && symbols.has(key)) throw new AsmError(`label '${label}' is already defined`);
          if (pass === 1) symbols.set(key, pc);
        }
        const args = splitArgs(rest);
        if (!op) { listing.push({ line: ln, addr: null, bytes: [], src: raw }); return; }
        if (op === "ORG") { pc = a16(args[0] ?? ""); if (start === null && pass === 2) start = pc; listing.push({ line: ln, addr: pc, bytes: [], src: raw }); return; }
        if (op === "END") { listing.push({ line: ln, addr: null, bytes: [], src: raw }); return; }
        if (op === "EQU" || op === "SET") {
          if (!label) throw new AsmError(`${op} needs a name`);
          const v = val(args[0] ?? "");
          if (op === "SET" || pass === 1) symbols.set(label.toUpperCase(), v);
          listing.push({ line: ln, addr: null, bytes: [], src: raw, value: v });
          return;
        }
        if (op === "DB" || op === "DEFB") out = dbBytes(args, { ...ctx, lookup: (n) => { const v = ctx.lookup(n); return v === undefined && pass === 1 ? 0 : v; } }).map((v) => v & 255);
        else if (op === "DW" || op === "DEFW") for (const a of args) { const v = a16(a); out.push(v & 255, v >> 8); }
        else if (op === "DS" || op === "DEFS") {
          const n = val(args[0] ?? "");
          if (n < 0 || n > 65536) throw new AsmError("bad DS size");
          pc = (pc + n) & 0xffff;
          listing.push({ line: ln, addr: startPc, bytes: [], src: raw });
          return;
        } else if (op in NOARG) { need(args, 0, op); out = [NOARG[op]]; }
        else if (op in REG_SRC) { need(args, 1, op); out = [REG_SRC[op] | regOf(args[0])]; }
        else if (op in REG_DST) { need(args, 1, op); out = [REG_DST[op] | (regOf(args[0]) << 3)]; }
        else if (op in RP_OP) {
          need(args, 1, op);
          const r = RP[args[0].toUpperCase()];
          if (r === undefined) throw new AsmError(`${op} needs B, D, H or SP`);
          out = [RP_OP[op] | (r << 4)];
        } else if (op in IMM8) { need(args, 1, op); out = [IMM8[op], imm8(args[0])]; }
        else if (op in ADDR16) { need(args, 1, op); const v = a16(args[0]); out = [ADDR16[op], v & 255, v >> 8]; }
        else if (op in PORT) {
          need(args, 1, op);
          const v = val(args[0]);
          if (v < 0 || v > 255) throw new AsmError("port address must be 00H-FFH");
          out = [PORT[op], v];
        } else if (op === "MOV") {
          need(args, 2, op);
          const d = regOf(args[0]), s = regOf(args[1]);
          if (d === 6 && s === 6) throw new AsmError("MOV M,M is not allowed (that opcode is HLT)");
          out = [0x40 | (d << 3) | s];
        } else if (op === "MVI") { need(args, 2, op); out = [0x06 | (regOf(args[0]) << 3), imm8(args[1])]; }
        else if (op === "LXI") {
          need(args, 2, op);
          const r = RP[args[0].toUpperCase()];
          if (r === undefined) throw new AsmError("LXI needs B, D, H or SP");
          const v = a16(args[1]);
          out = [0x01 | (r << 4), v & 255, v >> 8];
        } else if (op === "PUSH" || op === "POP") {
          need(args, 1, op);
          const r = RPP[args[0].toUpperCase()];
          if (r === undefined) throw new AsmError(`${op} needs B, D, H or PSW`);
          out = [(op === "PUSH" ? 0xc5 : 0xc1) | (r << 4)];
        } else if (op === "STAX" || op === "LDAX") {
          need(args, 1, op);
          const r = args[0].toUpperCase();
          if (r !== "B" && r !== "D" && r !== "BC" && r !== "DE") throw new AsmError(`${op} needs B or D`);
          out = [(op === "STAX" ? 0x02 : 0x0a) | ((r[0] === "D" ? 1 : 0) << 4)];
        } else if (op === "RST") {
          need(args, 1, op);
          const n = val(args[0]);
          if (n < 0 || n > 7) throw new AsmError("RST number must be 0-7");
          out = [0xc7 | (n << 3)];
        } else throw new AsmError(`unknown instruction '${op}'`);
        emit(out);
        listing.push({ line: ln, addr: startPc, bytes: out, src: raw });
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        if (pass === 2 || !(e instanceof UndefinedSymbol)) {
          if (!(pass === 1 && e instanceof UndefinedSymbol)) errors.push({ line: ln, msg: e.message });
        }
        listing.push({ line: ln, addr: null, bytes: [], src: raw, error: e.message });
      }
    });
    if (pass === 1 && errors.length === 0) continue;
    if (pass === 1) { /* keep going so pass 2 reports everything */ }
  }

  // 8085 hardware vectors and monitor service area
  for (const seg of segments) {
    if (seg.start < 0x0040 && seg.end > 0x0024 && seg.start !== 0) warnings.push({ line: 0, msg: `code in ${hex(seg.start, 4)}H-${hex(seg.end - 1, 4)}H overlaps interrupt vectors` });
    if (seg.start < 0x0320 && seg.end > 0x0300) warnings.push({ line: 0, msg: `code in ${hex(seg.start, 4)}H-${hex(seg.end - 1, 4)}H overlaps the monitor service routines (0300H-031FH)` });
  }
  if (start === null && segments.length) start = segments[0].start;
  const flat = [];
  for (const e of errors) if (!flat.some((x) => x.line === e.line && x.msg === e.msg)) flat.push(e);
  return { bytes, segments, listing, symbols, errors: flat, warnings, start: start ?? 0 };
}

function need(args, n, op) {
  if (args.length !== n) throw new AsmError(`${op} takes ${n} operand${n === 1 ? "" : "s"}`);
}
