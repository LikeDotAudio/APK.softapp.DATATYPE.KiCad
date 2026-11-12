// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadSymbol.js — BIM part <-> KiCad symbol: a part (or its IFC type, or its touch panel) built into a KLC symbol, and a
   symbol read back as a part draft. Part of kicadLibrary.js (import from there). */

import { KLC_REFDES } from './klcRules.js';
import { GRID, TEXT, BODY_LINE, PIN_NAME_OFFSET, kids, n } from './kicadSexp.js';
import { prop, safeName } from './kicadSymbolIo.js';

/* ------------------------------------------------------------------ BIM part → KLC symbol */

const EARTH = /^(gnd|ground|earth|pe|chassis|shield|v-|vss|vee|0v|com(mon)?)\b|\b(gnd|ground|earth)\b/i;
const POSITIVE = /^(v\+|vcc|vdd|vin|\+\d|\+v|dc in|ac in|mains|power in)|\b(mains|psu|dc\s*in|ac\s*in|power)\b/i;

/** JSON text with no literal ${ (KiCad would read it as a variable): \u0024{ is the same string to JSON.parse. */
const jsonNoVars = (t) => String(t).replace(/\$\{/g, '\\u0024{');

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

/** One unit's pins laid out the KLC way (S4.2 sides and groups, S4.1 grid, S3.1 centred): pins [{ row, side, name,
 *  number, type }] → { out: pins with `at`, edgeX, edgeTop, edgeBot } (the body rectangle's half-width and edges). */
function layoutPins(pins, len, titleChars = 0) {
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
    (titleChars * charW) / 2,
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
  return { out, edgeX, edgeTop, edgeBot };
}

/**
 * A BIM part → a KLC symbol model (write it with writeSymbolLib / writeSymdir).
 *   part       apk.bim.part/1 ({id, manufacturer, model, name, description, category, class, ports[]}),
 *              or partFromIfc(text)
 *   library    the symbol library (KLC S1.1: Function_Subfunction_Manufacturer), default from the part
 *   footprint  'Lib:Name' for a fully specified symbol (KLC S5.1), else blank (generic)
 *   datasheet  URL, else the part's own, else '~' (KLC S6.2)
 *   ifcType    the IFC type entity name for APK_IfcType
 *   panel      the part's touch panel (apk.bim.part/1 `panel`, else part.panel): each page one more unit, its controls pins
 */
export function symbolFromPart(part, { library = null, footprint = '', datasheet = null, ifcType = null, fpFilters = '', panel = null } = {}) {
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

  const { out, edgeX, edgeTop, edgeBot } = layoutPins(pins, len, String(part.model || part.name || '').length);

  const name = safeName(part.model || part.name || part.id);
  const lib = library || defaultLibrary(part);
  let description = String(part.description || part.name || '').replace(/\s+/g, ' ').trim();
  if (String(part.model || '').length > 3 && description.toLowerCase().includes(String(part.model).toLowerCase())) {
    description = description.replace(new RegExp(String(part.model).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').replace(/\s+,/g, ',').trim(); // KLC S6.2: the part name is not repeated
  }
  const refd = refdesFor(part);
  const portsJson = jsonNoVars(JSON.stringify(out.map((p) => {
    const r = rows[p.row] || {};
    const o = { n: p.number, group: p.group, side: r.side || '', domain: r.domain || '' };
    if (p.original !== p.name) o.name = p.original; // KiCad's pin name has no spaces: the part's own name
    if (r.connector) o.connector = r.connector;
    if (r.block) o.block = r.block;
    return o;
  })));
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

  const rect = (x, t, b) => ['rectangle', ['start', -x, t], ['end', x, b],
    ['stroke', ['width', BODY_LINE], ['type', 'default']], ['fill', ['type', 'background']]]; // KLC S3.3: black box, filled
  const pinOf = (unit) => (p) => ({ unit, style: 1, type: p.type, shape: 'line', at: p.at, length: len, hide: false, name: p.name, number: p.number, nameSize: TEXT, numberSize: TEXT, alternates: [] });

  /* THE TOUCH PANEL: each of its pages one more unit of this symbol (the device's I/O is unit A), each control on
     the page a pin — a command it takes on the left, a readback it gives on the right (KLC S4.2), its block's
     controls together; numbered on from the device's pins, listed in APK_Ports as control ports. */
  const pages = panelPages(panel ?? part.panel, { model: part.model, name: part.name, manufacturer: part.manufacturer });
  const units = [];
  if (!pages.length) {
    units.push({ unit: 0, style: 1, name: '', graphics: [rect(edgeX, edgeTop, edgeBot)], pins: [] });
    units.push({ unit: 1, style: 1, name: '', graphics: [], pins: out.map(pinOf(1)) });
  } else {
    // the device's own I/O is unit A when it has any; the pages follow
    if (pins.length) units.push({ unit: 1, style: 1, name: 'Device', graphics: [rect(edgeX, edgeTop, edgeBot)], pins: out.map(pinOf(1)) });
    let next = pins.length;
    pages.forEach((page, k) => {
      const pp = [];
      page.blocks.forEach((blk, bi) => blk.controls.forEach((c) => {
        pp.push({ row: bi, group: `${page.name} › ${blk.name}`, name: pinName(c.name), original: c.name, type: c.side === 'output' ? 'output' : 'input',
          side: c.side === 'output' ? 'right' : 'left', number: String(++next), control: c });
      }));
      if (!pp.length) return;
      const lay = layoutPins(pp, Math.min(7.62, GRID + Math.max(0, String(next).length - 2) * 1.27), page.name.length);
      units.push({ unit: units.length + 1, style: 1, name: page.name, graphics: [rect(lay.edgeX, lay.edgeTop, lay.edgeBot)], pins: lay.out.map(pinOf(units.length + 1)), layout: lay, controls: pp });
    });
    // one pin length across every unit (KLC S4.1)
    const longest = Math.max(...units.flatMap((u) => u.pins.map((p) => p.length)));
    for (const u of units) for (const p of u.pins) p.length = longest;
  }
  if (pages.length) {
    const ports = JSON.parse(portsJson);
    for (const u of units) for (const c of u.controls || []) {
      const o = { n: c.number, group: c.group, side: c.side === 'right' ? 'output' : 'input', domain: 'control', control: c.control.key };
      if (c.original !== c.name) o.name = c.original;
      if (c.control.command) o.command = c.control.command;
      ports.push(o);
    }
    properties.find((f) => f.name === 'APK_Ports').value = jsonNoVars(JSON.stringify(ports));
    for (const u of units) delete u.controls;
  }
  return {
    name, library: lib, extends: null, power: null,
    pinNames: { offset: PIN_NAME_OFFSET, hide: false }, pinNumbers: { hide: false },
    excludeFromSim: true, inBom: true, onBoard: true, bodyStyles: [], // on_board: KiCad leaves an off-board symbol out of every netlist, and the wiring is the point
    properties,
    units,
    get pins() { return this.units.flatMap((u) => u.pins); },
    dirty: true,
  };
}

/* A touch panel's controls (the BIM part's `panel`: frames → OcaBin → OcaBlocks → controls). Containers and
   layout (OcaBlock, OcaBin, OcaFold, OcaSeparator, a bare _Label) are not controls. A control with a `set`
   command handler is a command the device takes; anything else that shows a value is a readback it gives. */
const PANEL_LAYOUT = new Set(['OcaSeparator', '_Label', 'OcaSpacer']);
/* what a hand works (a command, whatever its handler does next) vs what shows a value (a readback) */
const PANEL_COMMAND = /Actuator|Button|Toggle|Checkbox|DropDown|Knob|Selector|Switch|TextInput|AcquireLoop|LinkGang|Slider|Fader|Spin/i;
const textOf = (label) => {
  if (!label) return '';
  if (typeof label === 'string') return label;
  if (label.En) return String(label.En);
  for (const k of ['active', 'inactive']) if (label[k] && label[k].text) return textOf(label[k].text);
  return '';
};
/** The panel as pages: [{ name, blocks: [{ name, controls: [{ key, name, type, side: 'input' | 'output', command }] }] }]. */
export function panelPages(panel, vars = {}) {
  // a template's ${model} filled from the part; a ${word} nobody can fill (the bench's resource) dropped with its joiner
  const fill = (t) => String(t).replace(/\$\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : '')).replace(/\s*[@·:]\s*$/, '').replace(/^\s*[@·:]\s*/, '').trim();
  const frames = panel && typeof panel === 'object' ? panel.frames : null;
  if (!frames || typeof frames !== 'object') return [];
  const pages = [];
  for (const [file, frame] of Object.entries(frames)) {
    const page = { name: String(file).replace(/\.json$/i, '').replace(/_/g, ' '), blocks: [] };
    const byBlock = new Map();
    const walk = (node, block) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, v] of Object.entries(node)) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        const t = String(v.type || '');
        const kids = v.fields || v.blocks;
        if (t === 'OcaBin') { walk(kids, block); continue; }
        if (t === 'OcaBlock' || t === 'OcaFold' || (!t && kids)) { walk(kids, block ?? (fill(textOf(v.description) || key) || key)); continue; }
        if (!t || PANEL_LAYOUT.has(t)) continue;
        const h = v.komand_handler || {};
        const md = v.message_details && Object.values(v.message_details).find((m) => m && m.komand_handler);
        const handler = h.command ? h : (md ? md.komand_handler : {});
        const command = PANEL_COMMAND.test(t) || (handler && handler.enable !== false && handler.komand_type === 'set');
        const name = fill(textOf(v.label) || key) || key;
        const b = block ?? page.name;
        if (!byBlock.has(b)) { byBlock.set(b, { name: b, controls: [] }); page.blocks.push(byBlock.get(b)); }
        byBlock.get(b).controls.push({ key, name, type: t, side: command ? 'input' : 'output', ...(handler && handler.command ? { command: String(handler.command) } : {}) });
      }
    };
    walk(frame, null);
    if (page.blocks.length) pages.push(page);
  }
  return pages;
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
