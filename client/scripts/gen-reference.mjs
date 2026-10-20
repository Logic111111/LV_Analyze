// Regenerates src/lib/__tests__/fixtures/reference.json — the full-precision regression lock.
//
// Run ONLY after a deliberate, documented change to engine results (see PROGRESS.md "Golden-value
// notes"). Never run it to make a failing reference.test.js pass: that test failing means the
// engine's numbers moved, which is exactly what it exists to catch.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REFERENCE_CASES, computeCase, caseLabel } from '../src/lib/__tests__/fixtures/referenceCases.js';

const out = REFERENCE_CASES.map(c => ({ label: caseLabel(c), result: computeCase(c) }));
const path = fileURLToPath(new URL('../src/lib/__tests__/fixtures/reference.json', import.meta.url));
writeFileSync(path, JSON.stringify(out, null, 1) + '\n');
console.log(`Wrote ${out.length} reference cases to ${path}`);
