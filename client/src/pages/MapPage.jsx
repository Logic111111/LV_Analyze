import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDesign } from '../context/DesignContext.jsx';
import { measuredSpans, acceptMeasuredSpans, hasCoords, haversineM, usableConductorCodes } from '../lib/loadflow.js';
import { useT } from '../i18n/i18n.jsx';

// Map-based network editor (P5.7). Leaflet's own API (BSD-2) in a small React wrapper:
// react-leaflet, which the brief names, is under the Hippocratic License 2.1 (not OSI-approved,
// with use restrictions), so it was left out; see PROGRESS.md open questions.
//
// Positions (lat/lng) are optional on transformers and poles and never change a result. Span
// lengths stay the entered ones; the haversine length is offered in the "measured vs entered"
// table and applied only when accepted. The table editor on the Network page edits the same
// design, and is the keyboard route for everything here (plus the coordinate fields below).
// Tiles: OpenStreetMap by default, interactive use only (as its tile usage policy requires), with
// attribution; the tile server is configurable.
const MODES = [
  ['select', 'Select / drag to move'],
  ['place', 'Place the selected item'],
  ['add', 'Add a pole (fed from the selected item)'],
  ['connect', 'Connect: click the new parent for the selected pole']
];
const PHASE_CLASS = { A: 'phaseA', B: 'phaseB', C: 'phaseC' };
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function nextPoleId(design) {
  const used = new Set(design.poles.map(p => p.id));
  let n = design.poles.reduce((m, p) => { const k = /^P(\d+)$/.exec(p.id); return k ? Math.max(m, Number(k[1])) : m; }, 0) + 1;
  while (used.has('P' + n)) n++;
  return 'P' + n;
}
// A pole can't be fed from itself or from anything downstream of it.
function isDescendant(design, ancestor, id) {
  let cur = id;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === ancestor) return true;
    seen.add(cur);
    const p = design.poles.find(x => x.id === cur);
    cur = p ? p.parent : null;
  }
  return false;
}

export default function MapPage() {
  const { design, setDesign } = useDesign();
  const t = useT();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const tileRef = useRef(null);
  const [mode, setMode] = useState('select');
  const [selected, setSelected] = useState(design.transformers[0]?.id || null);
  const [msg, setMsg] = useState('');
  const [tileDraft, setTileDraft] = useState({ tileUrl: design.map?.tileUrl || '', attribution: design.map?.attribution || '' });
  // Handlers read the latest state through a ref (Leaflet keeps the listeners it was given).
  const live = useRef({});
  live.current = { design, mode, selected };

  const nodes = useMemo(() => [...design.transformers.map(t => ({ kind: 'tx', item: t })), ...design.poles.map(p => ({ kind: 'pole', item: p }))], [design]);
  const placed = nodes.filter(n => hasCoords(n.item));
  const spans = useMemo(() => measuredSpans(design), [design]);
  const sel = nodes.find(n => n.item.id === selected);

  const setCoords = (id, lat, lng) => setDesign(d => ({
    ...d,
    transformers: d.transformers.map(t => (t.id === id ? { ...t, lat, lng } : t)),
    poles: d.poles.map(p => (p.id === id ? { ...p, lat, lng } : p))
  }));

  function onMapClick(e) {
    const { design: d, mode: m, selected: s } = live.current;
    const lat = Number(e.latlng.lat.toFixed(7)), lng = Number(e.latlng.lng.toFixed(7));
    if (m === 'place') {
      if (!s) { setMsg('Select a transformer or pole first (list on the right).'); return; }
      setCoords(s, lat, lng); setMsg(`Placed ${s}.`);
    } else if (m === 'add') {
      const parent = d.transformers.find(t => t.id === s) || d.poles.find(p => p.id === s);
      if (!parent) { setMsg('Select the transformer or pole the new pole is fed from.'); return; }
      const id = nextPoleId(d);
      const isTx = !!d.transformers.find(t => t.id === s);
      const conds = usableConductorCodes(d);
      const spanM = hasCoords(parent) ? Math.round(haversineM(Number(parent.lat), Number(parent.lng), lat, lng) * 10) / 10 : 30;
      const pole = { id, feeder: isTx ? 'F1' : parent.feeder, parent: s, spanM, cond: isTx ? (conds.includes('70ABC') ? '70ABC' : conds[0]) : parent.cond, grounded: false, groundOhms: 20, lat, lng };
      setDesign(dd => ({ ...dd, poles: [...dd.poles, pole] }));
      setSelected(id);
      setMsg(`Added ${id}, fed from ${s} (${spanM} m${hasCoords(parent) ? ', measured' : ' — parent not placed, default length'}).`);
    }
  }
  function onNodeClick(id) {
    const { design: d, mode: m, selected: s } = live.current;
    if (m === 'connect' && s && s !== id) {
      const child = d.poles.find(p => p.id === s);
      if (!child) { setMsg('Select a pole (not a transformer) to re-connect.'); return; }
      if (isDescendant(d, s, id)) { setMsg(`${id} is downstream of ${s} — that would make a loop.`); return; }
      setDesign(dd => ({ ...dd, poles: dd.poles.map(p => (p.id === s ? { ...p, parent: id, feeder: dd.transformers.some(t => t.id === id) ? p.feeder : (dd.poles.find(x => x.id === id) || p).feeder } : p)) }));
      setMsg(`${s} is now fed from ${id}. Check its span length in the table below.`);
      return;
    }
    setSelected(id);
  }

  // Map and tile layer, once.
  useEffect(() => {
    const m = L.map(mapEl.current, { zoomControl: true, keyboard: true });
    mapRef.current = m;
    layersRef.current = L.layerGroup().addTo(m);
    const s = live.current.design.map || {};
    tileRef.current = L.tileLayer(s.tileUrl, { attribution: s.attribution, maxZoom: s.maxZoom || 19 }).addTo(m);
    const pts = live.current.design.poles.concat(live.current.design.transformers).filter(hasCoords).map(n => [Number(n.lat), Number(n.lng)]);
    if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 18 }); else m.setView([s.centerLat ?? 7.8731, s.centerLng ?? 80.7718], s.zoom ?? 8);
    m.on('click', onMapClick);
    return () => { m.remove(); mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tile server changes.
  useEffect(() => {
    if (!mapRef.current || !design.map) return;
    tileRef.current.setUrl(design.map.tileUrl);
    mapRef.current.attributionControl.removeAttribution(tileRef.current.getAttribution?.() || '');
    tileRef.current.options.attribution = design.map.attribution;
    mapRef.current.attributionControl.addAttribution(design.map.attribution);
  }, [design.map?.tileUrl, design.map?.attribution]); // eslint-disable-line react-hooks/exhaustive-deps

  // Network layers, redrawn on every change.
  useEffect(() => {
    const g = layersRef.current;
    if (!g) return;
    g.clearLayers();
    const pos = new Map(nodes.filter(n => hasCoords(n.item)).map(n => [n.item.id, [Number(n.item.lat), Number(n.item.lng)]]));
    design.poles.forEach(p => {
      if (pos.has(p.id) && pos.has(p.parent)) {
        L.polyline([pos.get(p.parent), pos.get(p.id)], { color: '#2563EB', weight: 3 }).bindTooltip(`${p.parent} → ${p.id}: ${p.spanM} m entered, ${p.cond}`).addTo(g);
      }
    });
    (design.openPoints || []).forEach(o => {
      if (pos.has(o.poleA) && pos.has(o.poleB)) L.polyline([pos.get(o.poleA), pos.get(o.poleB)], { color: '#64748B', weight: 2, dashArray: '6 5' }).bindTooltip(`Open point ${o.id}`).addTo(g);
    });
    nodes.forEach(({ kind, item }) => {
      if (!pos.has(item.id)) return;
      const isSel = item.id === selected;
      const html = kind === 'tx'
        ? `<div class="map-node map-tx${isSel ? ' sel' : ''}">${esc(item.name || item.id)}</div>`
        : `<div class="map-node map-pole${isSel ? ' sel' : ''}">${esc(item.id)}</div>`;
      const mk = L.marker(pos.get(item.id), {
        icon: L.divIcon({ html, className: 'map-icon', iconSize: null, iconAnchor: kind === 'tx' ? [18, 12] : [14, 10] }),
        draggable: mode === 'select', keyboard: true, title: `${kind === 'tx' ? 'Transformer' : 'Pole'} ${item.id}`, riseOnHover: true
      }).addTo(g);
      mk.on('click', (ev) => { L.DomEvent.stopPropagation(ev); onNodeClick(item.id); });
      mk.on('dragend', () => { const ll = mk.getLatLng(); setCoords(item.id, Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))); setMsg(`Moved ${item.id}. Span lengths are unchanged until you accept the measured ones.`); });
      if (kind === 'pole') {
        // Customers as phase-labelled markers just below the pole: one letter per connection.
        const conns = [...design.loads.filter(c => c.pole === item.id).map(c => ({ ph: c.phase, t: c.type === 'ev' ? 'EV' : '' })),
          ...design.pv.filter(c => c.pole === item.id).map(c => ({ ph: c.phase, t: 'PV' })), ...design.bess.filter(c => c.pole === item.id).map(c => ({ ph: c.phase, t: 'B' }))];
        if (conns.length) {
          const chips = conns.map(c => `<span class="map-cust ${PHASE_CLASS[c.ph] || ''}" title="${esc(c.t || 'load')} on ${esc(c.ph)}">${esc(c.ph === 'ABC' ? '3φ' : c.ph)}${c.t ? '<sub>' + esc(c.t) + '</sub>' : ''}</span>`).join('');
          L.marker(pos.get(item.id), { icon: L.divIcon({ html: `<div class="map-custs">${chips}</div>`, className: 'map-icon', iconSize: null, iconAnchor: [-2, -12] }), interactive: false, keyboard: false }).addTo(g);
        }
      }
    });
  }, [design, nodes, selected, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  function fit() {
    const pts = placed.map(n => [Number(n.item.lat), Number(n.item.lng)]);
    if (pts.length && mapRef.current) mapRef.current.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 18 });
  }
  function saveTiles() {
    if (!/\{z\}/.test(tileDraft.tileUrl) || !/\{x\}/.test(tileDraft.tileUrl) || !/\{y\}/.test(tileDraft.tileUrl)) { setMsg('The tile URL needs {z}, {x} and {y} placeholders.'); return; }
    if (!tileDraft.attribution.trim()) { setMsg('Tile servers require attribution — enter it.'); return; }
    setDesign(d => ({ ...d, map: { ...(d.map || {}), tileUrl: tileDraft.tileUrl.trim(), attribution: tileDraft.attribution.trim() } }));
    setMsg('Tile server saved.');
  }
  const bigDiffs = spans.filter(s => Math.abs(s.diffM) >= 0.5);

  return (
    <div>
      <div className="card">
        <h2>{t('Map')}</h2>
        <p className="hint">Optional positions for the transformer and poles. Positions never change a result: span lengths stay as entered, and the measured (great-circle) length is only applied when you accept it below. Everything here can also be done in the Network table.</p>
        <div role="radiogroup" aria-label="Map mode" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {MODES.map(([k, label]) => <label key={k} className="chk"><input type="radio" name="mapMode" checked={mode === k} onChange={() => setMode(k)} /> {label}</label>)}
        </div>
        {msg && <p className="hint" role="status" style={{ marginBottom: 0 }}>{msg}</p>}
      </div>

      <div className="sld-layout" style={{ marginTop: 14 }}>
        <div className="card" style={{ padding: 8 }}>
          <div ref={mapEl} className="map-frame" role="application" aria-label="Network map" />
          <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="mini" onClick={fit} disabled={!placed.length}>Fit to network</button>
            <span className="hint" style={{ margin: 0 }}>{placed.length} of {nodes.length} items placed.</span>
          </div>
        </div>
        <div className="card sld-panel">
          <h3>Items</h3>
          <label className="field"><span>Selected</span>
            <select value={selected || ''} onChange={e => setSelected(e.target.value)}>
              {nodes.map(n => <option key={n.item.id} value={n.item.id}>{n.kind === 'tx' ? 'Transformer ' : 'Pole '}{n.item.id}{hasCoords(n.item) ? '' : ' (not placed)'}</option>)}
            </select></label>
          {sel && (
            <div className="grid g2">
              <label className="field"><span>Latitude</span><input type="number" step="0.00001" value={sel.item.lat ?? ''} onChange={e => setCoords(sel.item.id, e.target.value === '' ? null : Number(e.target.value), sel.item.lng ?? null)} /></label>
              <label className="field"><span>Longitude</span><input type="number" step="0.00001" value={sel.item.lng ?? ''} onChange={e => setCoords(sel.item.id, sel.item.lat ?? null, e.target.value === '' ? null : Number(e.target.value))} /></label>
            </div>
          )}
          {sel && hasCoords(sel.item) && <button className="mini" onClick={() => setCoords(sel.item.id, null, null)}>Remove position</button>}
          <h3 style={{ marginTop: 14 }}>Tile server</h3>
          <label className="field"><span>URL template</span><input value={tileDraft.tileUrl} onChange={e => setTileDraft(t => ({ ...t, tileUrl: e.target.value }))} /></label>
          <label className="field"><span>Attribution</span><input value={tileDraft.attribution} onChange={e => setTileDraft(t => ({ ...t, attribution: e.target.value }))} /></label>
          <button className="mini" onClick={saveTiles}>Save tile server</button>
          <p className="hint">OpenStreetMap's public tiles are for interactive use only (no bulk downloading), with attribution. For heavy use, point this at your own or a commercial tile server.</p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Measured vs entered span lengths</h2>
        {!spans.length ? <p className="hint">Place a pole and its parent to compare.</p> : (
          <>
            <div className="tbl-wrap"><table>
              <thead><tr><th scope="col">Span</th><th scope="col">Entered (m)</th><th scope="col">Measured (m)</th><th scope="col">Difference</th><th></th></tr></thead>
              <tbody>{spans.map(s => (
                <tr key={s.pole}>
                  <td>{s.parent} → {s.pole}</td><td>{s.enteredM.toFixed(1)}</td><td>{s.measuredM.toFixed(1)}</td>
                  <td style={{ fontWeight: Math.abs(s.diffPct ?? 0) > 10 ? 700 : 400 }}>{(s.diffM >= 0 ? '+' : '') + s.diffM.toFixed(1)} m{s.diffPct != null ? ` (${(s.diffPct >= 0 ? '+' : '') + s.diffPct.toFixed(0)} %)` : ''}{Math.abs(s.diffPct ?? 0) > 10 ? ' ⚠' : ''}</td>
                  <td>{Math.abs(s.diffM) >= 0.05 && <button className="mini" onClick={() => {
                    // A wildly different length usually means a mis-placed marker, not a wrong entry.
                    if (Math.abs(s.diffPct ?? 0) > 100 && !window.confirm(`The measured length (${s.measuredM.toFixed(1)} m) is very different from the entered ${s.enteredM.toFixed(1)} m — check the markers. Use it anyway?`)) return;
                    setDesign(d => acceptMeasuredSpans(d, [s.pole]));
                  }}>Use measured</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {bigDiffs.length > 1 && <button className="ghost" style={{ marginTop: 8 }} onClick={() => setDesign(d => acceptMeasuredSpans(d, bigDiffs.map(s => s.pole)))}>Use measured for all {bigDiffs.length}</button>}
            <p className="hint">⚠ = differs by more than 10 %. Measured = great-circle (haversine) distance between the two positions; a real span may sag or route around obstacles, so check before accepting.</p>
          </>
        )}
      </div>
    </div>
  );
}
