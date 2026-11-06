// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// The netlist block as IFC4X3 (js/netlistIfc.js, the same bytes as EDITORS.KiCad's, ROAD-3583): components as
// occurrences (typed by their BIM part when they name one, else USERDEFINED), the pins the nets name as
// IfcDistributionPort, a net as an IfcDistributionCircuit — written, read back equal, checked by IfcOpenShell.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IFC_GUID_RE, parseStep } from '../vendor/apk-contracts/apk-ifc.js';
import { fromBlock, sampleNetlist, toBlock } from '../js/kicadHost.js';
import { blockFromNetlist, ifcToNetlist, netlistFromBlock, netlistToIfc } from '../js/netlistIfc.js';
import { buildBundle, BUNDLE } from '../scripts/vendor-ifc.mjs';

const PART = 'neutrik/na-2i2o-dline';
const partTypes = () => ({ [PART]: readFileSync(new URL('./fixtures/parts/neutrik--na-2i2o-dline.ifc', import.meta.url), 'utf8') });
const byType = (text, type) => parseStep(text).entities.filter((e) => e.type === type);

/** The sample netlist plus a Dante breakout typed by its BIM part, and a node on a ref the list does not have. */
function fixtureBlock() {
  const st = sampleNetlist();
  st.components.push({ ref: 'M1', value: 'NA2-IO-DLINE', footprint: 'Module:Neutrik_NA2-IO-DLINE', lib: 'Audio', part: 'DANTE_IO', bimId: PART });
  st.nets.push({ name: 'LINE_OUT', nodes: [{ ref: 'U1', pin: '6' }, { ref: 'M1', pin: '1' }, { ref: 'TP1', pin: '1' }] });
  st.nets.push({ name: 'SPARE', nodes: [{ ref: 'M1', pin: '4' }] });
  return toBlock(st);
}
const exportFixture = () => netlistToIfc(netlistFromBlock(fixtureBlock()), { types: partTypes(), fileName: 'kicad_netlist', editor: 'DATATYPE.KiCad' });

test('the vendored STEP codec is what contracts/src/ifc builds to today', async () => {
  const now = await buildBundle();
  if (now == null) return;
  assert.equal(readFileSync(BUNDLE, 'utf8'), now, 'run node scripts/vendor-ifc.mjs');
});

test('the same netlistIfc.js as EDITORS.KiCad (one netlist, two pages)', () => {
  const other = new URL('../../../EDITORS/EDITORS.KiCad/js/netlistIfc.js', import.meta.url);
  let theirs = null;
  try { theirs = readFileSync(other, 'utf8'); } catch (_) { return; } // this repo on its own
  assert.equal(readFileSync(new URL('../js/netlistIfc.js', import.meta.url), 'utf8'), theirs, 'change them together');
});

test('export: components, the pins the nets name, a circuit per net; an unlisted ref is a component marked so', () => {
  const text = exportFixture();
  assert.ok(text.includes("FILE_SCHEMA(('IFC4X3_ADD2'));"));
  const file = parseStep(text);
  const own = byType(text, 'IFCELECTRICAPPLIANCE');
  assert.deepEqual(own.map((e) => e.args[7]), ['J1', 'U1', 'J2', 'TP1']);
  assert.equal(own[0].args[4], 'Audio:XLR3', 'ObjectType = the KiCad symbol lib:part');
  assert.equal(byType(text, 'IFCAUDIOVISUALAPPLIANCE')[0].args[2], 'M1', 'typed by its BIM part');
  const circuits = byType(text, 'IFCDISTRIBUTIONCIRCUIT');
  assert.deepEqual(circuits.map((c) => c.args[2]), ['MIC_HOT', 'MIC_COLD', 'GND', 'LINE_OUT', 'SPARE']);
  const spare = byType(text, 'IFCRELASSIGNSTOGROUP').find((r) => r.args[6].id === circuits[4].id);
  assert.equal(spare.args[4].length, 1, 'a one-pin net is still a net');
  assert.equal(byType(text, 'IFCRELCONNECTSPORTS').length, 0);
  const gids = file.entities.filter((e) => typeof e.args[0] === 'string' && IFC_GUID_RE.test(e.args[0])).map((e) => e.args[0]);
  assert.equal(new Set(gids).size, gids.length, 'GlobalIds are unique');
  assert.equal(exportFixture(), text, 'byte-deterministic');
});

test('round trip: the .ifc reads back to the same block, and the page loads it', () => {
  const block = fixtureBlock();
  const back = blockFromNetlist(ifcToNetlist(exportFixture()));
  assert.deepEqual(back, block);
  assert.deepEqual(toBlock(fromBlock(back)), block, 'the bimId survives the page\'s own load');
});

// IfcOpenShell (LGPL, test-only, never vendored) when the environment has it: APK_IFC_PYTHON=<python with ifcopenshell + ifctester>
test('IfcOpenShell: 0 schema + EXPRESS statements, every set declared, structural IDS specs pass, the netlist\'s shape holds', { skip: !process.env.APK_IFC_PYTHON && 'set APK_IFC_PYTHON to a python with ifcopenshell + ifctester' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kicad-netlist-ifc-'));
  const files = {
    'kicad-netlist-block.ifc': exportFixture(),
    'kicad-netlist-sample.ifc': netlistToIfc(netlistFromBlock(toBlock(sampleNetlist()))),
  };
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  const script = new URL('../scripts/validate-ifc.py', import.meta.url).pathname;
  const run = spawnSync(process.env.APK_IFC_PYTHON, ['-I', script, ...Object.keys(files).map((n) => join(dir, n))], { cwd: tmpdir(), encoding: 'utf8' });
  const rows = run.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(rows.length, 2, run.stderr);
  for (const r of rows) {
    assert.equal(r.schema, 'IFC4X3_ADD2');
    assert.equal(r.statements, 0, `${r.file}: ${r.first.join(' | ')}`);
    assert.deepEqual(r.pset_problems, [], r.file);
    assert.deepEqual(r.connection_problems, [], r.file);
    assert.deepEqual(r.ids_failed, [], r.file);
    assert.deepEqual(r.checks, [], r.file);
  }
  assert.deepEqual(rows[0].nets.find((x) => x.name === 'LINE_OUT').members, ['U1.6', 'M1.1', 'TP1.1']);
  assert.equal(run.status, 0, run.stderr);
});
