// Part of APK.audio - KiCad Netlist Exporter & Importer
// Ported from OneThing FEATURE.KiCadExport

/** A KiCad s-expression string body: backslash and double quote escaped, newlines flattened. */
export function q(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

export function exportKiCadNetlist(components = [], nets = []) {
  const lines = [];
  lines.push('(export (version D)');
  lines.push('  (design');
  lines.push('    (source "APK.audio")');
  lines.push(`    (date "${new Date().toISOString()}")`);
  lines.push('    (tool "APK KiCad Netlist Exporter v1.0")');
  lines.push('  )');

  lines.push('  (components');
  for (const c of components) {
    lines.push(`    (comp (ref "${q(c.ref)}")`);
    lines.push(`      (value "${q(c.value || c.ref)}")`);
    lines.push(`      (footprint "${q(c.footprint || 'Connector:XLR_3Pin')}")`);
    lines.push(`      (libsource (lib "${q(c.lib || 'Audio')}") (part "${q(c.part || c.value)}"))`);
    lines.push('    )');
  }
  lines.push('  )');

  lines.push('  (nets');
  nets.forEach((net, idx) => {
    lines.push(`    (net (code ${idx + 1}) (name "${q(net.name)}")`);
    for (const node of net.nodes) {
      lines.push(`      (node (ref "${q(node.ref)}") (pin "${q(node.pin)}"))`);
    }
    lines.push('    )');
  });
  lines.push('  )');

  lines.push(')');
  return lines.join('\n');
}

const STR = '"((?:[^"\\\\]|\\\\.)*)"';
const unq = (s) => s.replace(/\\(.)/g, '$1');

export function parseKiCadNetlist(text) {
  const compRe = new RegExp(`\\(comp \\(ref ${STR}\\)\\s+\\(value ${STR}\\)`, 'g');
  const components = [...text.matchAll(compRe)].map((m) => ({ ref: unq(m[1]), value: unq(m[2]) }));

  const netRe = new RegExp(`\\(net \\(code (\\d+)\\) \\(name ${STR}\\)`, 'g');
  const nets = [...text.matchAll(netRe)].map((m) => ({ code: Number(m[1]), name: unq(m[2]) }));

  return { components, nets };
}
