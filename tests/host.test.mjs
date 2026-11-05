// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// The netlist block round trip over cad.like.audio/host@1 (ROAD-3491), with the
// app's vendored APKSoftapp client in a stub window.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { connectKiCadHost, sampleNetlist, fromBlock, toBlock, netRows, EDITOR, BLOCK_TYPE } from '../js/kicadHost.js';
import { exportKiCadNetlist, parseKiCadNetlist } from '../js/kicad.js';

const require = createRequire(import.meta.url);
const { world, hostContract } = require('./host-world.cjs');

test('load → edit → request: the CAD gets the edited netlist back, at our origin, on host@1', async () => {
  const w = world();
  const state = sampleNetlist();
  const loaded = [];
  const host = connectKiCadHost(w.S, state, { onLoaded: (s, meta) => loaded.push(meta), notice: false });
  assert.ok(host.embedded);
  assert.deepEqual(w.toParent[0], { m: { protocol: 'cad.like.audio/host@1', type: 'editorReady', editor: EDITOR, blockType: BLOCK_TYPE }, o: w.ORIGIN });

  w.fire({ protocol: w.S.PROTOCOL, type: 'load', block: { type: BLOCK_TYPE, components: [{ ref: 'R1', value: '10k' }], nets: [{ name: 'N1', nodes: [{ ref: 'R1', pin: '1' }] }] }, meta: { blockName: 'NET_1' } });
  assert.deepEqual(loaded, [{ blockName: 'NET_1' }]);
  assert.deepEqual(state.components.map((c) => c.ref), ['R1']);

  state.components.push({ ref: 'C1', value: '100n', footprint: '', lib: '', part: '' });
  w.fire({ protocol: w.S.PROTOCOL, type: 'request' });
  const save = w.toParent.at(-1);
  assert.equal(save.o, w.ORIGIN, 'never "*"');
  assert.equal(save.m.type, 'blockSave');
  assert.equal(save.m.meta.blockName, 'NET_1');
  assert.deepEqual(save.m.block.components.map((c) => c.ref), ['R1', 'C1']);
  assert.deepEqual(toBlock(fromBlock(save.m.block)), save.m.block, 'the block survives a reload');

  const c = await hostContract();
  if (c) for (const { m } of w.toParent) assert.deepEqual(c.validateMessage(c.schema, 'toCad', m), [], m.type);
});

test('a quote in a value cannot break the s-expression', () => {
  const text = exportKiCadNetlist([{ ref: 'J1', value: 'XLR "F"' }], [{ name: 'A"B', nodes: [] }]);
  assert.match(text, /\(value "XLR \\"F\\""\)/);
  const parsed = parseKiCadNetlist(text);
  assert.equal(parsed.components[0].value, 'XLR "F"');
  assert.equal(parsed.nets[0].name, 'A"B');
});

test('net rows list each node as ref.pin', () => {
  assert.deepEqual(netRows(sampleNetlist().nets)[0], { name: 'MIC_HOT', nodes: 'J1.2, U1.2', count: 2 });
});

test('index.html loads the softapp client and the table before the app module', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const at = (s) => html.indexOf(s);
  assert.ok(at('vendor/apk-contracts/apk-contracts.global.js') > 0);
  assert.ok(at('vendor/apk-softapp/apk-softapp.js') > at('/FrontEnd/shared/apk-bus.js'));
  assert.ok(at('js/kicadApp.js') > at('vendor/apk-table/apk-table.js'));
  assert.doesNotMatch(html, /<table/);
});
