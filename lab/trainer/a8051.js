// Two-pass 8051 assembler (Keil/ASEM style). Directives: ORG, EQU, SET, DATA, IDATA, XDATA, CODE, BIT, DB, DW, DS, DBIT, END.
import { AsmError, UndefinedSymbol, evalExpr, parseLine, splitArgs, dbBytes, hex } from "./common.js";

const PREDEF = {
  P0: 0x80, SP: 0x81, DPL: 0x82, DPH: 0x83, PCON: 0x87, TCON: 0x88, TMOD: 0x89, TL0: 0x8a, TL1: 0x8b, TH0: 0x8c, TH1: 0x8d,
  P1: 0x90, SCON: 0x98, SBUF: 0x99, P2: 0xa0, IE: 0xa8, P3: 0xb0, IP: 0xb8, PSW: 0xd0, ACC: 0xe0, B: 0xf0,
  // bits
  IT0: 0x88, IE0: 0x89, IT1: 0x8a, IE1: 0x8b, TR0: 0x8c, TF0: 0x8d, TR1: 0x8e, TF1: 0x8f,
  RI: 0x98, TI: 0x99, RB8: 0x9a, TB8: 0x9b, REN: 0x9c, SM2: 0x9d, SM1: 0x9e, SM0: 0x9f,
  EX0: 0xa8, ET0: 0xa9, EX1: 0xaa, ET1: 0xab, ES: 0xac, EA: 0xaf,
  PX0: 0xb8, PT0: 0xb9, PX1: 0xba, PT1: 0xbb, PS: 0xbc,
  RXD: 0xb0, TXD: 0xb1, INT0: 0xb2, INT1: 0xb3, T0: 0xb4, T1: 0xb5, WR: 0xb6, RD: 0xb7,
  P: 0xd0, OV: 0xd2, RS0: 0xd3, RS1: 0xd4, F0: 0xd5, AC: 0xd6, CY: 0xd7,
};
const RESERVED = new Set(["A", "AB", "C", "DPTR", "R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"]);

// [mnemonic, operand pattern, opcode, byte fields]; a field is an operand index (1 byte), "16:i" (two bytes),
// "rel:i" (relative branch) or an array. Rn / @Ri add the register number to the opcode.
const T = [];
const add = (m, pats, op, fields = []) => T.push({ m, pats, op, fields });
add("NOP", [], 0x00);
add("LJMP", ["a16"], 0x02, ["16:0"]);
add("LCALL", ["a16"], 0x12, ["16:0"]);
add("AJMP", ["a11"], 0x01, ["a11:0"]);
add("ACALL", ["a11"], 0x11, ["a11:0"]);
add("SJMP", ["rel"], 0x80, ["rel:0"]);
add("RET", [], 0x22); add("RETI", [], 0x32);
add("RR", ["A"], 0x03); add("RRC", ["A"], 0x13); add("RL", ["A"], 0x23); add("RLC", ["A"], 0x33);
add("INC", ["A"], 0x04); add("INC", ["dir"], 0x05, [0]); add("INC", ["@Ri"], 0x06); add("INC", ["Rn"], 0x08); add("INC", ["DPTR"], 0xa3);
add("DEC", ["A"], 0x14); add("DEC", ["dir"], 0x15, [0]); add("DEC", ["@Ri"], 0x16); add("DEC", ["Rn"], 0x18);
add("JBC", ["bit", "rel"], 0x10, [0, "rel:1"]); add("JB", ["bit", "rel"], 0x20, [0, "rel:1"]); add("JNB", ["bit", "rel"], 0x30, [0, "rel:1"]);
add("JC", ["rel"], 0x40, ["rel:0"]); add("JNC", ["rel"], 0x50, ["rel:0"]); add("JZ", ["rel"], 0x60, ["rel:0"]); add("JNZ", ["rel"], 0x70, ["rel:0"]);
for (const [m, base] of [["ADD", 0x20], ["ADDC", 0x30], ["ORL", 0x40], ["ANL", 0x50], ["XRL", 0x60], ["SUBB", 0x90]]) {
  add(m, ["A", "#d"], base + 4, [1]); add(m, ["A", "dir"], base + 5, [1]); add(m, ["A", "@Ri"], base + 6); add(m, ["A", "Rn"], base + 8);
}
for (const [m, base] of [["ORL", 0x42], ["ANL", 0x52], ["XRL", 0x62]]) { add(m, ["dir", "A"], base, [0]); add(m, ["dir", "#d"], base + 1, [0, 1]); }
add("ORL", ["C", "bit"], 0x72, [1]); add("ORL", ["C", "/bit"], 0xa0, [1]);
add("ANL", ["C", "bit"], 0x82, [1]); add("ANL", ["C", "/bit"], 0xb0, [1]);
add("JMP", ["@A+DPTR"], 0x73);
add("MOV", ["A", "#d"], 0x74, [1]); add("MOV", ["dir", "#d"], 0x75, [0, 1]); add("MOV", ["@Ri", "#d"], 0x76, [1]); add("MOV", ["Rn", "#d"], 0x78, [1]);
add("MOV", ["dir", "dir"], 0x85, [1, 0]); add("MOV", ["dir", "@Ri"], 0x86, [0]); add("MOV", ["dir", "Rn"], 0x88, [0]);
add("MOV", ["DPTR", "#16"], 0x90, ["16:1"]);
add("MOV", ["bit", "C"], 0x92, [0]); add("MOV", ["C", "bit"], 0xa2, [1]);
add("MOV", ["@Ri", "dir"], 0xa6, [1]); add("MOV", ["Rn", "dir"], 0xa8, [1]);
add("MOV", ["A", "dir"], 0xe5, [1]); add("MOV", ["A", "@Ri"], 0xe6); add("MOV", ["A", "Rn"], 0xe8);
add("MOV", ["dir", "A"], 0xf5, [0]); add("MOV", ["@Ri", "A"], 0xf6); add("MOV", ["Rn", "A"], 0xf8);
add("MOVC", ["A", "@A+PC"], 0x83); add("MOVC", ["A", "@A+DPTR"], 0x93);
add("MOVX", ["A", "@DPTR"], 0xe0); add("MOVX", ["A", "@Ri"], 0xe2); add("MOVX", ["@DPTR", "A"], 0xf0); add("MOVX", ["@Ri", "A"], 0xf2);
add("DIV", ["AB"], 0x84); add("MUL", ["AB"], 0xa4);
add("CPL", ["A"], 0xf4); add("CPL", ["C"], 0xb3); add("CPL", ["bit"], 0xb2, [0]);
add("CLR", ["A"], 0xe4); add("CLR", ["C"], 0xc3); add("CLR", ["bit"], 0xc2, [0]);
add("SETB", ["C"], 0xd3); add("SETB", ["bit"], 0xd2, [0]);
add("CJNE", ["A", "#d", "rel"], 0xb4, [1, "rel:2"]); add("CJNE", ["A", "dir", "rel"], 0xb5, [1, "rel:2"]);
add("CJNE", ["@Ri", "#d", "rel"], 0xb6, [1, "rel:2"]); add("CJNE", ["Rn", "#d", "rel"], 0xb8, [1, "rel:2"]);
add("PUSH", ["dir"], 0xc0, [0]); add("POP", ["dir"], 0xd0, [0]);
add("SWAP", ["A"], 0xc4); add("DA", ["A"], 0xd4);
add("XCH", ["A", "dir"], 0xc5, [1]); add("XCH", ["A", "@Ri"], 0xc6); add("XCH", ["A", "Rn"], 0xc8);
add("XCHD", ["A", "@Ri"], 0xd6);
add("DJNZ", ["dir", "rel"], 0xd5, [0, "rel:1"]); add("DJNZ", ["Rn", "rel"], 0xd8, ["rel:1"]);
export const MNEMONICS_8051 = new Set([...T.map((t) => t.m), "CALL"]);

function classify(s) {
  const t = s.trim();
  const u = t.toUpperCase().replace(/\s+/g, "");
  if (u === "A") return { k: "A" };
  if (u === "C") return { k: "C" };
  if (u === "AB") return { k: "AB" };
  if (u === "DPTR") return { k: "DPTR" };
  if (u === "@A+DPTR") return { k: "@A+DPTR" };
  if (u === "@A+PC") return { k: "@A+PC" };
  if (u === "@DPTR") return { k: "@DPTR" };
  let m;
  if ((m = /^R([0-7])$/.exec(u))) return { k: "Rn", n: +m[1] };
  if ((m = /^@R([01])$/.exec(u))) return { k: "@Ri", n: +m[1] };
  if (t[0] === "#") return { k: "#", expr: t.slice(1) };
  if (t[0] === "/") return { k: "/", expr: t.slice(1).trim() };
  if (t[0] === "@") throw new AsmError(`bad indirect operand '${t}'`);
  return { k: "x", expr: t };
}

function matches(pat, o) {
  switch (pat) {
    case "A": case "C": case "AB": case "DPTR": case "@Ri": case "Rn": case "@A+DPTR": case "@A+PC": case "@DPTR": return o.k === pat;
    case "#d": case "#16": return o.k === "#";
    case "/bit": return o.k === "/";
    default: return o.k === "x"; // dir, bit, rel, a11, a16
  }
}

export function assemble8051(source) {
  const lines = source.split(/\r?\n/);
  const symbols = new Map(Object.entries(PREDEF));
  const dataSyms = new Set(); // symbols declared as BIT/DATA/etc. keep their values
  let errors = [], warnings = [], listing = [], segments = [];
  const bytes = new Uint8Array(65536);
  let start = null;

  for (let pass = 1; pass <= 2; pass++) {
    let pc = 0;
    errors = []; warnings = []; listing = []; segments = [];
    let seg = null;
    const ctx = { get pc() { return pc; }, lookup: (n) => symbols.get(n.toUpperCase()) };
    const emit = (list) => {
      if (!seg || seg.end !== pc) { seg = { start: pc, end: pc }; segments.push(seg); }
      for (const b of list) { if (pass === 2) bytes[pc] = b & 255; pc = (pc + 1) & 0xffff; seg.end = pc; }
    };
    const val = (s) => {
      try { return evalExpr(s, ctx); } catch (e) {
        if (e instanceof UndefinedSymbol && pass === 1) return 0;
        throw e;
      }
    };
    const byte = (s, what) => {
      const v = val(s);
      if (v < -128 || v > 255) throw new AsmError(`${what} ${v} does not fit in 8 bits`);
      return v & 255;
    };
    const dirAddr = (s) => {
      const v = val(s);
      if (v < 0 || v > 255) throw new AsmError(`direct address ${v} is outside 00H-FFH`);
      return v;
    };
    const bitAddr = (s) => {
      const m = /^(.+)\.([0-7])$/.exec(s.trim());
      if (m) {
        const base = val(m[1]);
        const n = +m[2];
        if (base >= 0x20 && base <= 0x2f) return (base - 0x20) * 8 + n;
        if (base >= 0x80 && base <= 0xff && (base & 7) === 0) return base + n;
        throw new AsmError(`'${m[1]}' is not bit-addressable`);
      }
      const v = val(s);
      if (v < 0 || v > 255) throw new AsmError(`bit address ${v} is outside 00H-FFH`);
      return v;
    };

    lines.forEach((raw, idx) => {
      const ln = idx + 1;
      const startPc = pc;
      try {
        const { label, op, rest, definer } = parseLine(raw);
        const args = splitArgs(rest);
        if (label && !definer) {
          const key = label.toUpperCase();
          if (RESERVED.has(key) || key in PREDEF) throw new AsmError(`'${label}' is a reserved name`);
          if (pass === 1) {
            if (symbols.has(key) && !(key in PREDEF)) throw new AsmError(`label '${label}' is already defined`);
            symbols.set(key, pc);
          }
        }
        if (!op) { listing.push({ line: ln, addr: null, bytes: [], src: raw }); return; }
        if (["EQU", "SET", "DATA", "IDATA", "XDATA", "CODE", "BIT"].includes(op)) {
          if (!label) throw new AsmError(`${op} needs a name`);
          let v;
          if (op === "BIT" && /\.[0-7]$/.test(args[0] ?? "")) v = bitAddr(args[0]);
          else v = val(args[0] ?? "");
          symbols.set(label.toUpperCase(), v);
          listing.push({ line: ln, addr: null, bytes: [], src: raw, value: v });
          return;
        }
        if (op === "ORG") { pc = val(args[0] ?? "") & 0xffff; if (start === null && pass === 2) start = pc; listing.push({ line: ln, addr: pc, bytes: [], src: raw }); return; }
        if (op === "END") { listing.push({ line: ln, addr: null, bytes: [], src: raw }); return; }
        let out = [];
        if (op === "DB" || op === "DEFB") out = dbBytes(args, ctx2(ctx, pass)).map((v) => v & 255);
        else if (op === "DW" || op === "DEFW") for (const a of args) { const v = val(a) & 0xffff; out.push(v >> 8, v & 255); }
        else if (op === "DS") {
          const n = val(args[0] ?? "");
          if (n < 0 || n > 65536) throw new AsmError("bad DS size");
          pc = (pc + n) & 0xffff;
          listing.push({ line: ln, addr: startPc, bytes: [], src: raw });
          return;
        } else {
          let m = op;
          if (m === "CALL") m = "LCALL";
          if (m === "JMP" && args.length === 1 && classify(args[0]).k !== "@A+DPTR") m = "LJMP";
          const ops = args.map(classify);
          const cands = T.filter((t) => t.m === m);
          if (!cands.length) throw new AsmError(`unknown instruction '${op}'`);
          let hit = null;
          for (const c of cands) {
            if (c.pats.length !== ops.length) continue;
            if (c.pats.every((p, i) => matches(p, ops[i]))) { hit = c; break; }
          }
          if (!hit) throw new AsmError(`${op} does not accept these operands (${args.join(", ") || "none"})`);
          const size = 1 + hit.fields.reduce((n, f) => n + (typeof f === "string" && f.startsWith("16:") ? 2 : 1), 0);
          let opc = hit.op;
          hit.pats.forEach((p, i) => { if (p === "Rn" || p === "@Ri") opc += ops[i].n; });
          out = [opc];
          const next = (pc + size) & 0xffff;
          for (const f of hit.fields) {
            if (typeof f === "number") {
              const p = hit.pats[f];
              const o = ops[f];
              if (p === "dir") out.push(dirAddr(o.expr));
              else if (p === "bit") out.push(bitAddr(o.expr));
              else if (p === "/bit") out.push(bitAddr(o.expr));
              else if (p === "#d") out.push(byte(o.expr, "value"));
            } else if (f.startsWith("16:")) {
              const o = ops[+f.slice(3)];
              const v = val(o.k === "#" ? o.expr : o.expr);
              if (v < -32768 || v > 65535) throw new AsmError(`value ${v} does not fit in 16 bits`);
              out.push((v >> 8) & 255, v & 255);
            } else if (f.startsWith("rel:")) {
              const o = ops[+f.slice(4)];
              const t = val(o.expr);
              const d = t - next;
              if (pass === 2 && (d < -128 || d > 127)) throw new AsmError(`branch target is ${d} bytes away; relative jumps reach -128..+127`);
              out.push(d & 255);
            } else if (f.startsWith("a11:")) {
              const o = ops[+f.slice(4)];
              const t = val(o.expr) & 0xffff;
              if (pass === 2 && (t & 0xf800) !== (next & 0xf800)) throw new AsmError("target is outside the current 2 KB page (use LJMP/LCALL)");
              out[0] = (hit.op & 0x1f) | (((t >> 8) & 7) << 5);
              out.push(t & 255);
            }
          }
        }
        emit(out);
        listing.push({ line: ln, addr: startPc, bytes: out, src: raw });
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        if (pass === 2) errors.push({ line: ln, msg: e.message });
        else if (!(e instanceof UndefinedSymbol)) errors.push({ line: ln, msg: e.message });
        listing.push({ line: ln, addr: null, bytes: [], src: raw, error: e.message });
      }
    });
  }
  if (start === null && segments.length) start = segments[0].start;
  const flat = [];
  for (const e of errors) if (!flat.some((x) => x.line === e.line && x.msg === e.msg)) flat.push(e);
  return { bytes, segments, listing, symbols, errors: flat, warnings, start: start ?? 0 };
}

function ctx2(ctx, pass) {
  return { get pc() { return ctx.pc; }, lookup: (n) => { const v = ctx.lookup(n); return v === undefined && pass === 1 ? 0 : v; } };
}
