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

const host = S ? connectKiCadHost(S, state, {
  onLoaded: (st, meta) => { $('block-tag').textContent = meta.blockName || meta.title || 'FROM THE CAD'; render(); },
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
  const blob = new Blob([$('output').value], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'schematic-export.net';
  a.click();
  URL.revokeObjectURL(a.href);
});

$('btn-save').addEventListener('click', () => {
  const how = host ? host.save(toBlock(state), { filename: 'kicad_netlist' }) : '';
  if (how) $('block-tag').textContent = how === 'host' ? 'SAVED TO THE CAD' : 'DOWNLOADED .JSON';
});

if (!T) $('parts-table').textContent = 'vendor/apk-table did not load.';
render();
