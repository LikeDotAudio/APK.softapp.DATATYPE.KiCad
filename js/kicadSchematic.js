// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadSchematic.js — A KiCad schematic sheet (.kicad_sch), the project's sym-lib-table, and a .zip for a browser that cannot
   write a folder. Part of kicadLibrary.js (import from there). */

import { DEFAULT_TARGET, GENERATOR, TEXT, Str, text, sexpWrite, kid, n } from './kicadSexp.js';
import { resolveExtends, propertyNode, symbolNode, forTarget, symLibTableRow } from './kicadSymbolIo.js';

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
 * A KiCad schematic sheet: every placed symbol, and each net drawn — a wire stub and a net label (the net's name) on
 * each of its pins, and its pins joined by WIRES, each leg routed square (across, down, across) in a channel of its
 * own. A leg is drawn only where no corner or end of it lands on another net's wire or pin (in KiCad that is a
 * connection: a short); a leg that finds no such channel is left to the labels, which join the net all the same.
 *   symbols    the symbol models placed (lib_id = '<library>:<name>')
 *   instances  [{ libId, ref, unit? (1), at: [x, y] mm (y down), rotation, uuidKey?, fields?: {name: value} (hidden unless
 *              Reference/Value), shown?: {name: value} (visible lines under the Value) }]
 *   nets       [{ name, nodes: [{ ref, pin }] }]  — a net of one pin is skipped
 *   wires      false: labels only
 *   spread     true: a symbol that would overlap one already placed moves down until it is clear
 *   groups     [{ name, refs: [ref] }]: each drawn as a dashed frame round its members, titled with its name
 * → { text, placed, labelled, wired, skipped: [why] }
 */
export function writeSchematic({ title = '', project = '', symbols = [], instances = [], nets = [], target = DEFAULT_TARGET, comment = '', wires = true, spread = true, groups = [] } = {}) {
  const t = SCH_TARGETS[target] || SCH_TARGETS.kicad9;
  const byId = new Map(resolveExtends(symbols).map((s) => [`${s.library}:${s.name}`, s]));
  const root = stableUuid(`sheet|${project}|${title}`);
  const skipped = [];
  const placed = instances.filter((i) => byId.has(i.libId) || (skipped.push(`${i.ref}: no symbol ${i.libId}`), false));
  const G = 2.54;

  // where each pin of a net leads, so a symbol's box makes room for its labels
  const labelLen = new Map(); // ref → longest net name on it
  for (const net of nets) if ((net.nodes || []).length >= 2) for (const nd of net.nodes) labelLen.set(nd.ref, Math.max(labelLen.get(nd.ref) || 0, String(net.name).length));
  const unitPins = (i) => { const sym = byId.get(i.libId); const u = i.unit || 1; return sym.pins.filter((p) => p.unit === u || p.unit === 0); };
  const boxOf = (i, pos) => {
    const pts = unitPins(i).map((p) => sheetPoint(pos, i.rotation || 0, p.at));
    pts.push(pos);
    const reach = G * 2 + (labelLen.get(i.ref) || 0) * 1.0;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return { x1: Math.min(...xs) - reach, x2: Math.max(...xs) + reach, y1: Math.min(...ys) - G * 3, y2: Math.max(...ys) + G * 4 };
  };
  const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
  const posOf = new Map(placed.map((i) => [i, [snap(i.at[0], G), snap(i.at[1], G)]]));
  if (spread) {
    // a device and its other units (its touch panel's pages) move as one: clustered by ref
    const clusters = new Map();
    for (const i of placed) { if (!clusters.has(i.ref)) clusters.set(i.ref, []); clusters.get(i.ref).push(i); }
    const union = (list, dyy) => {
      const bs = list.map((i) => { const p = posOf.get(i); return boxOf(i, [p[0], p[1] + dyy]); });
      return { x1: Math.min(...bs.map((b) => b.x1)), x2: Math.max(...bs.map((b) => b.x2)), y1: Math.min(...bs.map((b) => b.y1)), y2: Math.max(...bs.map((b) => b.y2)) };
    };
    const done = [];
    const order = [...clusters.values()].sort((a, b) => a[0].at[1] - b[0].at[1] || a[0].at[0] - b[0].at[0]);
    for (const list of order) {
      let dyy = 0, bx = union(list, 0), guard = 0;
      for (let o = done.find((d) => hit(d, bx)); o && guard++ < 400; o = done.find((d) => hit(d, bx))) {
        dyy = snap(dyy + (o.y2 - bx.y1) + G, G);
        bx = union(list, dyy);
      }
      for (const i of list) { const p = posOf.get(i); posOf.set(i, [p[0], p[1] + dyy]); }
      done.push(bx);
    }
  }
  // the sheet starts at a margin: shift everything so nothing sits at a negative coordinate
  const all0 = placed.map((i) => boxOf(i, posOf.get(i)));
  const M = 25.4;
  const dx = snap(M - Math.min(0, ...all0.map((b) => b.x1)), G), dy = snap(M - Math.min(0, ...all0.map((b) => b.y1)), G);
  for (const i of placed) { const p = posOf.get(i); posOf.set(i, [p[0] + dx, p[1] + dy]); }

  const body = [];
  const used = new Set();
  const inst = new Map();
  for (const i of placed) {
    const sym = byId.get(i.libId);
    used.add(i.libId);
    const pos = posOf.get(i);
    if (!inst.has(i.ref)) inst.set(i.ref, []);
    inst.get(i.ref).push({ i, sym, pos });
    const unit = i.unit || 1;
    const rot = (((Math.round((i.rotation || 0) / 90) * 90) % 360) + 360) % 360;
    const uid = stableUuid(`symbol|${i.uuidKey ?? i.ref}|${i.unit || 1}`);
    const node = ['symbol', ['lib_id', new Str(i.libId)], ['at', pos[0], pos[1], rot], ['unit', unit],
      ['exclude_from_sim', sym.excludeFromSim ? 'yes' : 'no'], ['in_bom', sym.inBom === false ? 'no' : 'yes'], ['on_board', sym.onBoard === false ? 'no' : 'yes'], ['dnp', 'no'],
      ['uuid', new Str(uid)]];
    // this unit's own body (a touch panel page is not the device's size): its reference above it, its name below
    const own = (() => {
      for (const u of sym.units.filter((x) => x.unit === unit || x.unit === 0)) for (const g of u.graphics || []) {
        if (!Array.isArray(g) || g[0] !== 'rectangle') continue;
        const st = kid(g, 'start'), en = kid(g, 'end');
        return { x1: Math.min(n(st[1]), n(en[1])), y1: Math.min(n(st[2]), n(en[2])), y2: Math.max(n(st[2]), n(en[2])) };
      }
      return null;
    })();
    const fieldAt = (f) => {
      if (own && f.name === 'Reference' && !f.hide) return [own.x1, own.y2 + 1.27, 0];
      if (own && f.name === 'Value' && !f.hide) return [own.x1, own.y1 - 1.27, 0];
      return f.at;
    };
    for (const f of sym.properties) {
      const value = f.name === 'Reference' ? i.ref : (i.fields && f.name in i.fields ? i.fields[f.name] : f.value);
      const fa = fieldAt(f);
      const [fx, fy] = sheetPoint(pos, rot, [fa[0], fa[1]]);
      const justify = own && !f.hide && (f.name === 'Reference' || f.name === 'Value') ? (f.name === 'Value' ? ['left', 'top'] : ['left']) : f.justify;
      node.push(propertyNode({ ...f, value, justify, at: [fx, fy, fa[2] || 0] }));
    }
    for (const [k, v] of Object.entries(i.fields || {})) {
      if (!sym.properties.some((f) => f.name === k)) node.push(propertyNode({ name: k, value: String(v), at: [pos[0], pos[1], 0], size: TEXT, hide: true, justify: [] }));
    }
    // visible lines under the Value (the device's own words a reader wants on the sheet)
    const val = sym.properties.find((f) => f.name === 'Value');
    Object.entries(i.shown || {}).forEach(([k, v], n) => {
      const base = val ? fieldAt(val) : [0, 0, 0];
      const [fx, fy] = sheetPoint(pos, rot, [base[0], base[1] - G * (n + 1)]);
      node.push(propertyNode({ name: k, value: String(v), at: [fx, fy, 0], size: TEXT, hide: false, justify: ['left', 'top'] }));
    });
    for (const p of unitPins(i)) node.push(['pin', new Str(p.number), ['uuid', new Str(stableUuid(`pin|${uid}|${p.number}`))]]);
    node.push(['instances', ['project', new Str(project), ['path', new Str(`/${root}`), ['reference', new Str(i.ref)], ['unit', unit]]]]);
    body.push(forTarget(node, target));
  }

  // each net's pins: the pin point, and the stub's far end where its label sits and its wire leaves
  const netEnds = [];
  for (const net of nets) {
    if ((net.nodes || []).length < 2) continue;
    const ends = [];
    for (const nd of net.nodes) {
      let it = null, pin = null;
      for (const cand of inst.get(nd.ref) || []) {
        const u = cand.i.unit || 1;
        const hitPin = cand.sym.pins.find((p) => p.number === String(nd.pin) && (p.unit === u || p.unit === 0));
        if (hitPin) { it = cand; pin = hitPin; break; }
      }
      if (!pin) { skipped.push(`${net.name}: ${nd.ref} has no pin ${nd.pin} on a placed unit`); continue; }
      const rot = it.i.rotation || 0;
      const [x, y] = sheetPoint(it.pos, rot, pin.at);
      const out = ((((pin.at[2] + rot + 180) % 360) + 360) % 360);
      const ux = Math.round(Math.cos((out * Math.PI) / 180)), uy = -Math.round(Math.sin((out * Math.PI) / 180));
      ends.push({ key: `${net.name}|${nd.ref}|${nd.pin}`, pin: [x, y], end: [x + ux * G, y + uy * G], out });
    }
    if (ends.length) netEnds.push({ net, ends });
  }

  // what every net already owns: segments and points (pins, stub ends), to keep other nets off them
  const segs = []; // { n, a:[x,y], b:[x,y] }
  const pts = [];  // { n, p:[x,y] }
  const near = (u, v) => Math.abs(u - v) < 1e-3;
  const onSeg = (p, s) => (near(s.a[0], s.b[0]) && near(p[0], s.a[0]) && p[1] >= Math.min(s.a[1], s.b[1]) - 1e-3 && p[1] <= Math.max(s.a[1], s.b[1]) + 1e-3)
    || (near(s.a[1], s.b[1]) && near(p[1], s.a[1]) && p[0] >= Math.min(s.a[0], s.b[0]) - 1e-3 && p[0] <= Math.max(s.a[0], s.b[0]) + 1e-3);
  netEnds.forEach(({ ends }, n) => ends.forEach((e) => { pts.push({ n, p: e.pin }); pts.push({ n, p: e.end }); segs.push({ n, a: e.pin, b: e.end }); }));
  const clear = (n, legs) => {
    for (const s of legs) {
      for (const q of pts) if (q.n !== n && onSeg(q.p, s)) return false;
      for (const o of segs) if (o.n !== n && (onSeg(s.a, o) || onSeg(s.b, o) || onSeg(o.a, s) || onSeg(o.b, s))) return false;
    }
    return true;
  };

  let labelled = 0, wired = 0, unwired = 0;
  const wire = (a, b, key) => ['wire', ['pts', ['xy', a[0], a[1]], ['xy', b[0], b[1]]], ['stroke', ['width', 0], ['type', 'default']], ['uuid', new Str(stableUuid(`wire|${key}`))]];
  netEnds.forEach(({ net, ends }, n) => {
    for (const e of ends) {
      body.push(wire(e.pin, e.end, e.key));
      const spin = { 0: [0, 'left'], 90: [90, 'left'], 180: [180, 'right'], 270: [270, 'right'] }[e.out];
      body.push(['label', new Str(net.name), ['at', e.end[0], e.end[1], spin[0]], ['effects', ['font', ['size', TEXT, TEXT]], ['justify', spin[1], 'bottom']], ['uuid', new Str(stableUuid(`label|${e.key}`))]]);
      labelled++;
    }
    if (!wires) return;
    // a chain left to right: each pin to the next, across, down, across in a channel between them
    const chain = [...ends].sort((p, q) => p.end[0] - q.end[0] || p.end[1] - q.end[1]);
    for (let k = 1; k < chain.length; k++) {
      const A = chain[k - 1].end, B = chain[k].end;
      const mid = snap((A[0] + B[0]) / 2, G);
      let legs = null;
      for (let tries = 0; tries < 41 && !legs; tries++) {
        const c = mid + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * 1.27;
        const route = [[A, [c, A[1]]], [[c, A[1]], [c, B[1]]], [[c, B[1]], B]]
          .filter(([u, v]) => !(near(u[0], v[0]) && near(u[1], v[1])))
          .map(([u, v]) => ({ n, a: u, b: v }));
        if (clear(n, route)) legs = route;
      }
      if (!legs) { unwired++; continue; }
      legs.forEach((s, j) => { segs.push(s); pts.push({ n, p: s.a }, { n, p: s.b }); body.push(wire(s.a, s.b, `${net.name}|leg|${k}|${j}`)); });
      wired++;
    }
  });
  if (unwired) skipped.push(`${unwired} wire leg(s) left to the net labels: no channel clear of other nets`);

  // groups: a dashed frame round the members' boxes, the name on its top edge (plain sheet graphics: KiCad 9 and 10)
  const frames = [];
  for (const g of groups) {
    const members = (g.refs || []).flatMap((r) => inst.get(r) || []);
    if (!members.length) continue;
    const bx = members.map((m) => boxOf(m.i, m.pos));
    const f = { x1: snap(Math.min(...bx.map((b) => b.x1)), G), y1: snap(Math.min(...bx.map((b) => b.y1)) - G, G),
      x2: snap(Math.max(...bx.map((b) => b.x2)), G), y2: snap(Math.max(...bx.map((b) => b.y2)), G) };
    frames.push([f.x1, f.y1], [f.x2, f.y2]);
    const gid = stableUuid(`group|${g.name}|${(g.refs || []).join(',')}`);
    body.push(['rectangle', ['start', f.x1, f.y1], ['end', f.x2, f.y2], ['stroke', ['width', 0], ['type', 'dash']], ['fill', ['type', 'none']], ['uuid', new Str(gid)]]);
    body.push(['text', new Str(String(g.name)), ['exclude_from_sim', 'no'], ['at', f.x1 + 1.27, f.y1 - 1.27, 0],
      ['effects', ['font', ['size', 2.54, 2.54], ['bold', 'yes']], ['justify', 'left', 'bottom']], ['uuid', new Str(stableUuid(`grouptext|${gid}`))]]);
  }

  const allPts = [...posOf.values(), ...segs.flatMap((q) => [q.a, q.b]), ...frames];
  const w = Math.max(297, Math.ceil((Math.max(0, ...allPts.map((b) => b[0])) + 2 * M) / 10) * 10);
  const h = Math.max(210, Math.ceil((Math.max(0, ...allPts.map((b) => b[1])) + 2 * M) / 10) * 10);
  const tb = ['title_block', ['title', new Str(title)]];
  if (comment) tb.push(['comment', 1, new Str(comment)]);
  const top = ['kicad_sch', ['version', t.version], ['generator', new Str(GENERATOR)], ['generator_version', new Str(t.generatorVersion)],
    ['uuid', new Str(root)], ['paper', new Str('User'), w, h], tb,
    ['lib_symbols', ...[...used].sort().map((id) => embedded(byId.get(id), id, target))],
    ...body,
    ['sheet_instances', ['path', new Str('/'), ['page', new Str('1')]]],
    ['embedded_fonts', 'no']];
  return { text: `${sexpWrite(top)}\n`, placed: placed.length, labelled, wired, skipped };
}

/** sym-lib-table text for the libraries a project folder carries beside its sheet (${KIPRJMOD}/<lib>.kicad_sym). */
export function projectSymLibTable(libraries) {
  return `(sym_lib_table\n\t(version 7)\n${[...new Set(libraries)].sort().map((l) => symLibTableRow(l, 'APK.audio BIM symbols', `\${KIPRJMOD}/${l}.kicad_sym`)).join('\n')}\n)\n`;
}

/* ------------------------------------------------------------------ one file for a browser that cannot write a folder */

let CRC = null;
const crc32 = (bytes) => {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/**
 * {name: text} → a .zip (stored, no compression: every unzip and every OS opens it) as bytes, the files in the order
 * given. One download is one file: a project opened before its sym-lib-table had landed reads a half-written table
 * ("Expecting '(' … line 1, offset 1").
 */
export function zipFiles(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text), nm = enc.encode(name), crc = crc32(data);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
    parts.push(Uint8Array.from(head), nm, data);
    central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)], nm);
    offset += head.length + nm.length + data.length;
  }
  const cd = central.map((c) => (c instanceof Uint8Array ? c : Uint8Array.from(c)));
  const cdLen = cd.reduce((n, c) => n + c.length, 0);
  const count = Object.keys(files).length;
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(cdLen), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...cd, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}
