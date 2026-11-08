// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* libraryPanel.js — the KiCad symbol library on this page (kicadLibrary.js does the work).

   In:  📚 a BIM part from the shared library picker (its IFC type, the interchange; the JSON part when
        the IFC carries no ports) → a KLC symbol with our APK_ fields
        📂 .kicad_sym files, or 📁 a whole <Library>.kicad_symdir / a kicad-symbols checkout
   Out: 💾 one .kicad_sym per library, ours with the APK_ fields
        ⬆ the kicad-symbols layout (<Library>.kicad_symdir/<Name>.kicad_sym, APK_ fields dropped):
        written into a folder you pick (a kicad-symbols checkout), else downloaded file by file
   Each symbol is checked against KLC; a picked one can be placed in the netlist. */

import {
  KLC_RULES, klcCheck, libraryOfPath, libraryRows, partFromIfc, readSymbolLib, resolveExtends,
  symbolFromPart, symbolSvg, symLibTableRow, writeSymbolLib, writeSymdir,
} from './kicadLibrary.js';
import { klcUrl } from './klcRules.js';
import { bimApi, partIfcUrl } from './netlistIfc.js';
import { libraryButton } from './bimLibrary.js';
import * as IFC from '../vendor/apk-contracts/apk-ifc.js';

const COLUMNS = [
  { key: 'library', label: 'Library', mono: true },
  { key: 'symbol', label: 'Symbol', mono: true },
  { key: 'reference', label: 'Ref' },
  { key: 'pins', label: 'Pins', type: 'number' },
  { key: 'klc', label: 'KLC' },
  { key: 'bim', label: 'BIM part', mono: true },
  { key: 'description', label: 'Description' },
];

function download(textBody, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([textBody], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** The part a pick stands for: its IFC type when the BIM API gives one with ports, else the JSON part. */
async function partOf(item, fetchFn = globalThis.fetch) {
  const id = item.bim?.id || item.ref?.part;
  let fromIfc = null;
  try {
    const r = await fetchFn(partIfcUrl(id));
    if (r.ok) fromIfc = partFromIfc(await r.text(), IFC);
  } catch { fromIfc = null; }
  if (fromIfc && fromIfc.ports.length) return fromIfc;
  let part = item.bim && Array.isArray(item.bim.ports) ? item.bim : null;
  if (!part) {
    const r = await fetchFn(`${bimApi()}/parts/${String(id).split('/').map(encodeURIComponent).join('/')}`);
    if (!r.ok) throw new Error(`GET part ${id}: HTTP ${r.status}`);
    part = await r.json();
  }
  return { ...part, ifcType: fromIfc?.ifcType || part.ifcType };
}

/**
 * Mount the panel. host: the element; S/T: APKSoftapp / APKTable; onPlace(component): add it to the netlist.
 */
export function mountLibraryPanel(host, { S, T, onPlace }) {
  host.innerHTML = `
    <div class="kl-bar">
      <span id="kl-bim"></span>
      <button id="kl-open" title="One or more .kicad_sym files (KiCad 6–10)">📂 .kicad_sym</button>
      <button id="kl-open-dir" title="A <Library>.kicad_symdir folder, or a whole kicad-symbols checkout">📁 Library folder</button>
      <button id="kl-save" title="Each library as one .kicad_sym, with our APK_ fields">💾 .kicad_sym</button>
      <button id="kl-upstream" title="The kicad-symbols layout: <Library>.kicad_symdir/<Name>.kicad_sym, no APK_ fields">⬆ For kicad-symbols</button>
      <input type="file" id="kl-file" accept=".kicad_sym" multiple hidden>
      <input type="file" id="kl-dir" webkitdirectory multiple hidden>
    </div>
    <div class="kl-status" id="kl-status">No symbols yet: pick a BIM part, or open a KiCad library.</div>
    <div class="kl-grid">
      <div id="kl-table" class="apk-table-host"></div>
      <div class="kl-detail">
        <div class="kl-preview" id="kl-preview"></div>
        <div class="kl-actions"><button id="kl-place" disabled>➕ Place in netlist</button></div>
        <ul class="kl-findings" id="kl-findings"></ul>
      </div>
    </div>`;
  const $ = (id) => host.querySelector(`#${id}`);
  let symbols = [];
  let shown = [];
  let selected = -1;
  let table = null;
  const status = (msg) => { $('kl-status').textContent = msg; };

  function render() {
    shown = resolveExtends(symbols);
    const rows = libraryRows(symbols);
    if (!T) return;
    if (table) table.setRows(rows);
    else table = T.create($('kl-table'), {
      id: 'kicad-symbols', columns: COLUMNS, rows, editable: false, empty: 'No symbols.',
      search: true, searchPlaceholder: 'Find a symbol, keyword or BIM part',
      onSelect: (i) => { selected = i; detail(); },
    });
    detail();
  }

  function detail() {
    const s = shown[selected];
    $('kl-place').disabled = !s;
    if (!s) { $('kl-preview').innerHTML = ''; $('kl-findings').innerHTML = ''; return; }
    $('kl-preview').innerHTML = symbolSvg(s);
    const f = klcCheck(s);
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    $('kl-findings').innerHTML = f.length
      ? f.map((x) => `<li class="kl-${x.level}"><a href="${klcUrl(x.rule)}" target="_blank" rel="noopener" title="${esc(KLC_RULES[x.rule] || '')}">KLC ${x.rule}</a> ${esc(x.message)}</li>`).join('')
      : '<li class="kl-info">KLC: nothing to say.</li>';
  }

  async function addFiles(files) {
    let n = 0, bad = [];
    for (const file of files) {
      if (!/\.kicad_sym$/i.test(file.name)) continue;
      const path = file.webkitRelativePath || file.name;
      try {
        const lib = readSymbolLib(await file.text(), { library: libraryOfPath(path) });
        // the same symbol again replaces the first copy
        for (const s of lib.symbols) {
          const k = symbols.findIndex((o) => o.library === s.library && o.name === s.name);
          if (k >= 0) symbols[k] = s; else symbols.push(s);
          n++;
        }
      } catch (e) { bad.push(`${path}: ${e.message}`); }
    }
    render();
    status(`${n} symbol(s) read · ${symbols.length} on the page${bad.length ? ` · ${bad.length} file(s) unreadable` : ''}`);
    if (bad.length && S) S.showProblem('file_unreadable', { subject: bad[0].split(':')[0], detail: bad.slice(0, 5).join('\n'), fix: ['Open a KiCad 6–10 symbol library (.kicad_sym).'] });
  }

  $('kl-open').addEventListener('click', () => $('kl-file').click());
  $('kl-open-dir').addEventListener('click', () => $('kl-dir').click());
  $('kl-file').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  $('kl-dir').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });

  $('kl-bim').replaceWith(libraryButton(async (items) => {
    let made = 0;
    for (const it of items) {
      try {
        const part = await partOf(it);
        const sym = symbolFromPart(part);
        const k = symbols.findIndex((o) => o.library === sym.library && o.name === sym.name);
        if (k >= 0) symbols[k] = sym; else symbols.push(sym);
        made++;
      } catch (e) {
        if (S) S.showProblem('fetch_failed', { subject: it.bim?.id || it.ref?.part || 'BIM part', detail: e.message, fix: ['Is DATABASE.server.BIM up? The part comes from /api/bim/parts/<maker>/<model>(.ifc).'] });
      }
    }
    render();
    if (made) { selected = shown.length - 1; detail(); }
    status(`${made} symbol(s) made from the BIM library · ${symbols.length} on the page`);
  }, { label: '📚 From BIM part', title: 'Make a KiCad symbol from a BIM part', multiple: true }));

  const byLibrary = () => {
    const m = new Map();
    for (const s of symbols) { const k = s.library || 'APK'; if (!m.has(k)) m.set(k, []); m.get(k).push(s); }
    return m;
  };

  $('kl-save').addEventListener('click', () => {
    if (!symbols.length) { status('Nothing to save: no symbols on the page.'); return; }
    for (const [lib, list] of byLibrary()) download(writeSymbolLib(list), `${lib}.kicad_sym`);
    status(`${byLibrary().size} library file(s) written (KiCad 10, with APK_ fields)`);
  });

  $('kl-upstream').addEventListener('click', async () => {
    if (!symbols.length) { status('Nothing to write: no symbols on the page.'); return; }
    const files = {};
    for (const [lib, list] of byLibrary()) Object.assign(files, writeSymdir(lib, list, { upstream: true }));
    const errors = symbols.flatMap((s) => klcCheck(s).filter((x) => x.level === 'error').map((x) => `${s.name}: KLC ${x.rule} ${x.message}`));
    if (globalThis.showDirectoryPicker) {
      try {
        const root = await globalThis.showDirectoryPicker({ id: 'kicad-symbols', mode: 'readwrite' });
        for (const [path, body] of Object.entries(files)) {
          const [dir, name] = path.split('/');
          const d = await root.getDirectoryHandle(dir, { create: true });
          const w = await (await d.getFileHandle(name, { create: true })).createWritable();
          await w.write(body); await w.close();
        }
        const libs = [...byLibrary().keys()];
        status(`${Object.keys(files).length} file(s) written into ${root.name}/ · new library? add to sym-lib-table: ${libs.map((l) => symLibTableRow(l, '', `\${KICAD10_SYMBOL_DIR}/${l}.kicad_symdir`).trim()).join(' ')}${errors.length ? ` · ${errors.length} KLC error(s) to fix before a merge request` : ''}`);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    for (const [path, body] of Object.entries(files)) download(body, path.replace('/', '__'));
    status(`${Object.keys(files).length} file(s) downloaded as <Library>.kicad_symdir__<Name>.kicad_sym (this browser cannot write a folder)${errors.length ? ` · ${errors.length} KLC error(s)` : ''}`);
  });

  $('kl-place').addEventListener('click', () => {
    const s = shown[selected];
    if (!s || !onPlace) return;
    const P = (k) => s.properties.find((p) => p.name === k)?.value ?? '';
    const comp = { ref: P('Reference') || 'U', value: P('Value') || s.name, footprint: P('Footprint'), lib: s.library, part: s.name };
    if (P('APK_PartId')) comp.bimId = P('APK_PartId');
    comp.pins = s.pins.filter((p) => !p.hide).map((p) => ({ number: p.number, name: p.name, type: p.type }));
    onPlace(comp);
  });

  render();
  return { symbols: () => symbols, add: (list) => { symbols.push(...list); render(); } };
}
