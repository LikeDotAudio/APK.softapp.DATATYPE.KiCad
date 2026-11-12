// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadSexp.js — KiCad s-expressions: the constants every writer shares, the parser and the writer, and the tree helpers
   the other kicad*.js files read nodes with. Part of kicadLibrary.js (import from there). */


export const KICAD_SYM_VERSION = 20251024; // KiCad 10, as kicad-symbols ships it
/** What each KiCad writes. KiCad 10 reads a KiCad 9 file; KiCad 9 refuses a KiCad 10 one ("Unable to load library"),
 *  so a file for people to open is written for KiCad 9 and only the kicad-symbols layout for KiCad 10. */
export const TARGETS = {
  kicad9: { version: 20241209, generatorVersion: '9.0' },
  kicad10: { version: KICAD_SYM_VERSION, generatorVersion: '10.0' },
};
export const DEFAULT_TARGET = 'kicad9';
export const GENERATOR = 'apk_audio';
export const GRID = 2.54;            // KLC S4.1: 100 mil pin grid
export const TEXT = 1.27;            // KLC S3.2: 50 mil text
export const BODY_LINE = 0.254;      // KLC S3.3: 10 mil body outline
export const PIN_NAME_OFFSET = 0.508; // KLC S3.6: 20 mil preferred
export const STOCK_FIELDS = ['Reference', 'Value', 'Footprint', 'Datasheet', 'Description', 'ki_keywords', 'ki_fp_filters', 'ki_locked', 'ki_description'];
export const PIN_TYPES = ['input', 'output', 'bidirectional', 'tri_state', 'passive', 'free', 'unspecified', 'power_in', 'power_out', 'open_collector', 'open_emitter', 'no_connect'];

/* ------------------------------------------------------------------ s-expressions */

/** A quoted string in the tree (atoms are plain JS strings). */
export class Str {
  constructor(s) { this.s = String(s ?? ''); }
  toString() { return this.s; }
}
const isStr = (v) => v instanceof Str;
export const text = (v) => (v == null ? '' : isStr(v) ? v.s : String(v));

/** KiCad s-expression text → nested arrays; atoms stay strings, "quoted" text becomes Str. */
export function sexpParse(src) {
  const s = String(src ?? '');
  const stack = [[]];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(') { stack.push([]); i++; }
    else if (c === ')') {
      if (stack.length < 2) throw new Error(`unbalanced ')' at ${i}`);
      const done = stack.pop(); stack[stack.length - 1].push(done); i++;
    } else if (c === '"') {
      let j = i + 1, out = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length) {
          const e = s[j + 1];
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          j += 2;
        } else out += s[j++];
      }
      if (j >= s.length) throw new Error(`unterminated string at ${i}`);
      stack[stack.length - 1].push(new Str(out)); i = j + 1;
    } else if (/\s/.test(c)) i++;
    else {
      let j = i;
      while (j < s.length && !/[\s()"]/.test(s[j])) j++;
      stack[stack.length - 1].push(s.slice(i, j)); i = j;
    }
  }
  if (stack.length !== 1) throw new Error('unbalanced: missing )');
  return stack[0];
}

export const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
/* KiCad reads ${NAME} in any text as a variable (ERC: "Unresolved text variable"); a panel template's ${n} is not
   one, so it is written {n}. (APK_Ports carries its own: its JSON spells the dollar-brace \u0024{, which KiCad
   does not see and JSON.parse gives back.) */
const noVars = (t) => String(t).replace(/\$\{/g, '{');
const atom = (v) => (isStr(v) ? `"${esc(noVars(v.s))}"` : typeof v === 'number' ? num(v) : String(v));
/** A number as KiCad writes one: no trailing zeros, no -0, at most 4 decimals. */
export function num(n) {
  const r = Math.round(Number(n) * 1e4) / 1e4;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Nested arrays → text in KiCad's own layout: tabs, a list of atoms on one line, (xy …) runs inline. */
export function sexpWrite(node, depth = 0) {
  const pad = '\t'.repeat(depth);
  if (!Array.isArray(node)) return pad + atom(node);
  const lead = [];
  let k = 0;
  while (k < node.length && !Array.isArray(node[k])) lead.push(atom(node[k++]));
  const rest = node.slice(k);
  if (!rest.length) return `${pad}(${lead.join(' ')})`;
  if (node[0] === 'pts') return `${pad}(pts\n${pad}\t${rest.map((x) => sexpWrite(x, 0)).join(' ')}\n${pad})`;
  const kids = rest.map((x) => sexpWrite(x, depth + 1)).join('\n');
  return `${pad}(${lead.join(' ')}\n${kids}\n${pad})`;
}

export const kids = (node, head) => (Array.isArray(node) ? node.filter((x) => Array.isArray(x) && x[0] === head) : []);
export const kid = (node, head) => kids(node, head)[0] ?? null;
export const n = (v) => Number(text(v));
/** (hide yes) in KiCad 9–10, a bare hide atom in KiCad 6–8. */
export const hidden = (node) => !!node && (node.includes('hide') || text(kid(node, 'hide')?.[1]) === 'yes');
export const yes = (node, head, dflt) => { const k = kid(node, head); return k ? text(k[1]) !== 'no' : dflt; };
