// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadLibrary.js — KICAD SYMBOL LIBRARIES IN AND OUT, KiCad AS THE TARGET.
   DATATYPE.KiCad owns it (the KiCad importer / exporter); another page that needs it takes a byte copy.

   The target is the stock KiCad library as it ships (gitlab.com/kicad/libraries/kicad-symbols, KiCad 10):
   one symbol per .kicad_sym file inside <Library>.kicad_symdir/, file version 20251024, judged by the
   KiCad Library Conventions (KLC, klc.kicad.org; our copy and rule index: DATA.KICAD
   SRC/Reference/KLC, js/klcRules.js). Every rule this file applies or checks is cited as "KLC <id>".

     readSymbolLib(text)         a .kicad_sym (one symbol or a whole KiCad 6–10 library) → symbols
     resolveExtends(symbols)     a derived symbol (extends "Base") gets its base's units and pins
     writeSymbolLib(symbols)     symbols → .kicad_sym text (an imported symbol writes back its own tree)
     writeSymdir(library, syms)  {"<Library>.kicad_symdir/<Name>.kicad_sym": text}: the upstream layout
     symbolFromPart(part)        a BIM part (apk.bim.part/1, or partFromIfc's answer) → a KLC symbol
     partFromSymbol(sym)         a KiCad symbol → a BIM part draft (its ports from the pins)
     partFromIfc(text)           the BIM part's IFC type (GET /api/bim/parts/<maker>/<model>.ifc) → part
     klcCheck(sym)               [{rule, level, message, pin?}]: what KLC says about the symbol
     parseFootprintId(id)        'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm' → {library, family, pins, pitch, …}
     footprintFilterMatches(f, id)  a ki_fp_filters pattern against a footprint (KLC S5.2 wildcards)

   OUR FIELDS. A stock symbol carries Reference, Value, Footprint, Datasheet, Description, ki_keywords,
   ki_fp_filters (KLC S6.2). Ours carry those AND hidden APK_* fields that tie the symbol to its BIM part
   and IFC type, so a symbol comes back to the library it came from:
     APK_PartId   the BIM part id (maker/model) = the IFC type's Tag and APK_Part.PartId
     APK_IfcType  the IFC type entity (IfcAudioVisualApplianceType …)
     APK_Manufacturer / APK_Model / APK_Category / APK_Class / APK_Stage   the part's words
     APK_Ports    JSON [{n, group, side, domain, connector, block}]: pin number → its BIM port row
   KLC S6.2 allows a library its own fields only by agreement ("KLC_" there); APK_ is ours, so klcCheck
   reports them as info, not errors, and { upstream: true } writes a symbol without them: the shape a
   merge request to kicad-symbols needs. */

import { KLC_REFDES, KLC_RULES } from './klcRules.js';

export { KLC_RULES, KLC_REFDES };
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
const text = (v) => (v == null ? '' : isStr(v) ? v.s : String(v));

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

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const atom = (v) => (isStr(v) ? `"${esc(v.s)}"` : typeof v === 'number' ? num(v) : String(v));
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

const kids = (node, head) => (Array.isArray(node) ? node.filter((x) => Array.isArray(x) && x[0] === head) : []);
const kid = (node, head) => kids(node, head)[0] ?? null;
const n = (v) => Number(text(v));
/** (hide yes) in KiCad 9–10, a bare hide atom in KiCad 6–8. */
const hidden = (node) => !!node && (node.includes('hide') || text(kid(node, 'hide')?.[1]) === 'yes');
const yes = (node, head, dflt) => { const k = kid(node, head); return k ? text(k[1]) !== 'no' : dflt; };

/* ------------------------------------------------------------------ read */

function readEffects(node) {
  const eff = kid(node, 'effects');
  const size = kid(kid(eff, 'font'), 'size');
  const just = kid(eff, 'justify');
  return { size: size ? n(size[1]) : null, hide: hidden(node) || hidden(eff), justify: just ? just.slice(1).map(text) : [] };
}

function readPin(p, unit, style) {
  const at = kid(p, 'at');
  const name = kid(p, 'name');
  const number = kid(p, 'number');
  return {
    unit, style,
    type: text(p[1]), shape: text(p[2]),
    at: at ? [n(at[1]), n(at[2]), n(at[3] ?? 0)] : [0, 0, 0],
    length: n(kid(p, 'length')?.[1] ?? 0),
    hide: hidden(p),
    name: text(name?.[1]), nameSize: name ? readEffects(name).size : null,
    number: text(number?.[1]), numberSize: number ? readEffects(number).size : null,
    alternates: kids(p, 'alternate').map((a) => ({ name: text(a[1]), type: text(a[2]), shape: text(a[3]) })),
  };
}

/** One (symbol "Name" …) node → the symbol model; raw keeps the tree for a faithful write-back. */
export function symbolFromNode(node, library = '') {
  const name = text(node[1]);
  const pinNames = kid(node, 'pin_names');
  const pinNumbers = kid(node, 'pin_numbers');
  const power = kid(node, 'power');
  const sym = {
    name, library,
    extends: kid(node, 'extends') ? text(kid(node, 'extends')[1]) : null,
    power: power ? (text(power[1]) || 'global') : null,
    pinNames: { offset: pinNames && kid(pinNames, 'offset') ? n(kid(pinNames, 'offset')[1]) : (pinNames ? null : PIN_NAME_OFFSET), hide: hidden(pinNames) },
    pinNumbers: { hide: hidden(pinNumbers) },
    excludeFromSim: yes(node, 'exclude_from_sim', false),
    inBom: yes(node, 'in_bom', true),
    onBoard: yes(node, 'on_board', true),
    bodyStyles: kid(node, 'body_styles') ? kid(node, 'body_styles').slice(1).map(text) : [],
    properties: kids(node, 'property').map((p) => {
      const at = kid(p, 'at');
      return { name: text(p[1]), value: text(p[2]), at: at ? [n(at[1]), n(at[2]), n(at[3] ?? 0)] : [0, 0, 0], ...readEffects(p) };
    }),
    units: [],
    pins: [],
    raw: node,
  };
  for (const u of kids(node, 'symbol')) {
    const m = /_(\d+)_(\d+)$/.exec(text(u[1]));
    const unit = m ? Number(m[1]) : 0, style = m ? Number(m[2]) : 1;
    const graphics = u.filter((x) => Array.isArray(x) && x[0] !== 'pin' && x[0] !== 'unit_name');
    const pins = kids(u, 'pin').map((p) => readPin(p, unit, style));
    sym.units.push({ unit, style, name: kid(u, 'unit_name') ? text(kid(u, 'unit_name')[1]) : '', graphics, pins });
    sym.pins.push(...pins);
  }
  return sym;
}

/** A .kicad_sym file's text (one symbol, KiCad 10 symdir style, or a whole older library) → symbols. */
export function readSymbolLib(src, { library = '' } = {}) {
  const top = sexpParse(src).find((x) => Array.isArray(x) && x[0] === 'kicad_symbol_lib');
  if (!top) throw new Error('not a KiCad symbol library: no (kicad_symbol_lib …)');
  const version = Number(text(kid(top, 'version')?.[1] ?? 0));
  const symbols = kids(top, 'symbol').map((s) => symbolFromNode(s, library));
  return { version, generator: text(kid(top, 'generator')?.[1]), symbols };
}

/** Derived symbols (extends "Base") take their base's units and pins, as KiCad shows them. */
export function resolveExtends(symbols) {
  const key = (lib, name) => `${lib}\u0000${name}`;
  const by = new Map(symbols.map((s) => [key(s.library, s.name), s]));
  return symbols.map((s) => {
    let base = s, guard = 0;
    while (base.extends && by.has(key(s.library, base.extends)) && guard++ < 16) base = by.get(key(s.library, base.extends));
    if (base === s) return s;
    return { ...s, units: base.units, pins: base.pins, pinNames: s.raw && kid(s.raw, 'pin_names') ? s.pinNames : base.pinNames, pinNumbers: base.pinNumbers, resolvedFrom: base.name };
  });
}

/** A symbol's property value ('' when it has none). */
export const prop = (sym, name) => sym.properties.find((p) => p.name === name)?.value ?? '';

/* ------------------------------------------------------------------ write */

const effects = (size, { hide = false, justify = [] } = {}) => {
  const e = ['effects', ['font', ['size', size, size]]];
  if (justify.length) e.push(['justify', ...justify]);
  return e;
};

function propertyNode(p) {
  const node = ['property', new Str(p.name), new Str(p.value), ['at', ...(p.at ?? [0, 0, 0])], ['show_name', 'no'], ['do_not_autoplace', 'no']];
  if (p.hide) node.push(['hide', 'yes']);
  node.push(effects(p.size ?? TEXT, { justify: p.justify ?? [] }));
  return node;
}

function pinNode(p) {
  const node = ['pin', p.type, p.shape || 'line', ['at', ...p.at], ['length', p.length]];
  if (p.hide) node.push(['hide', 'yes']);
  node.push(['name', new Str(p.name), effects(p.nameSize ?? TEXT)]);
  node.push(['number', new Str(p.number), effects(p.numberSize ?? TEXT)]);
  for (const a of p.alternates ?? []) node.push(['alternate', new Str(a.name), a.type, a.shape || 'line']);
  return node;
}

/** The symbol model → its (symbol …) tree. An imported, untouched symbol gives back its own tree. */
export function symbolNode(sym, { upstream = false } = {}) {
  if (sym.raw && !sym.dirty) {
    if (!upstream) return sym.raw;
    return sym.raw.filter((x) => !(Array.isArray(x) && x[0] === 'property' && /^APK_/.test(text(x[1]))));
  }
  const node = ['symbol', new Str(sym.name)];
  if (sym.extends) node.push(['extends', new Str(sym.extends)]);
  if (sym.power) node.push(['power', sym.power]);
  if (sym.pinNumbers?.hide) node.push(['pin_numbers', ['hide', 'yes']]);
  const off = sym.pinNames?.offset;
  if (sym.pinNames?.hide || (off != null && Math.abs(off - PIN_NAME_OFFSET) > 1e-6)) {
    const pn = ['pin_names'];
    if (off != null && Math.abs(off - PIN_NAME_OFFSET) > 1e-6) pn.push(['offset', off]);
    if (sym.pinNames?.hide) pn.push(['hide', 'yes']);
    node.push(pn);
  }
  node.push(['exclude_from_sim', sym.excludeFromSim ? 'yes' : 'no'], ['in_bom', sym.inBom === false ? 'no' : 'yes'],
    ['on_board', sym.onBoard === false ? 'no' : 'yes'], ['in_pos_files', 'yes'], ['duplicate_pin_numbers_are_jumpers', 'no']);
  for (const p of sym.properties) if (!(upstream && /^APK_/.test(p.name))) node.push(propertyNode(p));
  if (sym.bodyStyles?.length) node.push(['body_styles', ...sym.bodyStyles]);
  if (!sym.extends) {
    for (const u of sym.units) {
      const un = ['symbol', new Str(`${sym.name}_${u.unit}_${u.style}`)];
      if (u.name) un.push(['unit_name', new Str(u.name)]);
      un.push(...u.graphics, ...u.pins.map(pinNode));
      node.push(un);
    }
  }
  node.push(['embedded_fonts', 'no']);
  return node;
}

/** Symbols → one .kicad_sym text (KiCad 10). Base symbols first: KiCad wants a parent before its child. */
export function writeSymbolLib(symbols, { upstream = false, generator = GENERATOR, target = DEFAULT_TARGET } = {}) {
  const t = TARGETS[target] || TARGETS[DEFAULT_TARGET];
  const list = [...symbols].sort((a, b) => (a.extends ? 1 : 0) - (b.extends ? 1 : 0));
  const top = ['kicad_symbol_lib', ['version', t.version], ['generator', new Str(generator)], ['generator_version', new Str(t.generatorVersion)],
    ...list.map((s) => forTarget(symbolNode(s, { upstream }), target))];
  return `${sexpWrite(top)}\n`;
}

const KICAD10_ONLY = new Set(['in_pos_files', 'duplicate_pin_numbers_are_jumpers', 'body_styles']);
/* show_name / do_not_autoplace: KiCad 9 writes a bare flag when set and nothing when not; KiCad 10 always (x yes|no) */
const FLAGS = new Set(['show_name', 'do_not_autoplace']);
/** A (symbol …) tree as the target KiCad writes it. KiCad 9: no KiCad 10 tokens, a property's (hide yes) inside its
 *  effects, (power) bare. KiCad 10: a property's hide beside its effects, as kicad-symbols has it. Never mutates. */
export function forTarget(node, target = DEFAULT_TARGET) {
  if (!Array.isArray(node)) return node;
  const nine = target === 'kicad9';
  let out = node.map((x) => (Array.isArray(x) ? forTarget(x, target) : x));
  if (nine) {
    out = out.filter((x) => !(Array.isArray(x) && (KICAD10_ONLY.has(x[0]) || (FLAGS.has(x[0]) && x.length > 1 && text(x[1]) === 'no'))))
      .map((x) => (Array.isArray(x) && FLAGS.has(x[0]) ? [x[0]] : x));
  }
  if (out[0] === 'power' && nine) return ['power'];
  if (out[0] === 'property') {
    const hide = out.find((x) => Array.isArray(x) && x[0] === 'hide');
    const effIdx = out.findIndex((x) => Array.isArray(x) && x[0] === 'effects');
    if (nine && hide && effIdx >= 0) {
      out = out.filter((x) => x !== hide);
      const e = out.findIndex((x) => Array.isArray(x) && x[0] === 'effects');
      out[e] = [...out[e].filter((x) => !(Array.isArray(x) && x[0] === 'hide')), ['hide', 'yes']];
    } else if (!nine && effIdx >= 0) {
      const eh = out[effIdx].find((x) => Array.isArray(x) && x[0] === 'hide');
      if (eh && !hide) {
        out[effIdx] = out[effIdx].filter((x) => x !== eh);
        out.splice(effIdx, 0, ['hide', 'yes']);
      }
    }
  }
  return out;
}

/** The kicad-symbols layout (KiCad 10): one file per symbol in <Library>.kicad_symdir/<Name>.kicad_sym.
 *  A derived symbol's file holds only it; its (extends "Base") names a sibling file in the same folder. */
export function writeSymdir(library, symbols, { upstream = false } = {}) {
  const lib = safeName(library || 'APK');
  const out = {};
  for (const s of symbols) out[`${lib}.kicad_symdir/${safeName(s.name)}.kicad_sym`] = writeSymbolLib([s], { upstream, target: 'kicad10' });
  return out;
}

/** A symbol-library-table row for a symdir, as kicad-symbols' sym-lib-table writes them. */
export const symLibTableRow = (library, descr = '', uri = `\${KIPRJMOD}/${library}.kicad_symdir`) =>
  `\t(lib (name "${esc(library)}") (type "KiCad") (uri "${esc(uri)}") (options "") (descr "${esc(descr)}"))`;

/** Characters KiCad will not take in a library or symbol name (and our portable-file-name rule). */
export const safeName = (s) => String(s ?? '').trim().replace(/[\s/\\:|*?"<>]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Unnamed';

/* ------------------------------------------------------------------ BIM part → KLC symbol */

const EARTH = /^(gnd|ground|earth|pe|chassis|shield|v-|vss|vee|0v|com(mon)?)\b|\b(gnd|ground|earth)\b/i;
const POSITIVE = /^(v\+|vcc|vdd|vin|\+\d|\+v|dc in|ac in|mains|power in)|\b(mains|psu|dc\s*in|ac\s*in|power)\b/i;

/** A pin name KiCad keeps as written: no spaces (KiCad shows them as _). */
export const pinName = (s) => String(s ?? '').trim().replace(/\s+/g, '_') || '~';

/** KLC S6.1: the reference designator for what the part is. Equipment is a removable sub-assembly (A). */
export function refdesFor(part) {
  const words = `${part.category ?? ''} ${part.class ?? ''} ${part.name ?? ''}`.toLowerCase();
  const pick = [
    [/loudspeaker|speaker|subwoofer|buzzer/, 'LS'], [/microphone|\bmic\b/, 'MK'], [/antenna/, 'AE'],
    [/patch ?panel|panel & plate|wall ?plate|connector|jack|receptacle|\bcable\b/, 'J'],
    [/battery/, 'BT'], [/\bfuse\b/, 'F'], [/\brelay\b/, 'K'], [/\bmotor\b/, 'M'], [/transformer/, 'T'],
  ].find(([re]) => re.test(words));
  const r = pick ? pick[1] : 'A';
  return KLC_REFDES[r] ? r : 'A';
}

/** One BIM port row → its terminals [{name, n}] (the same names bim/ifc.py terminals() gives). */
export function terminals(row, i) {
  const count = Number.isInteger(row.count) && row.count >= 1 ? row.count : 1;
  const group = row.group || row.terminal || `PORT ${i + 1}`;
  if (count === 1) return [{ name: row.terminal || group, n: 1 }];
  const labels = Array.isArray(row.labels) ? row.labels : [];
  return Array.from({ length: count }, (_, k) => ({ name: labels[k] || `${group} ${k + 1}`, n: k + 1 }));
}

/** KLC S4.4: the KiCad electrical type of a BIM terminal. */
export function pinTypeFor(row, name, passiveDevice) {
  const dom = row.domain || 'signal';
  const earth = EARTH.test(name) || EARTH.test(row.group || '');
  if (dom === 'power' || row.side === 'supply') {
    if (earth) return 'power_in';
    return row.side === 'output' || row.side === 'supply' ? 'power_out' : 'power_in';
  }
  if (passiveDevice || earth) return 'passive';
  if (row.side === 'input') return 'input';
  if (row.side === 'output') return 'output';
  return 'bidirectional'; // 'connection', network, usb: both ways
}

/** KLC S4.2: which side a pin goes on. */
function sideFor(row, name, type, conversion) {
  if (type === 'power_in' && (EARTH.test(name) || EARTH.test(row.group || ''))) return 'bottom';
  if (type === 'power_in') return conversion ? 'left' : 'top';
  if (type === 'power_out') return conversion ? 'right' : 'top';
  if (type === 'output' || (type !== 'input' && row.side === 'output')) return 'right';
  return 'left';
}

const KEYWORD_STOP = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'with', 'to', 'in', 'by', 'maker']);
/** KLC S6.2: keywords — no word already in the description, phrases joined by '-', no prefix of another. */
export function keywordsFor(part, description) {
  const said = new Set(String(description).toLowerCase().split(/[^a-z0-9+\-]+/).filter(Boolean));
  const raw = [part.category, part.class, part.manufacturer, part.model, ...(part.ports ?? []).map((p) => p.connector), ...(part.ports ?? []).map((p) => p.domain)]
    .filter(Boolean).map((w) => String(w).toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/\s*[&/]\s*/g, ' ').replace(/\s+/g, '-'));
  const words = [...new Set(raw)].filter((w) => w && !KEYWORD_STOP.has(w) && !said.has(w));
  return words.filter((w) => !words.some((o) => o !== w && o.startsWith(w))).join(' ');
}

const charW = TEXT * 0.8; // KiCad stroke font: an average glyph at 1.27 mm
const ceilGrid = (v) => Math.ceil(v / GRID - 1e-9) * GRID;

/**
 * A BIM part → a KLC symbol model (write it with writeSymbolLib / writeSymdir).
 *   part       apk.bim.part/1 ({id, manufacturer, model, name, description, category, class, ports[]}),
 *              or partFromIfc(text)
 *   library    the symbol library (KLC S1.1: Function_Subfunction_Manufacturer), default from the part
 *   footprint  'Lib:Name' for a fully specified symbol (KLC S5.1), else blank (generic)
 *   datasheet  URL, else the part's own, else '~' (KLC S6.2)
 *   ifcType    the IFC type entity name for APK_IfcType
 */
export function symbolFromPart(part, { library = null, footprint = '', datasheet = null, ifcType = null, fpFilters = '' } = {}) {
  const ports = Array.isArray(part.ports) ? part.ports : [];
  const passiveDevice = refdesFor(part) === 'J';
  const conversion = ports.some((r) => r.domain === 'power' && (r.side === 'output' || r.side === 'supply'))
    && ports.some((r) => r.domain === 'power' && r.side === 'input');
  // pins in the part's own order, numbered 1..N unless the IFC said its PortNumbers (KLC S4.1: unique)
  const pins = [];
  const rows = [];
  ports.forEach((row, i) => {
    for (const t of terminals(row, i)) {
      const type = pinTypeFor(row, t.name, passiveDevice);
      pins.push({ row: i, group: row.group || row.terminal || '', name: pinName(t.name), original: t.name, type, side: sideFor(row, t.name, type, conversion), number: '' });
    }
    rows.push(row);
  });
  pins.forEach((p, k) => { p.number = String(k + 1); });

  // KLC S4.1: 100 mil for a 1–2 character number, +50 mil per character beyond, never over 300 mil
  const chars = Math.max(1, ...pins.map((p) => p.number.length));
  const len = Math.min(7.62, GRID + Math.max(0, chars - 2) * 1.27);

  // left / right columns: each port group a run, one empty grid row between groups (KLC S4.2)
  const column = (side) => {
    const out = [];
    let last = null;
    for (const p of pins.filter((x) => x.side === side)) {
      if (last !== null && p.row !== last) out.push(null);
      out.push(p); last = p.row;
    }
    return out;
  };
  const L = column('left'), R = column('right');
  const T = pins.filter((p) => p.side === 'top'), B = pins.filter((p) => p.side === 'bottom');
  let rowsN = Math.max(L.length, R.length, 1);
  if (rowsN % 2 === 0) rowsN += 1; // odd rows: centred on the origin AND on the grid (KLC S3.1, S4.1)
  const nameW = (list) => Math.max(0, ...list.filter(Boolean).map((p) => p.name.length)) * charW;
  const across = Math.max(T.length, B.length);
  const half = ceilGrid(Math.max(
    (nameW(L) + nameW(R)) / 2 + PIN_NAME_OFFSET * 2 + GRID,
    across ? ((across - 1) * 2 * GRID) / 2 + GRID : 0,
    (String(part.model || part.name || '').length * charW) / 2,
    GRID * 2,
  ));
  const pinX = ceilGrid(half + len);         // the connection point on the grid (KLC S4.1)
  const edgeX = pinX - len;                   // the body edge, outside of which pins connect (KLC S3.5)
  // vertical: the side rows, room above for top pins' names and below for bottom pins', then the whole
  // shifted by whole grid steps so the body sits as near the origin as the grid allows (KLC S3.1)
  const vert = (list) => (list.length ? Math.max(...list.map((p) => p.name.length)) * charW + PIN_NAME_OFFSET : 0);
  const rows0 = ((rowsN - 1) / 2) * GRID;
  const shift = Math.round(((vert(T) - vert(B)) / 2) / GRID) * GRID;
  const topY = rows0 - shift;
  const pinTopY = ceilGrid(rows0 + GRID + vert(T) - shift + len);
  const pinBotY = -ceilGrid(rows0 + GRID + vert(B) + shift + len);
  const edgeTop = pinTopY - len, edgeBot = pinBotY + len;

  const out = [];
  L.forEach((p, k) => { if (p) out.push({ ...p, at: [-pinX, topY - k * GRID, 0] }); });
  R.forEach((p, k) => { if (p) out.push({ ...p, at: [pinX, topY - k * GRID, 180] }); });
  T.forEach((p, k) => out.push({ ...p, at: [(k - (T.length - 1) / 2) * 2 * GRID, pinTopY, 270] }));
  B.forEach((p, k) => out.push({ ...p, at: [(k - (B.length - 1) / 2) * 2 * GRID, pinBotY, 90] }));
  out.sort((a, b) => Number(a.number) - Number(b.number));

  const name = safeName(part.model || part.name || part.id);
  const lib = library || defaultLibrary(part);
  let description = String(part.description || part.name || '').replace(/\s+/g, ' ').trim();
  if (String(part.model || '').length > 3 && description.toLowerCase().includes(String(part.model).toLowerCase())) {
    description = description.replace(new RegExp(String(part.model).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/\s+,/g, ',').trim(); // KLC S6.2: the part name is not repeated
  }
  const refd = refdesFor(part);
  const portsJson = JSON.stringify(out.map((p) => {
    const r = rows[p.row] || {};
    const o = { n: p.number, group: p.group, side: r.side || '', domain: r.domain || '' };
    if (p.original !== p.name) o.name = p.original; // KiCad's pin name has no spaces: the part's own name
    if (r.connector) o.connector = r.connector;
    if (r.block) o.block = r.block;
    return o;
  }));
  const fld = (fname, value, at = [0, 0, 0], hide = true, justify = []) => ({ name: fname, value: String(value ?? ''), at, size: TEXT, hide, justify });
  const properties = [
    fld('Reference', refd, [-edgeX, edgeTop + 1.27, 0], false, ['left']),       // KLC S6.2: visible
    fld('Value', name, [-edgeX, edgeBot - 1.27, 0], false, ['left', 'top']),     // KLC S6.2: visible, = the name; under the body, clear of top pins
    fld('Footprint', footprint || '', [0, 0, 0], true),                          // KLC S5.1: blank when generic
    fld('Datasheet', datasheet || part.datasheet || part.url || '~', [0, 0, 0], true),
    fld('Description', description, [0, 0, 0], true),
    fld('ki_keywords', keywordsFor(part, description), [0, 0, 0], true),
  ];
  if (fpFilters) properties.push(fld('ki_fp_filters', fpFilters));
  const apk = [
    ['APK_PartId', part.id], ['APK_IfcType', ifcType || part.ifcType], ['APK_Manufacturer', part.manufacturer], ['APK_Model', part.model],
    ['APK_Category', part.category], ['APK_Class', part.class], ['APK_Stage', part.stage], ['APK_Ports', portsJson],
  ];
  for (const [k, v] of apk) if (v) properties.push(fld(k, v));

  const body = ['rectangle', ['start', -edgeX, edgeTop], ['end', edgeX, edgeBot],
    ['stroke', ['width', BODY_LINE], ['type', 'default']], ['fill', ['type', 'background']]]; // KLC S3.3: black box, filled
  return {
    name, library: lib, extends: null, power: null,
    pinNames: { offset: PIN_NAME_OFFSET, hide: false }, pinNumbers: { hide: false },
    excludeFromSim: true, inBom: true, onBoard: true, bodyStyles: [], // on_board: KiCad leaves an off-board symbol out of every netlist, and the wiring is the point
    properties,
    units: [
      { unit: 0, style: 1, name: '', graphics: [body], pins: [] },
      { unit: 1, style: 1, name: '', graphics: [], pins: out.map((p) => ({ unit: 1, style: 1, type: p.type, shape: 'line', at: p.at, length: len, hide: false, name: p.name, number: p.number, nameSize: TEXT, numberSize: TEXT, alternates: [] })) },
    ],
    get pins() { return this.units.flatMap((u) => u.pins); },
    dirty: true,
  };
}

/** KLC S1.1: Function_Subfunction_Manufacturer, from the part's category, class and maker. */
export function defaultLibrary(part) {
  const bits = [part.category, part.class && part.class !== part.category && !/\(by maker\)/i.test(part.class) ? part.class : null, part.manufacturer];
  return bits.filter(Boolean).map((b) => String(b).replace(/&/g, 'and').replace(/[^A-Za-z0-9+]+/g, ' ').trim().split(' ').map((w) => w[0].toUpperCase() + w.slice(1)).join('')).join('_') || 'APK';
}

/* ------------------------------------------------------------------ KiCad symbol → BIM part */

/** A KiCad symbol (stock or ours) → a BIM part draft. Ours come back exactly (APK_Ports); a stock
 *  symbol's pins become ports, one per pin, side by electrical type. */
export function partFromSymbol(sym) {
  const P = (k) => prop(sym, k);
  let rows = null;
  try { rows = P('APK_Ports') ? JSON.parse(P('APK_Ports')) : null; } catch { rows = null; }
  const pins = [...sym.pins].filter((p) => p.type !== 'no_connect' || !p.hide);
  const ports = [];
  if (rows) {
    const byN = new Map(rows.map((r) => [String(r.n), r]));
    for (const p of pins) {
      const r = byN.get(p.number) || {};
      const prev = ports[ports.length - 1];
      const nm = r.name || p.name;
      if (prev && prev.group === (r.group || nm) && prev.side === r.side && prev.domain === r.domain) {
        prev.count += 1; prev.labels.push(nm); continue;
      }
      const row = { group: r.group || nm, side: r.side || sideOfType(p.type), domain: r.domain || domainOfType(p.type), count: 1, labels: [nm] };
      if (r.connector) row.connector = r.connector;
      if (r.block) row.block = r.block;
      ports.push(row);
    }
    for (const r of ports) if (r.count === 1 && r.labels[0] === r.group) delete r.labels;
  } else {
    for (const p of pins) {
      ports.push({ group: p.name && p.name !== '~' ? p.name : `PIN ${p.number}`, terminal: p.number, side: sideOfType(p.type), domain: domainOfType(p.type), count: 1, kicad: { number: p.number, type: p.type } });
    }
  }
  const maker = P('APK_Manufacturer');
  const model = P('APK_Model') || sym.name;
  const id = P('APK_PartId') || `${slug(maker || sym.library || 'kicad')}/${slug(model)}`;
  const part = {
    schema: 'apk.bim.part/1', id,
    manufacturer: maker || '', maker: id.split('/')[0], model,
    name: maker ? `${maker} ${model}` : model,
    description: P('Description'),
    category: P('APK_Category') || '', class: P('APK_Class') || '',
    stage: P('APK_Stage') || 'stub',
    ports,
    kicad: { library: sym.library, symbol: sym.name, lib_id: `${sym.library}:${sym.name}`, reference: P('Reference'), footprint: P('Footprint'), datasheet: P('Datasheet'), keywords: P('ki_keywords'), fp_filters: P('ki_fp_filters') },
  };
  if (P('Datasheet') && P('Datasheet') !== '~') part.datasheet = P('Datasheet');
  if (P('APK_IfcType')) part.ifcType = P('APK_IfcType');
  return part;
}
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/\./g, '-').replace(/^-|-$/g, '') || 'part';
const sideOfType = (t) => (t === 'input' || t === 'power_in' ? 'input' : t === 'output' || t === 'power_out' || t === 'open_collector' || t === 'open_emitter' || t === 'tri_state' ? 'output' : 'connection');
const domainOfType = (t) => (t === 'power_in' || t === 'power_out' ? 'power' : 'signal');

/* ------------------------------------------------------------------ IFC type → BIM part */

/**
 * The part's IFC type text (bim/ifc.py write: one IfcDistributionPort per terminal, APK_Terminal on each,
 * Pset_DistributionPortCommon.PortNumber) → the part shape symbolFromPart takes. Needs the contracts STEP
 * codec: pass { parseStep, getPsets, isTypeObject, ports } from vendor/apk-contracts/apk-ifc.js.
 */
export function partFromIfc(src, ifc) {
  const { parseStep, getPsets, isTypeObject, ports: portsOf } = ifc;
  const file = parseStep(src);
  const type = file.entities.find((e) => isTypeObject(e.type) && getPsets(file, e).APK_Part) || file.entities.find((e) => isTypeObject(e.type));
  if (!type) throw new Error('no IFC type in the file');
  const ps = getPsets(file, type);
  const mfr = ps.Pset_ManufacturerTypeInformation || {};
  const ap = ps.APK_Part || {};
  const rows = [];
  for (const port of portsOf(file, type)) {
    const pp = getPsets(file, port);
    const t = pp.APK_Terminal || {};
    const flow = String(port.args[7]?.value ?? port.args[7] ?? '');
    const side = t.Side || (flow === 'SINK' ? 'input' : flow === 'SOURCE' ? 'output' : 'connection');
    const nm = String(port.args[2] ?? '');
    const prev = rows[rows.length - 1];
    if (prev && prev.group === (t.Group || nm) && prev.side === side && prev.domain === (t.Domain || 'signal')) {
      prev.count += 1; prev.labels.push(nm); continue;
    }
    const row = { group: t.Group || nm, side, domain: t.Domain || 'signal', count: 1, labels: [nm] };
    if (t.Block) row.block = t.Block;
    if (t.ConnectorAsDeclared) row.connector = t.ConnectorAsDeclared;
    rows.push(row);
  }
  for (const r of rows) if (r.count === 1 && r.labels[0] === r.group) delete r.labels;
  return {
    schema: 'apk.bim.part/1',
    id: String(ap.PartId ?? type.args[7] ?? ''),
    manufacturer: String(mfr.Manufacturer ?? ''), model: String(mfr.ModelReference ?? ''),
    name: String(type.args[2] ?? mfr.ModelLabel ?? ''), description: String(type.args[3] ?? ''),
    category: String(ap.Category ?? ''), class: String(ap.Class ?? ''), stage: String(ap.Stage ?? ''),
    ifcType: type.type, // the STEP entity name, as the file writes it (IFCAUDIOVISUALAPPLIANCETYPE)
    ports: rows,
  };
}

/* ------------------------------------------------------------------ KLC check */

const onGrid = (v, g = GRID) => Math.abs(v / g - Math.round(v / g)) < 1e-3;
const POWER_NAME = /^(v\+|v-|vcc|vdd|vee|vss|vbat|vin|vbus|gnd|agnd|dgnd|pgnd|ground|\+\d|-\d)/i;

/**
 * What KLC says about a symbol: [{rule, level: 'error' | 'warning' | 'info', message, pin?}].
 * Rules that need the footprint library, the datasheet or a librarian's eye are not judged here.
 */
export function klcCheck(sym) {
  const out = [];
  const say = (rule, level, message, pin) => out.push(pin ? { rule, level, message, pin } : { rule, level, message });
  const P = (k) => sym.properties.find((p) => p.name === k);
  const isPower = !!sym.power;
  const graphical = !sym.pins.length && !isPower;

  // KLC S6.2 / S6.1 fields
  const ref = P('Reference'), val = P('Value'), fp = P('Footprint'), ds = P('Datasheet'), desc = P('Description');
  if (!ref) say('S6.2', 'error', 'no Reference field');
  else {
    const r = ref.value.replace(/^#/, '');
    if (!isPower && !graphical && !KLC_REFDES[r]) say('S6.1', 'info', `reference "${ref.value}" is not in the KLC table`);
    if (!isPower && !graphical && ref.hide) say('S6.2', 'error', 'Reference must be visible');
  }
  if (!val) say('S6.2', 'error', 'no Value field');
  else {
    if (!sym.extends && val.value !== sym.name) say('S6.2', 'warning', `Value "${val.value}" is not the symbol name "${sym.name}"`);
    if (val.hide && !graphical) say('S6.2', 'error', 'Value must be visible');
  }
  if (fp && fp.value && !fp.hide) say('S6.2', 'error', 'Footprint must be hidden');
  if (fp && fp.value && !/^[^:]+:[^:]+$/.test(fp.value)) say('S5.1', 'error', `Footprint "${fp.value}" is not <library>:<footprint>`);
  if (!ds) say('S6.2', 'warning', 'no Datasheet field');
  else if (!ds.hide) say('S6.2', 'error', 'Datasheet must be hidden');
  if (!desc || !desc.value) say('S6.2', 'warning', 'no Description');
  else if (sym.name.length > 3 && desc.value.includes(sym.name)) say('S6.2', 'info', 'the description repeats the part name');
  const custom = sym.properties.filter((p) => !STOCK_FIELDS.includes(p.name) && !/^KLC_/.test(p.name) && !/^Sim\./.test(p.name));
  const ours = custom.filter((p) => /^APK_/.test(p.name)), theirs = custom.filter((p) => !/^APK_/.test(p.name));
  if (ours.length) say('S6.2', 'info', `${ours.length} APK_ field(s): ours, dropped when written for upstream`);
  for (const p of theirs) say('S6.2', 'warning', `custom field "${p.name}"`);
  const flt = P('ki_fp_filters');
  if (flt && flt.value) for (const f of flt.value.split(/\s+/).filter(Boolean)) if (!f.endsWith('*')) say('S5.2', 'warning', `footprint filter "${f}" must end with *`);

  // KLC S3: text, outline, De Morgan
  for (const p of sym.properties) if (p.size && Math.abs(p.size - TEXT) > 1e-3 && !p.hide) say('S3.2', 'warning', `${p.name} text is ${p.size} mm, not 1.27`);
  if (sym.bodyStyles.includes('demorgan') || sym.units.some((u) => u.style > 1)) say('S3.9', 'warning', 'has a De Morgan body style');
  const bodyOf = new Map(); // unit → its body: the largest rectangle drawn in it (or in unit 0, common to all)
  for (const u of sym.units) for (const g of u.graphics) {
    if (g[0] !== 'rectangle') continue;
    const st = kid(g, 'start'), en = kid(g, 'end');
    const r = { x1: Math.min(n(st[1]), n(en[1])), x2: Math.max(n(st[1]), n(en[1])), y1: Math.min(n(st[2]), n(en[2])), y2: Math.max(n(st[2]), n(en[2])), g };
    const area = (x) => (x.x2 - x.x1) * (x.y2 - x.y1);
    if (!bodyOf.has(u.unit) || area(r) > area(bodyOf.get(u.unit))) bodyOf.set(u.unit, r);
  }
  for (const r of bodyOf.values()) {
    const w = n(kid(kid(r.g, 'stroke'), 'width')?.[1] ?? 0), fill = text(kid(kid(r.g, 'fill'), 'type')?.[1] ?? 'none');
    if (w !== 0 && Math.abs(w - BODY_LINE) > 1e-3) say('S3.3', 'warning', `body outline is ${w} mm, not 0.254`);
    if (fill !== 'background' && sym.pins.length > 4) say('S3.3', 'info', 'a black-box body is filled with the background colour');
  }
  const rects = [...bodyOf.values()];
  const bodyFor = (unit) => [bodyOf.get(unit), unit !== 0 ? bodyOf.get(0) : null].filter(Boolean);
  if (sym.pinNames.offset != null && !sym.pinNames.hide && (sym.pinNames.offset > 1.27 + 1e-6 || (sym.pinNames.offset < 0.508 - 1e-6 && sym.pinNames.offset !== 0))) {
    say('S3.6', sym.pinNames.offset < 0.508 ? 'info' : 'warning', `pin name offset ${sym.pinNames.offset} mm is outside 0.508–1.27`);
  }

  // KLC S4: pins
  if (isPower) {
    const flag = ref && ref.value === '#FLG'; // PWR_FLAG: KiCad's own, a power_out pin by design
    if (ref && !ref.value.startsWith('#')) say('S7.1', 'error', 'a power symbol\'s reference is #PWR');
    if (sym.pins.length !== 1) say('S7.1', 'error', 'a power symbol has exactly one pin');
    else if (!flag && sym.pins[0].type !== 'power_in') say('S7.1', 'error', 'a power symbol\'s pin is Power Input');
    return out;
  }
  if (graphical) return out;
  const lens = new Set(sym.pins.filter((p) => !p.hide).map((p) => p.length));
  if (lens.size > 1) say('S4.1', sym.pins.length <= 8 ? 'info' : 'warning', `pins have ${lens.size} lengths: all pins share one`);
  const seen = new Map();
  for (const p of sym.pins) {
    const id = `${p.name || '~'} (${p.number})`;
    if (!p.hide && (!onGrid(p.at[0]) || !onGrid(p.at[1]))) say('S4.1', 'error', `pin ${id} is off the 2.54 mm grid`, p.number);
    if (p.length > 7.62 + 1e-6) say('S4.1', 'error', `pin ${id} is longer than 7.62 mm`, p.number);
    else if (p.length < GRID - 1e-6 && sym.pins.length > 3) say('S4.1', 'warning', `pin ${id} is shorter than 2.54 mm`, p.number);
    else if (!onGrid(p.length, 1.27)) say('S4.1', 'warning', `pin ${id} length is not a 1.27 mm step`, p.number);
    const stack = /^\[.*\]$/.test(p.number) ? p.number.slice(1, -1).split(',') : [p.number];
    for (const num_ of stack) {
      const k = `${p.style}|${num_}`;
      if (seen.has(k) && !(p.unit !== seen.get(k) && p.type.startsWith('power'))) say('S4.1', 'error', `pin number ${num_} is used twice`, p.number);
      seen.set(k, p.unit);
    }
    if (stack.length > 1 && p.type === 'no_connect') say('S4.3', 'error', `stacked pin ${id} is No Connect`, p.number);
    if (p.hide && p.type !== 'no_connect') {
      const under = sym.pins.some((o) => !o.hide && o.unit === p.unit && o.at[0] === p.at[0] && o.at[1] === p.at[1]);
      if (under) say('S4.3', 'info', `pin ${id} is stacked the pre-KiCad 10 way (hidden under a visible pin): native stacks number it [a,b]`, p.number);
      else say('S4.6', 'warning', `pin ${id} is hidden but not No Connect`, p.number);
    }
    if (POWER_NAME.test(p.name) && !p.type.startsWith('power') && p.type !== 'passive') say('S4.4', 'warning', `pin ${id} looks like a supply but is ${p.type}`, p.number);
    if (p.shape === 'inverted' && /~\{/.test(p.name)) say('S4.4', 'error', `pin ${id} is inverted twice (bar and bubble)`, p.number);
    if (/^n[A-Z]{2,}|^[A-Z]{2,}_?[bB]$|^\/[A-Z]/.test(p.name)) say('S4.7', 'info', `pin ${id}: active low is written ~{NAME}`, p.number);
    // KLC S4.2: power on top / bottom, inputs left, outputs right (angle: 0 body on the right of the point)
    const a = ((p.at[2] % 360) + 360) % 360;
    if (p.type === 'power_in' && /gnd|vss|vee|v-|ground/i.test(p.name) && a !== 90 && sym.pins.length > 4) say('S4.2', 'info', `ground pin ${id} sits at the bottom`, p.number);
    if (p.type === 'power_in' && /^(vcc|vdd|v\+|vin|vbat)/i.test(p.name) && a !== 270 && sym.pins.length > 4) say('S4.2', 'info', `supply pin ${id} sits at the top`, p.number);
    if (p.type === 'input' && a === 180 && sym.pins.length > 4) say('S4.2', 'info', `input ${id} is on the right`, p.number);
    if (p.type === 'output' && a === 0 && sym.pins.length > 4) say('S4.2', 'info', `output ${id} is on the left`, p.number);
    // KLC S3.5: the connection point is outside the body
    if (!p.hide) for (const r of bodyFor(p.unit)) {
      if (p.at[0] > r.x1 + 1e-3 && p.at[0] < r.x2 - 1e-3 && p.at[1] > r.y1 + 1e-3 && p.at[1] < r.y2 - 1e-3) { say('S3.5', 'error', `pin ${id} connects inside the body`, p.number); break; }
    }
    if (p.nameSize && Math.abs(p.nameSize - TEXT) > 1e-3 && p.nameSize < 0.508 - 1e-6) say('S3.2', 'warning', `pin ${id} name text is under 0.508 mm`, p.number);
  }
  return out;
}

/** {errors, warnings, infos, findings} for a list of symbols: the summary a library page shows. */
export function klcSummary(symbols) {
  const findings = symbols.flatMap((s) => klcCheck(s).map((f) => ({ symbol: s.name, ...f, title: KLC_RULES[f.rule] || '' })));
  const count = (l) => findings.filter((f) => f.level === l).length;
  return { errors: count('error'), warnings: count('warning'), infos: count('info'), findings };
}

/* ------------------------------------------------------------------ footprints (KLC F2/F3 names, S5.2 filters) */

/** A footprint id or name → what its KLC name says (F2.1 / F3): family, pins, pitch, body, rows, options. */
export function parseFootprintId(id) {
  const s = String(id ?? '');
  const [library, name] = s.includes(':') ? s.split(/:(.*)/s) : ['', s];
  const tokens = name.split('_');
  const out = { library, name, family: '', pins: null, pitch: null, body: null, rowSpacing: null, rows: null, pinsPerRow: null, ep: null, mp: null, orientation: null, mount: null, options: [] };
  const head = /^([A-Za-z][A-Za-z0-9+]*?)(?:-(\d+)(?:-(\d+)EP)?)?$/.exec(tokens[0] || '');
  if (head) { out.family = head[1]; if (head[2]) out.pins = Number(head[2]); if (head[3]) out.ep = Number(head[3]); }
  else out.family = tokens[0] || '';
  for (const t of tokens.slice(1)) {
    let m;
    if ((m = /^P(\d+(?:\.\d+)?)mm$/.exec(t))) out.pitch = Number(m[1]);
    else if ((m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?mm$/.exec(t))) out.body = { x: Number(m[1]), y: Number(m[2]), ...(m[3] ? { z: Number(m[3]) } : {}) };
    else if ((m = /^W(\d+(?:\.\d+)?)mm$/.exec(t))) out.rowSpacing = Number(m[1]);
    else if ((m = /^(\d+)x(\d+)$/.exec(t))) { out.rows = Number(m[1]); out.pinsPerRow = Number(m[2]); if (out.pins == null) out.pins = out.rows * out.pinsPerRow; }
    else if ((m = /^(\d+)MP$/.exec(t)) || (m = /^MP$/.exec(t))) out.mp = m[1] ? Number(m[1]) : 1;
    else if ((m = /^EP(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/.exec(t))) out.epSize = { x: Number(m[1]), y: Number(m[2]) };
    else if (/^(Horizontal|Vertical)$/.test(t)) out.orientation = t;
    else out.options.push(t);
  }
  if (/THT|DIP|TO-?220|Pin_?Header|Socket/i.test(library + name)) out.mount = 'THT';
  else if (/SMD|SO|QFN|QFP|BGA|DFN|SOT|_SMD|0402|0603|0805|1206/i.test(library + name)) out.mount = 'SMD';
  return out;
}

/** KLC S5.2: does a ki_fp_filters pattern match a footprint? '*' any run, '?' zero or one char,
 *  'Lib*:Name*' to include the library; matching is case-insensitive, as KiCad's is. */
export function footprintFilterMatches(filter, footprintId) {
  const f = String(filter ?? '');
  const id = String(footprintId ?? '');
  const [lib, name] = id.includes(':') ? id.split(/:(.*)/s) : ['', id];
  const re = (pat) => new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.?')}$`, 'i');
  if (f.includes(':')) {
    const [fl, fn] = f.split(/:(.*)/s);
    return re(fl).test(lib) && re(fn).test(name);
  }
  return re(f).test(name);
}

/* ------------------------------------------------------------------ a library index (the stock tree or ours) */

/** Rows for a library browser: one per symbol, with its pin count, reference and KLC count. */
export function libraryRows(symbols) {
  return resolveExtends(symbols).map((s) => {
    const f = klcCheck(s);
    return {
      library: s.library, symbol: s.name, lib_id: `${s.library}:${s.name}`,
      reference: prop(s, 'Reference'), description: prop(s, 'Description'), keywords: prop(s, 'ki_keywords'),
      footprint: prop(s, 'Footprint'), pins: s.pins.length, extends: s.extends || '',
      bim: prop(s, 'APK_PartId'),
      klc: f.filter((x) => x.level === 'error').length ? `${f.filter((x) => x.level === 'error').length} error(s)` : f.filter((x) => x.level === 'warning').length ? `${f.filter((x) => x.level === 'warning').length} warning(s)` : 'clean',
    };
  });
}

/** A library name from a path: '…/Connector_Audio.kicad_symdir/XLR3.kicad_sym' or 'Device.kicad_sym'. */
export function libraryOfPath(path) {
  const p = String(path ?? '').replace(/\\/g, '/');
  const dir = /([^/]+)\.kicad_symdir\/[^/]+$/.exec(p);
  if (dir) return dir[1];
  const file = /([^/]+)\.kicad_sym$/.exec(p);
  return file ? file[1] : '';
}

/* ------------------------------------------------------------------ a preview */

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** One unit of a symbol as SVG (mm, KiCad's y up drawn down): body graphics, pins, names, numbers. */
export function symbolSvg(sym, { unit = 1, scale = 6 } = {}) {
  const units = sym.units.filter((u) => u.unit === 0 || u.unit === unit || (unit === 1 && !sym.units.some((x) => x.unit === 1)));
  const pins = units.flatMap((u) => u.pins).filter((p) => !p.hide);
  const parts = [];
  const pts = [];
  const P = (x, y) => { pts.push([x, -y]); return `${num(x)},${num(-y)}`; };
  const strokeOf = (g) => Math.max(0.15, n(kid(kid(g, 'stroke'), 'width')?.[1] ?? 0) || 0.15);
  const fillOf = (g) => (text(kid(kid(g, 'fill'), 'type')?.[1]) === 'background' ? 'var(--kl-body, #1e293b)' : text(kid(kid(g, 'fill'), 'type')?.[1]) === 'outline' ? 'currentColor' : 'none');
  for (const u of units) for (const g of u.graphics) {
    if (g[0] === 'rectangle') {
      const s = kid(g, 'start'), e = kid(g, 'end');
      const x1 = Math.min(n(s[1]), n(e[1])), x2 = Math.max(n(s[1]), n(e[1])), y1 = Math.min(n(s[2]), n(e[2])), y2 = Math.max(n(s[2]), n(e[2]));
      P(x1, y1); P(x2, y2);
      parts.push(`<rect x="${num(x1)}" y="${num(-y2)}" width="${num(x2 - x1)}" height="${num(y2 - y1)}" fill="${fillOf(g)}" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'polyline') {
      const list = kids(kid(g, 'pts'), 'xy').map((xy) => P(n(xy[1]), n(xy[2]))).join(' ');
      parts.push(`<polyline points="${list}" fill="${fillOf(g)}" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'circle') {
      const c = kid(g, 'center'), r = n(kid(g, 'radius')[1]);
      P(n(c[1]) - r, n(c[2]) - r); P(n(c[1]) + r, n(c[2]) + r);
      parts.push(`<circle cx="${num(n(c[1]))}" cy="${num(-n(c[2]))}" r="${num(r)}" fill="${fillOf(g)}" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'arc') {
      const s = kid(g, 'start'), m = kid(g, 'mid'), e = kid(g, 'end');
      if (s && m && e) parts.push(`<polyline points="${P(n(s[1]), n(s[2]))} ${P(n(m[1]), n(m[2]))} ${P(n(e[1]), n(e[2]))}" fill="none" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'text') {
      const at = kid(g, 'at');
      P(n(at[1]), n(at[2]));
      parts.push(`<text x="${num(n(at[1]))}" y="${num(-n(at[2]))}" font-size="1.27" text-anchor="middle" dominant-baseline="middle" fill="currentColor">${xml(text(g[1]))}</text>`);
    }
  }
  const showNames = !sym.pinNames.hide, showNums = !sym.pinNumbers.hide;
  const off = sym.pinNames.offset ?? PIN_NAME_OFFSET;
  for (const p of pins) {
    const [x, y, a] = p.at;
    const rad = (a * Math.PI) / 180;
    const ex = x + Math.cos(rad) * p.length, ey = y + Math.sin(rad) * p.length;
    P(x, y); P(ex, ey);
    const colour = p.type.startsWith('power') ? 'var(--kl-power, #f87171)' : 'var(--kl-pin, #38bdf8)';
    parts.push(`<line x1="${num(x)}" y1="${num(-y)}" x2="${num(ex)}" y2="${num(-ey)}" stroke="${colour}" stroke-width="0.2"/><circle cx="${num(x)}" cy="${num(-y)}" r="0.35" fill="${colour}"><title>${xml(`${p.name} (${p.number}) · ${p.type}`)}</title></circle>`);
    const horiz = a === 0 || a === 180;
    const name = p.name && p.name !== '~' ? p.name.replace(/~\{([^}]*)\}/g, '$1') : '';
    if (showNames && name) {
      const nx = ex + Math.cos(rad) * off, ny = ey + Math.sin(rad) * off;
      const anchor = horiz ? (a === 0 ? 'start' : 'end') : 'middle';
      const rot = horiz ? '' : ` transform="rotate(-90 ${num(nx)} ${num(-ny)})"`;
      const anchorV = horiz ? anchor : (a === 270 ? 'end' : 'start');
      parts.push(`<text x="${num(nx)}" y="${num(-ny)}" font-size="1.1" text-anchor="${anchorV}" dominant-baseline="middle" fill="currentColor"${rot}>${xml(name)}</text>`);
    }
    if (showNums) {
      const mx = (x + ex) / 2, my = (y + ey) / 2;
      parts.push(`<text x="${num(mx)}" y="${num(-my - (horiz ? 0.4 : 0))}" font-size="0.9" text-anchor="middle" fill="var(--kl-num, #94a3b8)"${horiz ? '' : ` transform="rotate(-90 ${num(mx - 0.4)} ${num(-my)})"`}>${xml(p.number)}</text>`);
    }
  }
  for (const f of sym.properties.filter((q) => !q.hide && (q.name === 'Reference' || q.name === 'Value'))) {
    const [x, y] = f.at;
    P(x, y);
    const anchor = f.justify.includes('left') ? 'start' : f.justify.includes('right') ? 'end' : 'middle';
    parts.push(`<text x="${num(x)}" y="${num(-y)}" font-size="1.27" text-anchor="${anchor}" fill="currentColor" font-weight="${f.name === 'Value' ? 600 : 400}">${xml(f.name === 'Reference' ? `${f.value}?` : f.value)}</text>`);
  }
  if (!pts.length) pts.push([0, 0]);
  const pad = 6;
  const x0 = Math.min(...pts.map((q) => q[0])) - pad, x1 = Math.max(...pts.map((q) => q[0])) + pad;
  const y0 = Math.min(...pts.map((q) => q[1])) - pad, y1 = Math.max(...pts.map((q) => q[1])) + pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)}" width="${Math.round((x1 - x0) * scale)}" height="${Math.round((y1 - y0) * scale)}" font-family="sans-serif">${parts.join('')}</svg>`;
}

/* ------------------------------------------------------------------ a schematic sheet (.kicad_sch) */

export const SCH_TARGETS = { kicad9: { version: 20250114, generatorVersion: '9.0' }, kicad10: { version: 20250114, generatorVersion: '10.0' } };

/** A UUID that is a function of its key: the same drawing writes the same file. */
export function stableUuid(key) {
  const h = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const s = String(key);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ (c + k * 131), 0x01000193 + k * 2) >>> 0;
  }
  const hex = h.map((x) => x.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const snap = (v, g = 1.27) => Math.round(v / g) * g;
/** A symbol-local point (y up) turned by the placement (0/90/180/270, counter-clockwise) onto the sheet (y down). */
export function sheetPoint(at, rotation, [px, py]) {
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  const c = Math.round(Math.cos((r * Math.PI) / 180)), s = Math.round(Math.sin((r * Math.PI) / 180));
  const rx = px * c - py * s, ry = px * s + py * c;
  return [at[0] + rx, at[1] - ry];
}

/** The symbol as a sheet embeds it: named by its lib_id, derived symbols flattened (KiCad embeds them whole). */
function embedded(sym, libId, target) {
  const flat = sym.extends ? { ...sym, extends: null, raw: null, dirty: true } : sym;
  const node = symbolNode(flat);
  return forTarget(['symbol', new Str(libId), ...node.slice(2)], target);
}

/**
 * A KiCad schematic sheet: every placed symbol, and each net as a short wire stub and a net label on each of its
 * pins (a label joins pins exactly as a drawn wire does, for every KiCad tool — and a routed matrix is unreadable).
 *   symbols    the symbol models placed (lib_id = '<library>:<name>')
 *   instances  [{ libId, ref, at: [x, y] mm on the sheet (y down), rotation, uuidKey? }]
 *   nets       [{ name, nodes: [{ ref, pin }] }]  — a net of one pin is skipped
 * → { text, placed, labelled, skipped: [why] }
 */
export function writeSchematic({ title = '', project = '', symbols = [], instances = [], nets = [], target = DEFAULT_TARGET, comment = '' } = {}) {
  const t = SCH_TARGETS[target] || SCH_TARGETS.kicad9;
  const byId = new Map(resolveExtends(symbols).map((s) => [`${s.library}:${s.name}`, s]));
  const root = stableUuid(`sheet|${project}|${title}`);
  const skipped = [];
  const placed = instances.filter((i) => byId.has(i.libId) || (skipped.push(`${i.ref}: no symbol ${i.libId}`), false));
  // the sheet starts at a margin: shift everything so nothing sits at a negative coordinate
  const box = placed.flatMap((i) => byId.get(i.libId).pins.map((p) => sheetPoint(i.at, i.rotation || 0, p.at)).concat([i.at]));
  const minX = Math.min(0, ...box.map((b) => b[0])), minY = Math.min(0, ...box.map((b) => b[1]));
  const M = 25.4;
  const dx = snap(M - minX, 2.54), dy = snap(M - minY, 2.54);
  const at = (i) => [snap(i.at[0] + dx, 2.54), snap(i.at[1] + dy, 2.54)];

  const body = [];
  const used = new Set();
  const inst = new Map();
  for (const i of placed) {
    const sym = byId.get(i.libId);
    used.add(i.libId);
    const pos = at(i);
    inst.set(i.ref, { i, sym, pos });
    const rot = (((Math.round((i.rotation || 0) / 90) * 90) % 360) + 360) % 360;
    const uid = stableUuid(`symbol|${i.uuidKey ?? i.ref}`);
    const node = ['symbol', ['lib_id', new Str(i.libId)], ['at', pos[0], pos[1], rot], ['unit', 1],
      ['exclude_from_sim', sym.excludeFromSim ? 'yes' : 'no'], ['in_bom', sym.inBom === false ? 'no' : 'yes'], ['on_board', sym.onBoard === false ? 'no' : 'yes'], ['dnp', 'no'],
      ['uuid', new Str(uid)]];
    for (const f of sym.properties) {
      const value = f.name === 'Reference' ? i.ref : (i.fields && f.name in i.fields ? i.fields[f.name] : f.value);
      const [fx, fy] = sheetPoint(pos, rot, [f.at[0], f.at[1]]);
      node.push(propertyNode({ ...f, value, at: [fx, fy, f.at[2] || 0] }));
    }
    for (const [k, v] of Object.entries(i.fields || {})) {
      if (!sym.properties.some((f) => f.name === k)) node.push(propertyNode({ name: k, value: String(v), at: [pos[0], pos[1], 0], size: TEXT, hide: true, justify: [] }));
    }
    for (const p of sym.pins) node.push(['pin', new Str(p.number), ['uuid', new Str(stableUuid(`pin|${uid}|${p.number}`))]]);
    node.push(['instances', ['project', new Str(project), ['path', new Str(`/${root}`), ['reference', new Str(i.ref)], ['unit', 1]]]]);
    body.push(forTarget(node, target));
  }

  let labelled = 0;
  for (const net of nets) {
    if ((net.nodes || []).length < 2) continue;
    for (const nd of net.nodes) {
      const it = inst.get(nd.ref);
      const pin = it && it.sym.pins.find((p) => p.number === String(nd.pin));
      if (!pin) { skipped.push(`${net.name}: ${nd.ref} has no pin ${nd.pin}`); continue; }
      const rot = it.i.rotation || 0;
      const [x, y] = sheetPoint(it.pos, rot, pin.at);
      // outward: away from the body, the pin's own direction turned by the placement, reversed
      const out = ((((pin.at[2] + rot + 180) % 360) + 360) % 360);
      const ux = Math.round(Math.cos((out * Math.PI) / 180)), uy = -Math.round(Math.sin((out * Math.PI) / 180));
      const end = [x + ux * 2.54, y + uy * 2.54];
      const key = `${net.name}|${nd.ref}|${nd.pin}`;
      body.push(['wire', ['pts', ['xy', x, y], ['xy', end[0], end[1]]], ['stroke', ['width', 0], ['type', 'default']], ['uuid', new Str(stableUuid(`wire|${key}`))]]);
      const spin = { 0: [0, 'left'], 90: [90, 'left'], 180: [180, 'right'], 270: [270, 'right'] }[out];
      body.push(['label', new Str(net.name), ['at', end[0], end[1], spin[0]], ['effects', ['font', ['size', TEXT, TEXT]], ['justify', spin[1], 'bottom']], ['uuid', new Str(stableUuid(`label|${key}`))]]);
      labelled++;
    }
  }
  const all = box.map((b) => [b[0] + dx, b[1] + dy]);
  const w = Math.max(297, Math.ceil((Math.max(0, ...all.map((b) => b[0])) + 2 * M) / 10) * 10);
  const h = Math.max(210, Math.ceil((Math.max(0, ...all.map((b) => b[1])) + 2 * M) / 10) * 10);
  const tb = ['title_block', ['title', new Str(title)]];
  if (comment) tb.push(['comment', 1, new Str(comment)]);
  const top = ['kicad_sch', ['version', t.version], ['generator', new Str(GENERATOR)], ['generator_version', new Str(t.generatorVersion)],
    ['uuid', new Str(root)], ['paper', new Str('User'), w, h], tb,
    ['lib_symbols', ...[...used].sort().map((id) => embedded(byId.get(id), id, target))],
    ...body,
    ['sheet_instances', ['path', new Str('/'), ['page', new Str('1')]]],
    ['embedded_fonts', 'no']];
  return { text: `${sexpWrite(top)}\n`, placed: placed.length, labelled, skipped };
}

/** sym-lib-table text for the libraries a project folder carries beside its sheet (${KIPRJMOD}/<lib>.kicad_sym). */
export function projectSymLibTable(libraries) {
  return `(sym_lib_table\n\t(version 7)\n${[...new Set(libraries)].sort().map((l) => symLibTableRow(l, 'APK.audio BIM symbols', `\${KIPRJMOD}/${l}.kicad_sym`)).join('\n')}\n)\n`;
}
