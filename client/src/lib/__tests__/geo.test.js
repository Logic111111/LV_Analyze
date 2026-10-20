import { describe, it, expect } from 'vitest';
import { haversineM, measuredSpans, acceptMeasuredSpans, hasCoords, runSnapshot, withDefaults, EARTH_RADIUS_M } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P5.7 — map editor geometry.

describe('haversine', () => {
  it('one degree of latitude is πR/180', () => {
    expect(haversineM(6, 80, 7, 80)).toBeCloseTo(Math.PI * EARTH_RADIUS_M / 180, 6);
  });
  it('a short east-west span near Colombo matches the flat-earth estimate', () => {
    const lat = 6.9271, dLng = 0.0005;
    const flat = dLng * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(lat * Math.PI / 180);
    expect(haversineM(lat, 79.8612, lat, 79.8612 + dLng)).toBeCloseTo(flat, 3);
    expect(haversineM(lat, 79.8612, lat, 79.8612)).toBe(0);
  });
});

describe('measured vs entered spans', () => {
  // P1 placed 40 m (entered) north of the transformer, P2 ~70 m (entered 60 m) further north.
  const mPerDegLat = Math.PI * EARTH_RADIUS_M / 180;
  const withCoords = () => {
    const d = walkthroughIsland();
    d.transformers = d.transformers.map(t => ({ ...t, lat: 6.9, lng: 79.9 }));
    d.poles = d.poles.map(p => (p.id === 'P1' ? { ...p, lat: 6.9 + 40 / mPerDegLat, lng: 79.9 }
      : p.id === 'P2' ? { ...p, lat: 6.9 + 110 / mPerDegLat, lng: 79.9 } : p));
    return d;
  };

  it('lists spans with both ends placed, with the difference', () => {
    const s = measuredSpans(withCoords());
    expect(s.map(x => x.pole)).toEqual(['P1', 'P2']);
    expect(s[0].measuredM).toBeCloseTo(40, 6);
    expect(s[1].measuredM).toBeCloseTo(70, 6);
    expect(s[1].diffM).toBeCloseTo(10, 6);
    expect(s[1].diffPct).toBeCloseTo(100 / 6, 6);
  });

  it('applies the measured length only when accepted, rounded to 0.1 m', () => {
    const d = withCoords();
    expect(d.poles.find(p => p.id === 'P2').spanM).toBe(60);
    const a = acceptMeasuredSpans(d, ['P2']);
    expect(a.poles.find(p => p.id === 'P2').spanM).toBe(70);
    expect(a.poles.find(p => p.id === 'P1').spanM).toBe(d.poles.find(p => p.id === 'P1').spanM);
  });

  it('coordinates alone never change results', () => {
    const plain = walkthroughIsland();
    expect(runSnapshot(withCoords(), { year: 0, hour: 20, solarMult: 0 })).toEqual(runSnapshot(plain, { year: 0, hour: 20, solarMult: 0 }));
  });

  it('old designs get map defaults (OpenStreetMap, attribution) and no coordinates', () => {
    const d = withDefaults(walkthroughIsland());
    expect(d.map.tileUrl).toContain('openstreetmap');
    expect(d.map.attribution).toMatch(/OpenStreetMap/);
    expect(d.poles.some(hasCoords)).toBe(false);
  });
});
