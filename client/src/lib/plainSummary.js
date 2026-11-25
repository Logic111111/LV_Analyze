// Basic mode's "What this means" card: one snapshot result (runSnapshotAt) in plain words, each
// problem with the page that fixes it. Plain JS (no JSX) so it is unit-tested in Node.

const FIX_IT = { to: '/app/fix-it', linkLabel: 'Try the Fix-it Ladder' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const round = (x) => Math.round(x);

/** Distinct poles of a violation list and the one with the lowest (or highest) value. */
function poles(list, lowest) {
  const worst = list.reduce((w, x) => (lowest ? x.value < w.value : x.value > w.value) ? x : w);
  return { n: new Set(list.map(x => x.pole)).size, worst };
}

/**
 * @param {{ violations: { pole: string, phase: string, type: string, value: number }[], hour: number, transformers: { id: string, name: string }[], converged?: boolean, status?: string }} res
 * @returns {{ ok: boolean, lines: { text: string, to: string|null, linkLabel: string|null }[] }}
 */
export function plainSummary(res) {
  const at = String(res.hour).padStart(2, '0') + ':00';
  const of = (type) => res.violations.filter(x => x.type === type);
  const lines = [];

  // An unsolved snapshot must never read as "all good" (same cases as SolveStatusWarning).
  if (res.status === 'collapse') {
    lines.push({ text: `The network cannot supply this load at ${at} (voltage collapse). Reduce the load or strengthen the network.`, ...FIX_IT });
  } else if (res.converged === false) {
    lines.push({ text: `The calculation did not settle at ${at}, so these results may be wrong.`, to: null, linkLabel: null });
  }

  const low = of('undervoltage');
  if (low.length) {
    const { n, worst } = poles(low, true);
    lines.push({ text: `Voltage is too low at ${plural(n, 'pole', 'poles')} at ${at}. Worst: ${worst.pole} (${round(worst.value)} V).`, ...FIX_IT });
  }
  const high = of('overvoltage');
  if (high.length) {
    const { n, worst } = poles(high, false);
    lines.push({ text: `Voltage is too high at ${plural(n, 'pole', 'poles')} at ${at}. Worst: ${worst.pole} (${round(worst.value)} V).`, ...FIX_IT });
  }
  const hot = of('thermal');
  if (hot.length) {
    const { n, worst } = poles(hot, false);
    lines.push({ text: `Cables are overloaded on ${plural(n, 'span', 'spans')}. Worst: the span to ${worst.pole} (${round(worst.value)} % of rating).`, to: '/app/reconductor', linkLabel: 'See Reconductor' });
  }
  of('transformer overload').forEach(x => {
    const name = res.transformers.find(t => t.id === x.pole)?.name || x.pole;
    lines.push({ text: `Transformer ${name} is overloaded (${round(x.value)} %).`, to: '/app/feeder-split', linkLabel: 'See Feeder Split' });
  });
  const vuf = of('unbalance');
  if (vuf.length) {
    lines.push({ text: `Voltage unbalance is over the limit at ${plural(poles(vuf, false).n, 'pole', 'poles')}.`, to: '/app/load-balance', linkLabel: 'See Load Balance' });
  }

  if (!lines.length) return { ok: true, lines: [{ text: `All customers are within limits at ${at}.`, to: null, linkLabel: null }] };
  return { ok: false, lines };
}
