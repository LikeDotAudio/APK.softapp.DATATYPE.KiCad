// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadSymbolIo.js — A .kicad_sym in and out: read a library into symbol models, write models back (KiCad 9 or 10), the
   kicad-symbols symdir layout. Part of kicadLibrary.js (import from there). */

import { TARGETS, DEFAULT_TARGET, GENERATOR, TEXT, PIN_NAME_OFFSET, Str, text, sexpParse, esc, sexpWrite, kids, kid, n, hidden, yes } from './kicadSexp.js';

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

export function propertyNode(p) {
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
