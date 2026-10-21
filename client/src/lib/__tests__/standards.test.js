import { describe, it, expect } from 'vitest';
import {
  BUILTIN_STANDARDS_PROFILES, STANDARDS_DEFAULTS, standardsOf, applyStandardsProfile, profileFromDesign, matchesProfile,
  runSnapshot, scanAndSummarize, withDefaults, defaultDesign, protectionCheck, runDailyScan
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P2.7 — standards profiles.

const NIGHT = { year: 0, hour: 20, solarMult: 0 };
const appDefaults = BUILTIN_STANDARDS_PROFILES.find(p => p.id === 'app-defaults');

describe('the "Current app defaults" profile reproduces today exactly', () => {
  it('matches a new design and a fixture design', () => {
    expect(matchesProfile(defaultDesign(), appDefaults)).toBe(true);
    expect(matchesProfile(walkthroughIsland(), appDefaults)).toBe(true);
    // txLimitBothDirections (O3.5) is reported by standardsOf but not stored by default: absent means the import-only rule.
    expect(standardsOf(defaultDesign())).toEqual({ ...STANDARDS_DEFAULTS, vnom: 230, vdevPct: 6, txLimitBothDirections: false });
  });

  it('applying it changes no result (bit-identical snapshot and scan)', () => {
    const d = walkthroughIsland();
    const applied = applyStandardsProfile(d, appDefaults);
    expect(runSnapshot(applied, NIGHT)).toEqual(runSnapshot(d, NIGHT));
    expect(scanAndSummarize(applied)).toEqual(scanAndSummarize(d));
  });

  it('a design with no standards at all behaves exactly as the defaults', () => {
    const { standards, ...bare } = walkthroughIsland();
    expect(runSnapshot(bare, NIGHT)).toEqual(runSnapshot(walkthroughIsland(), NIGHT));
    expect(withDefaults(bare).standards).toEqual(STANDARDS_DEFAULTS);
  });
});

describe('profile limits drive the checks', () => {
  it('a lower cable loading limit raises thermal violations (P1 A carries ~60 % of 203 A at 20:00)', () => {
    const d = walkthroughIsland();
    d.standards = { ...d.standards, cableLoadingLimitPct: 50 };
    const r = runSnapshot(d, NIGHT);
    const thermal = r.violations.filter(v => v.type === 'thermal');
    expect(thermal.map(v => v.pole + v.phase)).toContain('P1A');
    thermal.forEach(v => expect(v.value).toBeGreaterThan(50));
  });

  it('a lower transformer loading limit raises an overload while importing (TX at 38.97 %)', () => {
    const d = walkthroughIsland();
    d.standards = { ...d.standards, txLoadingLimitPct: 30 };
    expect(runSnapshot(d, NIGHT).violations.find(v => v.type === 'transformer overload')).toMatchObject({ pole: 'TX' });
  });

  it('EN 50160 profile: ±10 % band and VUF counted', () => {
    const en = BUILTIN_STANDARDS_PROFILES.find(p => p.id === 'en50160');
    const d = applyStandardsProfile(walkthroughIsland(), en);
    expect(d.vdev).toBe(10);
    expect(d.standards).toMatchObject({ profileName: 'EN 50160 supply voltage', vufAsViolation: true, vufLimitPct: 2 });
    const r = runSnapshot(d, NIGHT);
    expect(r.vLimLow).toBeCloseTo(207, 9);
    expect(r.violations).toEqual([]); // 212.86 V is inside 207–253 V; P3 VUF 1.70 % < 2 %
  });

  it('the protection check takes its disconnection time from the standards', () => {
    const d = withDefaults(walkthroughIsland());
    d.standards = { ...d.standards, disconnectTimeS: 0.4 };
    expect(protectionCheck(d, runDailyScan(d, 0)).disconnectTimeS).toBe(0.4);
  });
});

describe('user profiles', () => {
  it('a design\'s current limits round-trip through a saved profile', () => {
    const d = walkthroughIsland();
    d.vdev = 8;
    d.standards = { ...d.standards, cableLoadingLimitPct: 90, vufAsViolation: true };
    const p = profileFromDesign(d, 'My utility 2026');
    expect(p).toMatchObject({ id: 'user-my-utility-2026', name: 'My utility 2026', vdevPct: 8, cableLoadingLimitPct: 90, vufAsViolation: true });
    const back = applyStandardsProfile(walkthroughIsland(), p);
    expect(matchesProfile(back, p)).toBe(true);
    expect(back.standards.profileName).toBe('My utility 2026');
  });

  it('only sourced profiles ship with the app', () => {
    BUILTIN_STANDARDS_PROFILES.forEach(p => expect(p.source.length).toBeGreaterThan(20));
    expect(BUILTIN_STANDARDS_PROFILES.map(p => p.id)).toEqual(['app-defaults', 'en50160']);
  });
});
