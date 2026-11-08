// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadApp.js — the page: parts and nets as APKTables, the netlist text beside
   them, the block in and out of the CAD (kicadHost.js). */

import { exportKiCadNetlist } from './kicad.js';
import { connectKiCadHost, sampleNetlist, toBlock, netRows, fromBlock } from './kicadHost.js';
import { mountLibraryPanel } from './libraryPanel.js';
import { blockFromNetlist, fetchPartTypes, ifcToNetlist, netlistFromBlock, netlistToIfc } from './netlistIfc.js';

const S = window.APKSoftapp;
const T = window.APKTable;
const state = sampleNetlist();
const $ = (id) => document.getElementById(id);

const COMPONENT_COLUMNS = [
  { key: 'ref', label: 'Ref', mono: true },
  { key: 'value', label: 'Value' },
  { key: 'footprint', label: 'Footprint', mono: true },
  { key: 'lib', label: 'Lib' },
  { key: 'part', label: 'Part' },
  { key: 'bimId', label: 'BIM part', mono: true, placeholder: 'maker/model' },
];
/** pid → the BIM part's .ifc type text (or null when the BIM API did not give it), for Save Model */
const typeCache = new Map();

let parts = null;
let nets = null;

function render() {
  $('output').value = exportKiCadNetlist(state.components, state.nets);
  if (!T) return;
  if (parts) parts.setRows(state.components);
  else parts = T.create($('parts-table'), {
    id: 'kicad-components', columns: COMPONENT_COLUMNS, rows: state.components, empty: 'No components.',
    onEdit: (i, key, value) => {
      if (key === 'bimId' && !String(value).trim()) delete state.components[i].bimId;
      else state.components[i][key] = key === 'bimId' ? String(value).trim() : value;
      changed();
    },
    onDelete: (i) => { state.components.splice(i, 1); changed(); },
  });
  if (nets) nets.setRows(netRows(state.nets));
  else nets = T.create($('nets-table'), {
    id: 'kicad-nets', editable: false, rows: netRows(state.nets), empty: 'No nets.',
    columns: [{ key: 'name', label: 'Net', mono: true }, { key: 'nodes', label: 'Nodes (ref.pin)', mono: true }, { key: 'count', label: 'Pins', type: 'number' }],
  });
}

if (S) S.describe({
  name: 'KiCad Netlist Translator',
  does: 'Edits a schematic netlist (parts and nets) and writes it as a KiCad Eeschema .net file for PCB layout.',
  inputs: [
    { name: 'Netlist block', from: 'the CAD (kicad_netlist block: components[], nets[]); a labelled sample until one arrives', kind: 'block' },
    { name: 'Model file', from: '.json or its .ifc twin picked with 📂 Open (APKSoftapp.openModel)', kind: 'file' },
    { name: 'Part types', from: 'GET /api/bim/parts/<maker>/<model>.ifc: the type of each component that names a BIM part', kind: 'http' },
    { name: 'BIM part → symbol', from: '📚 From BIM part: the shared library picker, then the part\'s IFC type (its JSON when the IFC has no ports)', kind: 'http' },
    { name: 'KiCad symbol libraries', from: '📂 .kicad_sym files or 📁 a <Library>.kicad_symdir / kicad-symbols checkout (KiCad 6–10)', kind: 'file' },
  ],
  outputs: [
    { name: 'KiCad netlist', to: 'schematic-export.net download (Download .net File)', kind: 'file' },
    { name: 'Netlist block', to: 'the CAD drawing (Save & Return), or kicad_netlist.json download when standalone', kind: 'block' },
    { name: 'Symbol library', to: '💾 .kicad_sym: one file per library, KiCad 10, with the APK_ fields that tie each symbol to its BIM part', kind: 'file' },
    { name: 'kicad-symbols layout', to: '⬆ For kicad-symbols: <Library>.kicad_symdir/<Name>.kicad_sym without APK_ fields, into a folder you pick', kind: 'file' },
    { name: 'Model + .ifc twin', to: '💾 Save Model: kicad_netlist.json and kicad_netlist.ifc (IFC4X3_ADD2: components as occurrences typed by their BIM parts, pins as IfcDistributionPort, a net as an IfcDistributionCircuit)', kind: 'file' },
  ],
  controls: [
    { name: 'Component', how: 'Click ➕ Component to add a row; edit a cell in the Components table; delete a row with its ✕' },
    { name: 'Download .net File', how: 'Saves the netlist text shown on the right' },
    { name: '📂 Open', how: 'Opens a netlist block (.json) or its .ifc twin' },
    { name: '💾 Save Model', how: 'Writes the block as .json and its .ifc twin, both or neither' },
    { name: 'Save & Return', how: 'Sends the block back to the CAD (or downloads it as .json)' },
    { name: 'Symbol library', how: 'Pick a symbol row to see it drawn and its KLC findings (each links to the rule); ➕ Place in netlist adds it as a component' },
  ],
  problems: ['bad_input', 'save_failed', 'sdk_missing', 'file_unreadable', 'fetch_failed'],
});

/* A block that is not a netlist loads as empty — say which field was missing. */
function checkBlock(block, meta) {
  const b = block && typeof block === 'object' ? block : null;
  const missing = ['components', 'nets'].filter((k) => !b || !Array.isArray(b[k]));
  if (!missing.length || !S) return;
  S.showProblem('bad_input', {
    subject: (meta && (meta.blockName || meta.title)) || 'CAD block',
    detail: `The block has no ${missing.map((k) => `${k}[]`).join(' or ')} field${missing.length > 1 ? 's' : ''}, so ${missing.join(' and ')} loaded empty.`,
    fix: ['Open this block from a KiCad netlist (kicad_netlist) block in the CAD, not another block type.'],
  });
}

const host = S ? connectKiCadHost(S, state, {
  onLoaded: (st, meta, block) => { $('block-tag').textContent = meta.blockName || meta.title || 'FROM THE CAD'; render(); checkBlock(block, meta); },
}) : null;

function changed() {
    if (host) host.changed(toBlock(state));
}

$('btn-add').addEventListener('click', () => {
  state.components.push({ ref: `X${state.components.length + 1}`, value: '', footprint: '', lib: '', part: '' });
  changed();
});

$('btn-dl').addEventListener('click', () => {
  if (!$('output').value.trim()) {
    if (S) S.showProblem('bad_input', { subject: 'schematic-export.net', detail: 'The netlist is empty: there is nothing to download.', fix: ['Add a component with ➕ Component, or open a netlist block from the CAD.'] });
    return;
  }
  const blob = new Blob([$('output').value], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schematic-export.net';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('btn-open').addEventListener('click', async () => {
  if (!S) return;
  const o = await S.openModel({
    fromIfc: (text) => blockFromNetlist(ifcToNetlist(text)),
    fromJson: (data) => data,
  });
  if (!o.ok) {
    if (!o.cancelled && o.problem) S.showProblem(o.problem, { fix: ['Open a netlist block saved by this page (.json, kicad_netlist) or its .ifc twin.'] });
    return;
  }
  Object.assign(state, fromBlock(o.model));
  $('block-tag').textContent = o.name || 'OPENED';
  checkBlock(o.model, { title: o.name });
  changed();
});

$('btn-save-model').addEventListener('click', async () => {
  if (!S) return;
  const r = await S.saveModel(state, {
    name: 'kicad_netlist',
    toJson: (st) => toBlock(st),
    toIfc: async (st) => {
      const n = netlistFromBlock(toBlock(st));
      return netlistToIfc(n, { types: (await fetchPartTypes(n, typeCache)).types, fileName: 'kicad_netlist', editor: 'DATATYPE.KiCad' });
    },
  });
  if (!r.ok && !r.cancelled && r.problem) S.showProblem(r.problem);
  else if (r.ok) $('block-tag').textContent = 'SAVED .JSON + .IFC';
});

$('btn-save').addEventListener('click', () => {
  let how = '';
  try { how = host ? host.save(toBlock(state), { filename: 'kicad_netlist' }) : ''; }
  catch (e) { S.showProblem('save_failed', { subject: 'kicad_netlist', detail: e && e.message ? e.message : String(e), onRetry: () => $('btn-save').click() }); return; }
  if (!host) $('block-tag').textContent = 'NOT SAVED: SHARED CODE MISSING';
  if (how) $('block-tag').textContent = how === 'host' ? 'SAVED TO THE CAD' : 'DOWNLOADED .JSON';
});

if (!T) {
  if (S) S.showProblem('sdk_missing', { into: $('parts-table'), detail: 'vendor/apk-table/apk-table.js did not load, so the tables cannot draw.', dismissable: false });
  else $('parts-table').textContent = 'vendor/apk-table and vendor/apk-softapp did not load: reload (Ctrl+Shift+R), or re-vendor them with .apk.scripts/vendor_shared_web.py.';
}

mountLibraryPanel($('library-panel'), {
  S, T,
  onPlace: (comp) => {
    const prefix = comp.ref.replace(/[0-9?]+$/, '') || 'U';
    let k = 1;
    while (state.components.some((c) => c.ref === `${prefix}${k}`)) k++;
    const row = { ref: `${prefix}${k}`, value: comp.value, footprint: comp.footprint, lib: comp.lib, part: comp.part };
    if (comp.bimId) row.bimId = comp.bimId;
    state.components.push(row);
    changed();
  },
});
render();
