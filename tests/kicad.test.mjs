import test from 'node:test';
import assert from 'node:assert/strict';
import { exportKiCadNetlist, parseKiCadNetlist } from '../js/kicad.js';

test('KiCad exporter emits valid s-expressions and round-trips components', () => {
  const comps = [
    { ref: 'J1', value: 'XLR-3', footprint: 'Audio:XLR', lib: 'Audio', part: 'XLR' },
    { ref: 'R1', value: '10k', footprint: 'Resistor_SMD:R_0805', lib: 'Device', part: 'R' }
  ];
  const nets = [
    { name: 'NET_IN', nodes: [{ ref: 'J1', pin: '1' }, { ref: 'R1', pin: '1' }] }
  ];

  const netText = exportKiCadNetlist(comps, nets);
  assert.match(netText, /export \(version D\)/);
  assert.match(netText, /comp \(ref "J1"\)/);
  assert.match(netText, /net \(code 1\) \(name "NET_IN"\)/);

  const parsed = parseKiCadNetlist(netText);
  assert.equal(parsed.components.length, 2);
  assert.equal(parsed.components[0].ref, 'J1');
  assert.equal(parsed.nets.length, 1);
  assert.equal(parsed.nets[0].name, 'NET_IN');
});
