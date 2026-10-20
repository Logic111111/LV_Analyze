// Scene → minimal ASCII DXF R12 (AC1009), written here rather than with a library (P5.1). Only
// LINE, CIRCLE, ARC and TEXT entities are used, which every CAD package reads. Each element type
// has its own layer (and the drops one per phase), so a drafter can switch groups on and off.
// Dashed lines are drawn as dash segments, so no linetype table is needed. Drawing units are the
// diagram's pixels (1 unit = 1 px); the y axis is flipped (DXF y points up).

const LAYERS = {
  source: { name: 'HV_SOURCE', aci: 7 }, transformer: { name: 'TRANSFORMER', aci: 7 }, busbar: { name: 'LV_BUSBAR', aci: 7 },
  fuse: { name: 'FUSE', aci: 1 }, span: { name: 'SPAN', aci: 4 }, pole: { name: 'POLE', aci: 7 }, dropbus: { name: 'SERVICE', aci: 8 },
  zone: { name: 'SERVICE', aci: 8 }, info: { name: 'ANNOTATION', aci: 8 }, openPoint: { name: 'OPEN_POINT', aci: 8 },
  move: { name: 'CHANGES', aci: 6 }, ghost: { name: 'CHANGES', aci: 6 },
  dropA: { name: 'DROP_A', aci: 30 }, dropB: { name: 'DROP_B', aci: 5 }, dropC: { name: 'DROP_C', aci: 3 }, drop3: { name: 'DROP_3PH', aci: 7 },
  earth: { name: 'EARTH', aci: 8 }
};

const f = (v) => (Math.round(v * 1000) / 1000).toString();

function layerOf(e) {
  if (e.type === 'drop') return e.ref.phase === 'A' ? LAYERS.dropA : e.ref.phase === 'B' ? LAYERS.dropB : e.ref.phase === 'C' ? LAYERS.dropC : LAYERS.drop3;
  return LAYERS[e.type] || { name: 'MISC', aci: 7 };
}

// DXF TEXT can't carry these glyphs reliably in R12; spell them out.
const ascii = (s) => String(s).replace(/φ/g, 'ph').replace(/Ω/g, 'ohm').replace(/→/g, '->').replace(/✓/g, 'OK').replace(/✗/g, 'X').replace(/·/g, '-').replace(/∞/g, 'inf').replace(/[^\x20-\x7E]/g, '?');

/** @param {any} scene @returns {string} */
export function sceneToDxf(scene) {
  const H = scene.height;
  const out = [];
  const g = (code, value) => { out.push(String(code), String(value)); };
  const Y = (y) => f(H - y);
  const line = (layer, x1, y1, x2, y2) => { g(0, 'LINE'); g(8, layer); g(10, f(x1)); g(20, Y(y1)); g(30, 0); g(11, f(x2)); g(21, Y(y2)); g(31, 0); };
  const dashed = (layer, x1, y1, x2, y2, dash) => {
    const len = Math.hypot(x2 - x1, y2 - y1); if (len === 0) return;
    const [on, off] = dash; const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    for (let s = 0; s < len; s += on + off) { const e = Math.min(s + on, len); line(layer, x1 + ux * s, y1 + uy * s, x1 + ux * e, y1 + uy * e); }
  };
  const seg = (layer, x1, y1, x2, y2, dash) => (dash ? dashed(layer, x1, y1, x2, y2, dash) : line(layer, x1, y1, x2, y2));

  const usedLayers = new Map();
  // Entities are generated first so the LAYER table can list exactly the layers in use.
  scene.elements.forEach(e => {
    const L = layerOf(e);
    usedLayers.set(L.name, L.aci);
    e.prims.forEach(p => {
      switch (p.k) {
        case 'line': seg(L.name, p.x1, p.y1, p.x2, p.y2, p.dash); break;
        case 'polyline': for (let i = 1; i < p.points.length; i++) seg(L.name, ...p.points[i - 1], ...p.points[i], p.dash); break;
        case 'polygon': p.points.forEach((pt, i) => { const q = p.points[(i + 1) % p.points.length]; line(L.name, pt[0], pt[1], q[0], q[1]); }); break;
        case 'rect': [[p.x, p.y, p.x + p.w, p.y], [p.x + p.w, p.y, p.x + p.w, p.y + p.h], [p.x + p.w, p.y + p.h, p.x, p.y + p.h], [p.x, p.y + p.h, p.x, p.y]].forEach(s => seg(L.name, s[0], s[1], s[2], s[3], p.dash)); break;
        case 'circle':
          if (p.dash) { for (let a = 0; a < 360; a += 30) { g(0, 'ARC'); g(8, L.name); g(10, f(p.cx)); g(20, Y(p.cy)); g(30, 0); g(40, f(p.r)); g(50, a); g(51, a + 18); } }
          else { g(0, 'CIRCLE'); g(8, L.name); g(10, f(p.cx)); g(20, Y(p.cy)); g(30, 0); g(40, f(p.r)); }
          break;
        case 'arc': g(0, 'ARC'); g(8, L.name); g(10, f(p.cx)); g(20, Y(p.cy)); g(30, 0); g(40, f(p.r)); g(50, f(p.start)); g(51, f(p.end)); break;
        case 'text': {
          const just = p.anchor === 'middle' ? 1 : p.anchor === 'end' ? 2 : 0;
          g(0, 'TEXT'); g(8, L.name); g(10, f(p.x)); g(20, Y(p.y)); g(30, 0); g(40, f(p.size * 0.75)); g(1, ascii(p.text));
          if (just) { g(72, just); g(11, f(p.x)); g(21, Y(p.y)); g(31, 0); }
          break;
        }
        default: break;
      }
    });
  });
  // (Moved out with splice and joined with concat: spreading a big drawing's codes into push()
  // could exceed the engine's argument limit.)
  const entities = out.splice(0);

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$EXTMIN'); g(10, 0); g(20, 0); g(30, 0); g(9, '$EXTMAX'); g(10, f(scene.width)); g(20, f(H)); g(30, 0); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1); g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0); g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, usedLayers.size);
  usedLayers.forEach((aci, name) => { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, aci); g(6, 'CONTINUOUS'); });
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  return out.concat(entities, ['0', 'ENDSEC', '0', 'EOF']).join('\r\n') + '\r\n';
}
