// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* kicadSvg.js — A symbol unit drawn as SVG for a preview. Part of kicadLibrary.js (import from there). */

import { PIN_NAME_OFFSET, text, num, kids, kid, n } from './kicadSexp.js';

/* ------------------------------------------------------------------ a preview */

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** One unit of a symbol as SVG (mm, KiCad's y up drawn down): body graphics, pins, names, numbers. */
export function symbolSvg(sym, { unit = 1, scale = 6 } = {}) {
  const units = sym.units.filter((u) => u.unit === 0 || u.unit === unit || (unit === 1 && !sym.units.some((x) => x.unit === 1)));
  const pins = units.flatMap((u) => u.pins).filter((p) => !p.hide);
  const parts = [];
  const pts = [];
  const P = (x, y) => { pts.push([x, -y]); return `${num(x)},${num(-y)}`; };
  const strokeOf = (g) => Math.max(0.15, n(kid(kid(g, 'stroke'), 'width')?.[1] ?? 0) || 0.15);
  const fillOf = (g) => (text(kid(kid(g, 'fill'), 'type')?.[1]) === 'background' ? 'var(--kl-body, #1e293b)' : text(kid(kid(g, 'fill'), 'type')?.[1]) === 'outline' ? 'currentColor' : 'none');
  for (const u of units) for (const g of u.graphics) {
    if (g[0] === 'rectangle') {
      const s = kid(g, 'start'), e = kid(g, 'end');
      const x1 = Math.min(n(s[1]), n(e[1])), x2 = Math.max(n(s[1]), n(e[1])), y1 = Math.min(n(s[2]), n(e[2])), y2 = Math.max(n(s[2]), n(e[2]));
      P(x1, y1); P(x2, y2);
      parts.push(`<rect x="${num(x1)}" y="${num(-y2)}" width="${num(x2 - x1)}" height="${num(y2 - y1)}" fill="${fillOf(g)}" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'polyline') {
      const list = kids(kid(g, 'pts'), 'xy').map((xy) => P(n(xy[1]), n(xy[2]))).join(' ');
      parts.push(`<polyline points="${list}" fill="${fillOf(g)}" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'circle') {
      const c = kid(g, 'center'), r = n(kid(g, 'radius')[1]);
      P(n(c[1]) - r, n(c[2]) - r); P(n(c[1]) + r, n(c[2]) + r);
      parts.push(`<circle cx="${num(n(c[1]))}" cy="${num(-n(c[2]))}" r="${num(r)}" fill="${fillOf(g)}" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'arc') {
      const s = kid(g, 'start'), m = kid(g, 'mid'), e = kid(g, 'end');
      if (s && m && e) parts.push(`<polyline points="${P(n(s[1]), n(s[2]))} ${P(n(m[1]), n(m[2]))} ${P(n(e[1]), n(e[2]))}" fill="none" stroke="currentColor" stroke-width="${strokeOf(g)}"/>`);
    } else if (g[0] === 'text') {
      const at = kid(g, 'at');
      P(n(at[1]), n(at[2]));
      parts.push(`<text x="${num(n(at[1]))}" y="${num(-n(at[2]))}" font-size="1.27" text-anchor="middle" dominant-baseline="middle" fill="currentColor">${xml(text(g[1]))}</text>`);
    }
  }
  const showNames = !sym.pinNames.hide, showNums = !sym.pinNumbers.hide;
  const off = sym.pinNames.offset ?? PIN_NAME_OFFSET;
  for (const p of pins) {
    const [x, y, a] = p.at;
    const rad = (a * Math.PI) / 180;
    const ex = x + Math.cos(rad) * p.length, ey = y + Math.sin(rad) * p.length;
    P(x, y); P(ex, ey);
    const colour = p.type.startsWith('power') ? 'var(--kl-power, #f87171)' : 'var(--kl-pin, #38bdf8)';
    parts.push(`<line x1="${num(x)}" y1="${num(-y)}" x2="${num(ex)}" y2="${num(-ey)}" stroke="${colour}" stroke-width="0.2"/><circle cx="${num(x)}" cy="${num(-y)}" r="0.35" fill="${colour}"><title>${xml(`${p.name} (${p.number}) · ${p.type}`)}</title></circle>`);
    const horiz = a === 0 || a === 180;
    const name = p.name && p.name !== '~' ? p.name.replace(/~\{([^}]*)\}/g, '$1') : '';
    if (showNames && name) {
      const nx = ex + Math.cos(rad) * off, ny = ey + Math.sin(rad) * off;
      const anchor = horiz ? (a === 0 ? 'start' : 'end') : 'middle';
      const rot = horiz ? '' : ` transform="rotate(-90 ${num(nx)} ${num(-ny)})"`;
      const anchorV = horiz ? anchor : (a === 270 ? 'end' : 'start');
      parts.push(`<text x="${num(nx)}" y="${num(-ny)}" font-size="1.1" text-anchor="${anchorV}" dominant-baseline="middle" fill="currentColor"${rot}>${xml(name)}</text>`);
    }
    if (showNums) {
      const mx = (x + ex) / 2, my = (y + ey) / 2;
      parts.push(`<text x="${num(mx)}" y="${num(-my - (horiz ? 0.4 : 0))}" font-size="0.9" text-anchor="middle" fill="var(--kl-num, #94a3b8)"${horiz ? '' : ` transform="rotate(-90 ${num(mx - 0.4)} ${num(-my)})"`}>${xml(p.number)}</text>`);
    }
  }
  for (const f of sym.properties.filter((q) => !q.hide && (q.name === 'Reference' || q.name === 'Value'))) {
    const [x, y] = f.at;
    P(x, y);
    const anchor = f.justify.includes('left') ? 'start' : f.justify.includes('right') ? 'end' : 'middle';
    parts.push(`<text x="${num(x)}" y="${num(-y)}" font-size="1.27" text-anchor="${anchor}" fill="currentColor" font-weight="${f.name === 'Value' ? 600 : 400}">${xml(f.name === 'Reference' ? `${f.value}?` : f.value)}</text>`);
  }
  if (!pts.length) pts.push([0, 0]);
  const pad = 6;
  const x0 = Math.min(...pts.map((q) => q[0])) - pad, x1 = Math.max(...pts.map((q) => q[0])) + pad;
  const y0 = Math.min(...pts.map((q) => q[1])) - pad, y1 = Math.max(...pts.map((q) => q[1])) + pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)}" width="${Math.round((x1 - x0) * scale)}" height="${Math.round((y1 - y0) * scale)}" font-family="sans-serif">${parts.join('')}</svg>`;
}
