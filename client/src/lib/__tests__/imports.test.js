import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as loadflow from '../loadflow.js';
import * as diagram from '../diagram.js';
import * as report from '../report.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// Public-API guard (brief rule 4): every named import any page, component, context or lib module
// takes from loadflow.js / diagram.js / report.js must still be exported. Read straight from the
// source files, so a new page import is covered automatically and a refactor that drops or renames
// an export fails here instead of at runtime in the browser.

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const MODULES = { loadflow, diagram, report };

function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.(js|jsx)$/.test(name) ? [full] : [];
  });
}

function namedImports() {
  const out = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  sourceFiles(SRC).forEach(file => {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const mod = (m[2].match(/(?:^|\/)(loadflow|diagram|report)\.js$/) || [])[1];
      if (!mod) continue;
      m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
        .forEach(name => out.push({ file: relative(SRC, file).replace(/\\/g, '/'), mod, name }));
    }
  });
  return out;
}

describe('public import surface', () => {
  const imports = namedImports();

  it('finds the page imports (sanity check on the scanner itself)', () => {
    expect(imports.length).toBeGreaterThan(40);
    expect(imports.some(i => i.file === 'pages/FeederSplitPage.jsx' && i.name === 'scoreDualFeederCandidate')).toBe(true);
  });

  it('every named import from loadflow.js / diagram.js / report.js is still exported', () => {
    const missing = imports.filter(i => !(i.name in MODULES[i.mod])).map(i => `${i.file}: ${i.name} from ${i.mod}.js`);
    expect(missing).toEqual([]);
  });
});

describe('diagram and report builders still run on the fixture', () => {
  const d = walkthroughIsland();
  const res = loadflow.runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });

  it('buildDiagramSVG returns an SVG in both themes', () => {
    expect(diagram.buildDiagramSVG(d, res, 'light')).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(diagram.buildDiagramSVG(d, res, 'dark')).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it('buildReportHtml returns a complete HTML document', () => {
    const html = report.buildReportHtml(d, res, null, null, null);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('Walkthrough Island');
  });
});
