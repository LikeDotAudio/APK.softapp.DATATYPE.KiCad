// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadLibrary.js: KiCad symbol libraries in and out, judged by KLC.
   fixtures/kicad-symbols/ is one symbol from gitlab.com/kicad/libraries/kicad-symbols
   (afdc05ba, 2026-11-06; CC-BY-SA 4.0 with the KiCad library exception, its LICENSE.md beside it). */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as IFC from '../vendor/apk-contracts/apk-ifc.js';
import {
  footprintFilterMatches, klcCheck, libraryOfPath, parseFootprintId, partFromIfc, partFromSymbol, readSymbolLib,
  resolveExtends, sexpParse, sexpWrite, symbolFromPart, symbolSvg, writeSymbolLib, writeSymdir, GRID, KICAD_SYM_VERSION,
} from '../js/kicadLibrary.js';
import { KLC_REFDES, KLC_RULES } from '../js/klcRules.js';

const fx = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const XLR3 = 'kicad-symbols/Connector_Audio.kicad_symdir/XLR3.kicad_sym';
const MEYER = JSON.parse(fx('parts/meyer-sound--09-314-001-01.bim.json'));
const onGrid = (v) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-6;
const norm = (s) => s.replace(/\s+/g, ' ').trim();

test('the KLC index is there: S, F, G and M rules, and the S6.1 reference table', () => {
  for (const id of ['S3.1', 'S4.1', 'S4.2', 'S6.2', 'F2.1', 'G1.1', 'M1.1']) assert.ok(KLC_RULES[id], id);
  for (const r of ['A', 'J', 'U', 'LS', 'MK']) assert.ok(KLC_REFDES[r], r);
});

test('s-expressions: strings with escapes and atoms survive a round trip', () => {
  const t = sexpParse('(a "x \\"y\\" \\\\ z" b (c 1.27 -2.54))');
  assert.equal(t[0][1].s, 'x "y" \\ z');
  assert.deepEqual(JSON.stringify(sexpParse(sexpWrite(t[0]))), JSON.stringify(t));
});

test('a stock kicad-symbols file reads, and writes back as it came', () => {
  const src = fx(XLR3);
  const lib = readSymbolLib(src, { library: libraryOfPath(XLR3) });
  assert.equal(lib.version, KICAD_SYM_VERSION);
  const [s] = lib.symbols;
  assert.equal(s.library, 'Connector_Audio');
  assert.equal(s.name, 'XLR3');
  assert.equal(s.pins.length, 3);
  assert.equal(s.pinNames.hide, true);
  assert.deepEqual(s.pins.map((p) => p.number), ['1', '2', '3']);
  assert.equal(norm(writeSymbolLib(lib.symbols, { generator: 'kicad_symbol_editor', target: 'kicad10' })), norm(src));
});

test('written for KiCad 9: its version, hide inside effects, no KiCad 10 tokens; it reads back the same', () => {
  const [s] = readSymbolLib(fx(XLR3), { library: 'Connector_Audio' }).symbols;
  const nine = writeSymbolLib([s]);
  assert.match(nine, /\(version 20241209\)/);
  assert.ok(!/in_pos_files|duplicate_pin_numbers_are_jumpers|show_name no|do_not_autoplace no/.test(nine));
  const [r] = readSymbolLib(nine, { library: 'Connector_Audio' }).symbols;
  assert.equal(r.properties.find((p) => p.name === 'Footprint').hide, true);
  assert.equal(r.properties.find((p) => p.name === 'Reference').hide, false);
  assert.deepEqual(r.pins.map((p) => [p.number, ...p.at]), s.pins.map((p) => [p.number, ...p.at]));
});

test('KiCad 6–8 text (bare hide, older version) still reads', () => {
  const old = `(kicad_symbol_lib (version 20211014) (generator kicad_symbol_editor)
    (symbol "R" (pin_numbers hide) (pin_names (offset 0)) (in_bom yes) (on_board yes)
      (property "Reference" "R" (id 0) (at 2.032 0 90) (effects (font (size 1.27 1.27))))
      (property "Footprint" "" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
      (symbol "R_1_1" (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))))`;
  const [s] = readSymbolLib(old, { library: 'Device' }).symbols;
  assert.equal(s.pinNumbers.hide, true);
  assert.equal(s.properties.find((p) => p.name === 'Footprint').hide, true);
  assert.equal(s.pins[0].at[2], 270);
});

test('extends: a derived symbol takes its base\'s pins, within its own library', () => {
  const base = `(kicad_symbol_lib (version 20251024) (symbol "B" (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "B_1_1" (pin input line (at -5.08 0 0) (length 2.54) (name "IN" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27))))))))`;
  const kid = '(kicad_symbol_lib (version 20251024) (symbol "D" (extends "B") (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))))';
  const all = [...readSymbolLib(base, { library: 'L' }).symbols, ...readSymbolLib(kid, { library: 'L' }).symbols, ...readSymbolLib(kid, { library: 'Other' }).symbols];
  const r = resolveExtends(all);
  assert.equal(r[1].pins.length, 1);
  assert.equal(r[2].pins.length, 0, 'a base in another library is not its base');
});

test('a BIM part becomes a KLC symbol: grid, sides, fields, and KLC has no error or warning', () => {
  const s = symbolFromPart(MEYER);
  assert.equal(s.library, 'Audio_MeyerSound');                     // KLC S1.1
  assert.equal(s.name, '09.314.001.01');                           // KLC S2.1: the MPN
  assert.equal(s.pins.length, 26);
  for (const p of s.pins) assert.ok(onGrid(p.at[0]) && onGrid(p.at[1]), `${p.number} on grid`);   // KLC S4.1
  assert.equal(new Set(s.pins.map((p) => p.number)).size, 26);
  const pin = (name, n = 0) => s.pins.filter((p) => p.name === name)[n];
  assert.equal(pin('THRU-1').at[2], 180, 'outputs on the right');   // KLC S4.2
  assert.equal(pin('CH-1', 0).at[2], 0, 'inputs on the left');
  assert.equal(pin('AC_MAINS').at[2], 270, 'mains on top');
  assert.equal(pin('AC_MAINS').type, 'power_in');                  // KLC S4.4
  assert.equal(pin('THRU-1').type, 'output');
  const P = (k) => s.properties.find((p) => p.name === k);
  assert.equal(P('Reference').value, 'A');                         // KLC S6.1: a sub-assembly
  assert.equal(P('Reference').hide, false);
  assert.equal(P('Footprint').value, '');                          // KLC S5.1: generic
  assert.equal(P('APK_PartId').value, 'meyer-sound/09-314-001-01');
  const bad = klcCheck(s).filter((f) => f.level !== 'info');
  assert.deepEqual(bad, []);
});

test('our symbol comes back to the same BIM ports; upstream output carries no APK_ field', () => {
  const s = symbolFromPart(MEYER);
  const text = writeSymbolLib([s]);
  const back = readSymbolLib(text, { library: s.library }).symbols[0];
  const part = partFromSymbol(back);
  assert.equal(part.id, MEYER.id);
  assert.deepEqual(part.ports.map((r) => [r.group, r.side, r.domain, r.count]), MEYER.ports.map((r) => [r.group, r.side, r.domain, r.count]));
  assert.deepEqual(part.ports[1].labels, MEYER.ports[1].labels);
  const files = writeSymdir(s.library, [s], { upstream: true });
  assert.deepEqual(Object.keys(files), ['Audio_MeyerSound.kicad_symdir/09.314.001.01.kicad_sym']);
  assert.ok(!Object.values(files)[0].includes('APK_'));
  assert.ok(writeSymbolLib([s]).includes('APK_Ports'));
});

test('a stock symbol becomes a BIM part draft: a port per pin, its KiCad id kept', () => {
  const [s] = readSymbolLib(fx(XLR3), { library: 'Connector_Audio' }).symbols;
  const part = partFromSymbol(s);
  assert.equal(part.kicad.lib_id, 'Connector_Audio:XLR3');
  assert.equal(part.ports.length, 3);
  assert.ok(part.ports.every((r) => r.side === 'connection'));
});

test('the IFC type gives the same ports as the JSON part', () => {
  const p = partFromIfc(fx('parts/meyer-sound--09-314-001-01.ifc'), IFC);
  assert.equal(p.id, MEYER.id);
  assert.equal(p.manufacturer, 'Meyer Sound');
  assert.match(p.ifcType, /^IFC.*TYPE$/);
  assert.deepEqual(p.ports.map((r) => [r.group, r.side, r.domain, r.count]), MEYER.ports.map((r) => [r.group, r.side, r.domain, r.count]));
  const s = symbolFromPart(p);
  assert.equal(s.properties.find((x) => x.name === 'APK_IfcType').value, p.ifcType);
});

test('klcCheck names the rule it applies', () => {
  const s = symbolFromPart(MEYER);
  s.properties.find((p) => p.name === 'Reference').hide = true;
  s.units[1].pins[0].at = [s.units[1].pins[0].at[0] + 1, s.units[1].pins[0].at[1], 0];
  s.properties.push({ name: 'Vendor', value: 'x', at: [0, 0, 0], size: 1.27, hide: true, justify: [] });
  const rules = klcCheck(s).map((f) => `${f.rule} ${f.level}`);
  assert.ok(rules.includes('S6.2 error'), 'Reference hidden');
  assert.ok(rules.includes('S4.1 error'), 'pin off grid');
  assert.ok(rules.includes('S6.2 warning'), 'custom field');
});

test('footprint names and filters, the KLC way', () => {
  const f = parseFootprintId('Package_SO:SOIC-8_3.9x4.9mm_P1.27mm');
  assert.equal(f.family, 'SOIC'); assert.equal(f.pins, 8); assert.equal(f.pitch, 1.27); assert.deepEqual(f.body, { x: 3.9, y: 4.9 });
  const h = parseFootprintId('Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Vertical');
  assert.equal(h.pins, 10); assert.equal(h.orientation, 'Vertical');
  assert.ok(footprintFilterMatches('SOIC*3.9x4.9mm*P1.27mm*', 'Package_SO:SOIC-8_3.9x4.9mm_P1.27mm'));
  assert.ok(footprintFilterMatches('SOT?23*', 'Package_TO_SOT_SMD:SOT-23'));
  assert.ok(footprintFilterMatches('Connector*:*Pitch?1.25mm*', 'Connector_Molex:Molex_Pitch_1.25mm'));
  assert.ok(!footprintFilterMatches('Connector*:*Pitch?1.25mm*', 'Package_SO:Pitch_1.25mm'));
});

test('the preview draws every visible pin', () => {
  const s = symbolFromPart(MEYER);
  const svg = symbolSvg(s);
  assert.match(svg, /^<svg /);
  assert.equal((svg.match(/<line /g) || []).length, 26);
});
