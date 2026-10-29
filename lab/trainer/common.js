// Shared helpers: number formatting, expression evaluation and source-line parsing for both assemblers.

export const hex = (v, n = 2) => (v >>> 0).toString(16).toUpperCase().padStart(n, "0");
export const bin8 = (v) => (v & 255).toString(2).padStart(8, "0");

export class AsmError extends Error {}

/** Parses a numeric literal (0FFH, 0xFF, 1010B, 17O, 255, 'A'); returns null if it is not a literal. */
export function parseNumber(t) {
  let m;
  if ((m = /^0x([0-9a-f]+)$/i.exec(t))) return parseInt(m[1], 16);
  if ((m = /^\$([0-9a-f]+)$/i.exec(t)) && t.length > 1) return parseInt(m[1], 16);
  if ((m = /^([0-9][0-9a-f]*)h$/i.exec(t))) return parseInt(m[1], 16);
  if ((m = /^([01]+)b$/i.exec(t))) return parseInt(m[1], 2);
  if ((m = /^([0-7]+)[oq]$/i.exec(t))) return parseInt(m[1], 8);
  if ((m = /^([0-9]+)d?$/i.exec(t))) return parseInt(m[1], 10);
  if ((m = /^'(.)'$/.exec(t))) return m[1].charCodeAt(0);
  return null;
}

const TOKEN = /\s*(0x[0-9a-f]+|\$[0-9a-f]+|[0-9][0-9a-z]*|'.'|[A-Za-z_?@.][\w?@.]*|<<|>>|[-+*/%&|^~!()$])/iy;

/**
 * Evaluates an assembler expression. ctx.lookup(name) returns a number or undefined; ctx.pc is the current location.
 * Throws AsmError on syntax problems and UndefinedSymbol for unknown names (so pass 1 can tolerate forward references).
 */
export class UndefinedSymbol extends AsmError {
  constructor(name) {
    super(`undefined symbol '${name}'`);
    this.symbol = name;
  }
}

export function evalExpr(text, ctx) {
  const src = text.trim();
  if (!src) throw new AsmError("missing value");
  const toks = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new AsmError(`unexpected '${src.slice(pos).trim()[0]}' in expression`);
    toks.push(m[1]);
    pos = TOKEN.lastIndex;
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const BIN = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
  function level(l) {
    if (l >= BIN.length) return unary();
    let v = level(l + 1);
    while (BIN[l].includes(peek())) {
      const op = next();
      const r = level(l + 1);
      switch (op) {
        case "|": v |= r; break;
        case "^": v ^= r; break;
        case "&": v &= r; break;
        case "<<": v <<= r; break;
        case ">>": v >>= r; break;
        case "+": v += r; break;
        case "-": v -= r; break;
        case "*": v *= r; break;
        case "/": if (r === 0) throw new AsmError("division by zero"); v = Math.trunc(v / r); break;
        case "%": if (r === 0) throw new AsmError("division by zero"); v %= r; break;
      }
    }
    return v;
  }
  function unary() {
    const t = peek();
    if (t === undefined) throw new AsmError("incomplete expression");
    if (t === "-") { next(); return -unary(); }
    if (t === "+") { next(); return unary(); }
    if (t === "~" || t === "!") { next(); return ~unary(); }
    const up = t.toUpperCase();
    if (up === "HIGH" || up === "LOW") {
      next();
      const v = unary();
      return up === "HIGH" ? (v >> 8) & 255 : v & 255;
    }
    if (t === "(") {
      next();
      const v = level(0);
      if (next() !== ")") throw new AsmError("missing ')'");
      return v;
    }
    next();
    if (t === "$") return ctx.pc;
    const n = parseNumber(t);
    if (n !== null) return n;
    if (/^[A-Za-z_?@.]/.test(t)) {
      const v = ctx.lookup(t);
      if (v === undefined) throw new UndefinedSymbol(t);
      return v;
    }
    throw new AsmError(`bad value '${t}'`);
  }
  const v = level(0);
  if (i < toks.length) throw new AsmError(`unexpected '${toks[i]}'`);
  return v;
}

/** Splits an operand list on commas that are outside quotes and parentheses. */
export function splitArgs(s) {
  const out = [];
  let cur = "", q = null, depth = 0;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "" || out.length) out.push(cur.trim());
  return out;
}

/** Removes a ';' comment that is not inside quotes. */
export function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') q = ch;
    else if (ch === ";") return line.slice(0, i);
  }
  return line;
}

const DEFINERS = new Set(["EQU", "SET", "DATA", "BIT", "CODE", "XDATA", "IDATA", "SFR"]);

/** Splits a source line into {label, op, rest}. A bare "NAME EQU value" also yields the label. */
export function parseLine(raw) {
  let line = stripComment(raw).trim();
  let label = null;
  let m = /^([A-Za-z_?@.][\w?@.]*)\s*:\s*(.*)$/.exec(line);
  if (m) { label = m[1]; line = m[2].trim(); }
  else {
    m = /^([A-Za-z_?@.][\w?@.]*)\s+([A-Za-z]+)\b\s*(.*)$/.exec(line);
    if (m && DEFINERS.has(m[2].toUpperCase())) return { label: m[1], op: m[2].toUpperCase(), rest: m[3].trim(), definer: true };
  }
  if (!line) return { label, op: "", rest: "" };
  m = /^(\S+)\s*(.*)$/.exec(line);
  return { label, op: m[1].toUpperCase(), rest: m[2].trim() };
}

/** Decodes a DB string/number list into bytes. */
export function dbBytes(args, ctx) {
  const out = [];
  for (const a of args) {
    const m = /^(['"])(.*)\1$/.exec(a);
    if (m && m[2].length !== 1 || (m && a[0] === '"')) for (const ch of m[2]) out.push(ch.charCodeAt(0) & 255);
    else out.push(evalExpr(a, ctx));
  }
  return out;
}
