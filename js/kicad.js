// Part of APK.audio - KiCad Netlist Exporter & Importer
// Ported from OneThing FEATURE.KiCadExport

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
    lines.push(`    (comp (ref "${c.ref}")`);
    lines.push(`      (value "${c.value || c.ref}")`);
    lines.push(`      (footprint "${c.footprint || 'Connector:XLR_3Pin'}")`);
    lines.push(`      (libsource (lib "${c.lib || 'Audio'}") (part "${c.part || c.value}"))`);
    lines.push('    )');
  }
  lines.push('  )');

  lines.push('  (nets');
  nets.forEach((net, idx) => {
    lines.push(`    (net (code ${idx + 1}) (name "${net.name}")`);
    for (const node of net.nodes) {
      lines.push(`      (node (ref "${node.ref}") (pin "${node.pin}"))`);
    }
    lines.push('    )');
  });
  lines.push('  )');

  lines.push(')');
  return lines.join('\n');
}

export function parseKiCadNetlist(text) {
  const compMatches = [...text.matchAll(/\(comp \(ref "([^"]+)"\)\s+\(value "([^"]*)"\)/g)];
  const components = compMatches.map(m => ({ ref: m[1], value: m[2] }));

  const netMatches = [...text.matchAll(/\(net \(code (\d+)\) \(name "([^"]+)"\)/g)];
  const nets = netMatches.map(m => ({ code: Number(m[1]), name: m[2] }));

  return { components, nets };
}
