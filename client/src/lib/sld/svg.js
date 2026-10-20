// Scene → standalone SVG text (P5.1 export: SVG file, PNG via canvas, print-to-PDF). Literal
// colours (no CSS variables) so the file looks the same anywhere; exports use the light palette.

export const SLD_PALETTES = {
  light: {
    line: '#334155', text: '#17202E', muted: '#5B6B85', ok: '#16A34A', warn: '#B45309', bad: '#DC2626',
    phaseA: '#C2410C', phaseB: '#2563EB', phaseC: '#15803D', accent: '#7C3AED', bg: '#FFFFFF'
  },
  dark: {
    line: '#9FB0CC', text: '#DCE6F5', muted: '#7F94B5', ok: '#4FD98A', warn: '#F5B942', bad: '#F0546A',
    phaseA: '#FF9B71', phaseB: '#4F8CFF', phaseC: '#4FD98A', accent: '#C084FC', bg: '#121B2E'
  }
};

export const SLD_FONT = 'IBM Plex Mono, ui-monospace, monospace';

export function escXml(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const n = (v) => Math.round(v * 100) / 100;

/** One primitive as SVG markup. */
export function primToSvg(p, pal) {
  const stroke = pal[p.color] || p.color || pal.line;
  const dash = p.dash ? ` stroke-dasharray="${p.dash.join(',')}"` : '';
  const sw = ` stroke-width="${p.width || 1}"`;
  const fill = p.fill ? (pal[p.fill] || p.fill) : 'none';
  switch (p.k) {
    case 'line': return `<line x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}" stroke="${stroke}"${sw}${dash}/>`;
    case 'polyline': return `<polyline points="${p.points.map(([a, b]) => `${n(a)},${n(b)}`).join(' ')}" fill="none" stroke="${stroke}"${sw}${dash} stroke-linejoin="round"/>`;
    case 'polygon': return `<polygon points="${p.points.map(([a, b]) => `${n(a)},${n(b)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${p.width || 0.8}"/>`;
    case 'rect': return `<rect x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" fill="${fill}" stroke="${stroke}"${sw}${dash}/>`;
    case 'circle': return `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" fill="${fill}" stroke="${stroke}"${sw}${dash}/>`;
    case 'arc': {
      const a0 = p.start * Math.PI / 180, a1 = p.end * Math.PI / 180;
      const x0 = p.cx + p.r * Math.cos(a0), y0 = p.cy - p.r * Math.sin(a0), x1 = p.cx + p.r * Math.cos(a1), y1 = p.cy - p.r * Math.sin(a1);
      const large = ((p.end - p.start + 360) % 360) > 180 ? 1 : 0;
      return `<path d="M${n(x0)},${n(y0)} A${n(p.r)},${n(p.r)} 0 ${large} 0 ${n(x1)},${n(y1)}" fill="none" stroke="${stroke}"${sw}/>`;
    }
    case 'text': return `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${p.size}" text-anchor="${p.anchor || 'start'}" fill="${stroke}"${p.weight ? ` font-weight="${p.weight}"` : ''}>${escXml(p.text)}</text>`;
    default: return '';
  }
}

/**
 * The whole scene as an SVG document. `titleBlock` adds a drawing frame footer: design name,
 * date, snapshot, and prepared / checked / approved fields.
 * @param {any} scene @param {{ theme?: 'light' | 'dark', titleBlock?: { name: string, date: string, snapshot?: string, prepared?: string, checked?: string, approved?: string } }} [opts]
 */
export function sceneToSvg(scene, opts = {}) {
  const pal = SLD_PALETTES[opts.theme || 'light'];
  const tb = opts.titleBlock;
  const tbH = tb ? 64 : 0;
  const W = Math.max(scene.width, tb ? 760 : 0), H = scene.height + tbH;
  const body = scene.elements.map(e => `<g data-id="${escXml(e.id)}"><title>${escXml(e.label || e.id)}</title>${e.prims.map(p => primToSvg(p, pal)).join('')}</g>`).join('\n');
  let frame = '';
  if (tb) {
    const y0 = scene.height, cw = (W - 20) / 4;
    const cell = (i, label, value) => `<rect x="${10 + i * cw}" y="${y0 + 8}" width="${cw}" height="48" fill="none" stroke="${pal.line}" stroke-width="1"/>` +
      `<text x="${16 + i * cw}" y="${y0 + 22}" font-size="8" fill="${pal.muted}">${escXml(label)}</text>` +
      `<text x="${16 + i * cw}" y="${y0 + 42}" font-size="11" fill="${pal.text}" font-weight="600">${escXml(value || '')}</text>`;
    frame = cell(0, 'DESIGN / SNAPSHOT', `${tb.name}${tb.snapshot ? ' — ' + tb.snapshot : ''}`) + cell(1, 'DATE', tb.date) +
      cell(2, 'PREPARED / CHECKED', `${tb.prepared || '__________'} / ${tb.checked || '__________'}`) + cell(3, 'APPROVED', tb.approved || '__________');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(W)}" height="${n(H)}" font-family="${SLD_FONT}">` +
    `<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="${pal.bg}"/>\n${body}\n${frame}</svg>`;
}
