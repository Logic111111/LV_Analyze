import { useEffect, useMemo, useRef, useState } from 'react';
import { SLD_PALETTES, SLD_FONT } from '../lib/sld/svg.js';
import { elementBounds } from '../lib/sld/scene.js';

// Single-line diagram view (P5.1): renders a scene from lib/sld/scene.js as live SVG.
//   - Every element is a keyboard-focusable button (Tab, then Enter/Space selects it) with an
//     aria-label; the side panel is the page's.
//   - Zoom (buttons, Ctrl/⌘ + wheel), fit-to-width, 100 %. The drawing scrolls inside its own frame,
//     so a long feeder never widens the page; drag the background to pan.
//   - Drag-to-rephase (P5.2): a single-phase drop can be dragged onto another phase group of the
//     same pole. `onDragOver(ref, phase|null)` fires while hovering (for an instant preview), and
//     `onDropMove(ref, phase)` on release. Keyboard users get the same moves from the side panel.
const FOCUSABLE = new Set(['source', 'transformer', 'busbar', 'fuse', 'span', 'pole', 'drop', 'openPoint']);

function Prim({ p, pal }) {
  const stroke = pal[p.color] || p.color || pal.line;
  const fill = p.fill ? (pal[p.fill] || p.fill) : 'none';
  const dash = p.dash ? p.dash.join(',') : undefined;
  switch (p.k) {
    case 'line': return <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={stroke} strokeWidth={p.width || 1} strokeDasharray={dash} />;
    case 'polyline': return <polyline points={p.points.map(q => q.join(',')).join(' ')} fill="none" stroke={stroke} strokeWidth={p.width || 1} strokeDasharray={dash} strokeLinejoin="round" />;
    case 'polygon': return <polygon points={p.points.map(q => q.join(',')).join(' ')} fill={fill} stroke={stroke} strokeWidth={p.width || 0.8} />;
    case 'rect': return <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={fill} stroke={stroke} strokeWidth={p.width || 1} strokeDasharray={dash} />;
    case 'circle': return <circle cx={p.cx} cy={p.cy} r={p.r} fill={fill} stroke={stroke} strokeWidth={p.width || 1} strokeDasharray={dash} />;
    case 'text': return <text x={p.x} y={p.y} fontSize={p.size} textAnchor={p.anchor || 'start'} fill={stroke} fontWeight={p.weight}>{p.text}</text>;
    default: return null;
  }
}

export default function SingleLineDiagram({ scene, theme = 'light', selectedId, onSelect, onDropMove, onDragOver, maxHeight = '72vh', label = 'Single-line diagram' }) {
  const pal = SLD_PALETTES[theme] || SLD_PALETTES.light;
  const frameRef = useRef(null);
  const svgRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState(null); // { el, x, y, over }
  const pan = useRef(null);

  const zones = useMemo(() => scene.elements.filter(e => e.type === 'zone'), [scene]);
  const selected = selectedId ? scene.elements.find(e => e.id === selectedId) : null;
  const selBox = selected ? elementBounds(selected) : null;

  const fitScale = () => (frameRef.current ? frameRef.current.clientWidth - 4 : scene.width) / scene.width;
  function fit() { setScale(Math.max(0.2, Math.min(2, fitScale()))); }
  // Start at a readable size once per drawing: fitted to the width, but never below 85 % (the
  // drop labels are 7.5 px), so a long feeder scrolls inside the frame instead of shrinking away.
  useEffect(() => { setScale(Math.max(0.85, Math.min(1.25, fitScale()))); }, [scene.width]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setScale(s => Math.max(0.2, Math.min(4, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toSvg = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };
  const zoneAt = (el, pt) => zones.find(z => z.ref.pole === el.ref.pole && z.ref.phase !== 'ABC' &&
    pt.x >= z.zone.x && pt.x <= z.zone.x + z.zone.w && pt.y >= z.zone.y && pt.y <= z.zone.y + z.zone.h);

  function onPointerDown(e, el) {
    if (el && el.draggable && onDropMove && e.button === 0) {
      // No native text selection: it would auto-scroll the frame under the pointer mid-drag.
      e.preventDefault();
      e.stopPropagation();
      const pt = toSvg(e);
      setDrag({ el, x: pt.x, y: pt.y, over: null, moved: false });
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (!el && e.button === 0) { e.preventDefault(); pan.current = { x: e.clientX, y: e.clientY, l: frameRef.current.scrollLeft, t: frameRef.current.scrollTop }; }
  }
  function onPointerMove(e) {
    if (drag) {
      const pt = toSvg(e);
      const z = zoneAt(drag.el, pt);
      const over = z && z.ref.phase !== drag.el.ref.phase ? z.ref.phase : null;
      if (over !== drag.over && onDragOver) onDragOver(drag.el.ref, over);
      setDrag(d => ({ ...d, x: pt.x, y: pt.y, over, moved: true }));
    } else if (pan.current) {
      frameRef.current.scrollLeft = pan.current.l - (e.clientX - pan.current.x);
      frameRef.current.scrollTop = pan.current.t - (e.clientY - pan.current.y);
    }
  }
  function onPointerUp() {
    if (drag) {
      if (drag.over && onDropMove) onDropMove(drag.el.ref, drag.over);
      else if (!drag.moved && onSelect) onSelect(drag.el);
      if (onDragOver) onDragOver(drag.el.ref, null);
      setDrag(null);
    }
    pan.current = null;
  }

  return (
    <div>
      <div className="sld-toolbar" role="toolbar" aria-label="Diagram zoom">
        <button type="button" className="mini" onClick={() => setScale(s => Math.min(4, s * 1.25))} aria-label="Zoom in">＋</button>
        <button type="button" className="mini" onClick={() => setScale(s => Math.max(0.2, s / 1.25))} aria-label="Zoom out">−</button>
        <button type="button" className="mini" onClick={fit}>Fit</button>
        <button type="button" className="mini" onClick={() => setScale(1)}>100 %</button>
        <span className="hint" style={{ margin: 0 }}>{Math.round(scale * 100)} % · Ctrl/⌘ + wheel to zoom · drag the background to pan{onDropMove ? ' · drag a drop to another phase to rephase it' : ''}</span>
      </div>
      <div ref={frameRef} className="sld-frame" style={{ maxHeight, cursor: pan.current ? 'grabbing' : 'default' }}
        onPointerDown={(e) => onPointerDown(e, null)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
        <svg ref={svgRef} role="group" aria-label={label} width={scene.width * scale} height={scene.height * scale}
          viewBox={`0 0 ${scene.width} ${scene.height}`} fontFamily={SLD_FONT} style={{ display: 'block', background: pal.bg, touchAction: drag ? 'none' : 'auto', userSelect: 'none', WebkitUserSelect: 'none' }}>
          {drag && zones.filter(z => z.ref.pole === drag.el.ref.pole && z.ref.phase !== 'ABC' && z.ref.phase !== drag.el.ref.phase).map(z => (
            <rect key={z.id} x={z.zone.x - 2} y={z.zone.y} width={z.zone.w + 2} height={z.zone.h} fill={drag.over === z.ref.phase ? pal.accent : pal[`phase${z.ref.phase}`]} opacity={drag.over === z.ref.phase ? 0.22 : 0.08} />
          ))}
          {scene.elements.map(e => {
            const focusable = FOCUSABLE.has(e.type) && onSelect;
            return (
              <g key={e.id} data-id={e.id}
                tabIndex={focusable ? 0 : undefined} role={focusable ? 'button' : undefined} aria-label={focusable ? e.label : undefined}
                aria-pressed={focusable ? selectedId === e.id : undefined}
                className={focusable ? 'sld-el' : undefined}
                style={{ cursor: e.draggable && onDropMove ? 'grab' : focusable ? 'pointer' : undefined, opacity: drag && drag.el.id === e.id ? 0.35 : 1 }}
                onPointerDown={focusable ? (ev) => { if (e.draggable && onDropMove) onPointerDown(ev, e); else ev.stopPropagation(); } : undefined}
                onClick={focusable && !(e.draggable && onDropMove) ? () => onSelect(e) : undefined}
                onKeyDown={focusable ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onSelect(e); } } : undefined}>
                {focusable && (() => { const b = elementBounds(e); return <rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} fill="transparent" />; })()}
                {e.prims.map((p, i) => <Prim key={i} p={p} pal={pal} />)}
              </g>
            );
          })}
          {selBox && <rect x={selBox.x - 4} y={selBox.y - 4} width={selBox.w + 8} height={selBox.h + 8} fill="none" stroke={pal.accent} strokeWidth={1.5} strokeDasharray="4,3" pointerEvents="none" />}
          {drag && drag.moved && (
            <text x={drag.x + 8} y={drag.y - 6} fontSize={9} fill={pal.accent} fontWeight={700} pointerEvents="none">
              {drag.el.ref.id} {drag.over ? `→ ${drag.over}` : `(${drag.el.ref.phase})`}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
