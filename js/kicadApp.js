// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadApp.js — the page: parts and nets as APKTables, the netlist text beside
   them, the block in and out of the CAD (kicadHost.js). */

import { exportKiCadNetlist } from './kicad.js';
import { connectKiCadHost, sampleNetlist, toBlock, netRows } from './kicadHost.js';

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
];

let parts = null;
let nets = null;

function render() {
  $('output').value = exportKiCadNetlist(state.components, state.nets);
  if (!T) return;
  if (parts) parts.setRows(state.components);
  else parts = T.create($('parts-table'), {
    id: 'kicad-components', columns: COMPONENT_COLUMNS, rows: state.components, empty: 'No components.',
    onEdit: (i, key, value) => { state.components[i][key] = value; changed(); },
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
  inputs: [{ name: 'Netlist block', from: 'the CAD (kicad_netlist block: components[], nets[]); a labelled sample until one arrives', kind: 'block' }],
  outputs: [
    { name: 'KiCad netlist', to: 'schematic-export.net download (Download .net File)', kind: 'file' },
    { name: 'Netlist block', to: 'the CAD drawing (Save & Return), or kicad_netlist.json download when standalone', kind: 'block' },
  ],
  controls: [
    { name: 'Component', how: 'Click ➕ Component to add a row; edit a cell in the Components table; delete a row with its ✕' },
    { name: 'Download .net File', how: 'Saves the netlist text shown on the right' },
    { name: 'Save & Return', how: 'Sends the block back to the CAD (or downloads it as .json)' },
  ],
  problems: ['bad_input', 'save_failed', 'sdk_missing'],
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
  render();
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
render();
