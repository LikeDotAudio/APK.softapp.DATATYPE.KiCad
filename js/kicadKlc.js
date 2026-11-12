// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadKlc.js — KLC checks on a symbol, footprint names and filters, and the rows a library browser shows.
   Part of kicadLibrary.js (import from there). */

import { KLC_REFDES, KLC_RULES } from './klcRules.js';
import { GRID, TEXT, BODY_LINE, STOCK_FIELDS, text, kid, n, hidden } from './kicadSexp.js';
import { resolveExtends, prop } from './kicadSymbolIo.js';

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
