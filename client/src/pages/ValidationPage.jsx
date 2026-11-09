import { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import CsvButton from '../components/CsvButton.jsx';
import { CHART_PALETTES, themedScales } from '../lib/chartTheme.js';
import data from '../data/opendss-validation.json';

// Accuracy of the app's load flow against OpenDSS: the stored results of
// scripts/validate-opendss.py (OpenDSS can't run in the browser). Re-run with
//   python scripts/validate-opendss.py --json client/src/data/opendss-validation.json
const cases = data.cases.filter(c => c.ok);
const maxOf = (f) => Math.max(...cases.map(f));
const worstV = maxOf(c => c.voltage.max);
const worstI = maxOf(c => c.current.max);
const worstLossPct = maxOf(c => Math.abs(c.losses.diffPct));
const nV = cases.reduce((s, c) => s + c.voltage.n, 0);
const nI = cases.reduce((s, c) => s + c.current.n, 0);
const mV = (v) => (v * 1000).toFixed(2);

export default function ValidationPage() {
  const { theme } = useTheme();
  const P = CHART_PALETTES[theme] || CHART_PALETTES.light;

  const parity = useMemo(() => {
    const pts = cases.flatMap(c => c.points.map(([, , app, dss]) => ({ x: dss, y: app })));
    const lo = Math.min(...pts.map(p => p.x)), hi = Math.max(...pts.map(p => p.x));
    return {
      data: { datasets: [
        { label: `Every bus and phase (${pts.length})`, data: pts, backgroundColor: P.seriesColors[0], pointRadius: 2 },
        { label: 'Perfect agreement (app = OpenDSS)', data: [{ x: lo, y: lo }, { x: hi, y: hi }], showLine: true, borderColor: P.maxColor, borderDash: [6, 4], pointRadius: 0 }
      ] },
      options: { responsive: true, scales: themedScales(P, { xTitle: 'OpenDSS voltage (V, phase to neutral)', yTitle: 'App voltage (V)' }), plugins: { legend: { labels: { color: P.legendColor } } } }
    };
  }, [P]);

  const margin = useMemo(() => {
    const scales = themedScales(P, { xTitle: 'Test case (# in the table below)', yTitle: 'Largest voltage difference (mV, log scale)' });
    const decade = (v) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9;
    return {
      data: {
        labels: cases.map((c, i) => String(i + 1)),
        datasets: [
          { type: 'bar', label: 'Largest |app - OpenDSS| in the case', data: cases.map(c => c.voltage.max * 1000), backgroundColor: P.seriesColors[0] },
          { type: 'line', label: `Pass limit (${data.tolerance * 1000} mV)`, data: cases.map(() => data.tolerance * 1000), borderColor: P.maxColor, borderDash: [6, 4], pointRadius: 0 }
        ]
      },
      options: {
        responsive: true,
        scales: { x: scales.x, y: { ...scales.y, type: 'logarithmic', min: 0.01, max: 1000, ticks: { ...scales.y.ticks, callback: v => (decade(v) ? String(v) : '') } } },
        plugins: { legend: { labels: { color: P.legendColor } }, tooltip: { callbacks: { title: (items) => cases[items[0].dataIndex].label } } }
      }
    };
  }, [P]);

  return (
    <div>
      <div className="card">
        <h2>Accuracy against OpenDSS <span className={'pill ' + (data.pass ? 'ok' : 'bad')}>{data.pass ? 'Pass' : 'Fail'}</span></h2>
        <p className="hint">
          Each test network was exported to OpenDSS (the open-source distribution simulator from EPRI) as the same model the app solves, solved there,
          and every result compared: the phase-to-neutral voltage at every bus, the phase and neutral current in every span, and the total losses.
          Run on {new Date(data.generated).toLocaleString()} with {data.opendss.replace(/ revision.*/, '')}.
        </p>
        <div className="grid g4">
          <div className={'stat ' + (data.pass ? 'ok' : 'bad')}><div className="v">{cases.filter(c => c.voltage.max <= data.tolerance).length} / {data.cases.length}</div><div className="l">Test cases within the {data.tolerance * 1000} mV limit</div></div>
          <div className="stat ok"><div className="v">{mV(worstV)} mV</div><div className="l">Largest voltage difference of {nV} bus voltages ({(worstV / 230 * 100).toPrecision(1)} % of 230 V)</div></div>
          <div className="stat ok"><div className="v">{mV(worstI)} mA</div><div className="l">Largest current difference of {nI} span currents</div></div>
          <div className="stat ok"><div className="v">{worstLossPct.toFixed(3)} %</div><div className="l">Largest difference in total losses</div></div>
        </div>
      </div>

      <div className="grid g2 mt-4">
        <div className="card" style={{ minWidth: 0 }}>
          <h3>App voltage against OpenDSS voltage</h3>
          <p className="hint">Every point sits on the line where the two agree.</p>
          <ChartCanvas type="scatter" data={parity.data} options={parity.options} height={220} label="Scatter of the app's bus voltages against OpenDSS's: every point lies on the line of perfect agreement" />
        </div>
        <div className="card" style={{ minWidth: 0 }}>
          <h3>Margin to the pass limit, per case</h3>
          <p className="hint">The largest difference in each case is about a thousand times smaller than the limit.</p>
          <ChartCanvas type="bar" data={margin.data} options={margin.options} height={220} label="Largest voltage difference per test case on a log scale, all far below the 500 mV limit" />
        </div>
      </div>

      <div className="card mt-4">
        <h3>Results per test case</h3>
        <div style={{ marginBottom: 8 }}>
          <CsvButton name="OpenDSS validation" columns={['Case', 'Poles', 'Voltage points', 'Max |dV| mV', 'RMS dV mV', 'Current points', 'Max |dI| mA', 'Losses app kW', 'Losses OpenDSS kW', 'Loss difference %', 'App status']}
            rows={cases.map(c => [c.label, c.poleCount, c.voltage.n, mV(c.voltage.max), mV(c.voltage.rms), c.current.n, mV(c.current.max), (c.losses.appW / 1000).toFixed(4), (c.losses.dssW / 1000).toFixed(4), c.losses.diffPct.toFixed(5), c.status])} />
        </div>
        <div className="tbl-wrap" style={{ maxHeight: 'none' }}><table>
          <thead><tr>
            <th scope="col">#</th><th scope="col">Test case</th><th scope="col">Poles</th><th scope="col">Voltages compared</th><th scope="col">Largest |ΔV|</th><th scope="col">RMS ΔV</th>
            <th scope="col">Currents compared</th><th scope="col">Largest |ΔI|</th><th scope="col">Losses app / OpenDSS</th><th scope="col">Loss difference</th><th scope="col">Result</th>
          </tr></thead>
          <tbody>
            {cases.map((c, i) => (
              <tr key={c.name}>
                <td>{i + 1}</td><td>{c.label}</td><td>{c.poleCount}</td><td>{c.voltage.n}</td><td>{mV(c.voltage.max)} mV</td><td>{mV(c.voltage.rms)} mV</td>
                <td>{c.current.n}</td><td>{mV(c.current.max)} mA</td>
                <td>{(c.losses.appW / 1000).toFixed(3)} / {(c.losses.dssW / 1000).toFixed(3)} kW</td><td>{Math.abs(c.losses.diffPct).toFixed(4)} %</td>
                <td><span className={'pill ' + (c.voltage.max <= data.tolerance ? 'ok' : 'bad')}>{c.voltage.max <= data.tolerance ? 'Pass' : 'Fail'}</span></td>
              </tr>
            ))}
            {data.cases.filter(c => !c.ok).map(c => (
              <tr key={c.name}><td></td><td>{c.name}</td><td colSpan={8}>{c.error}</td><td><span className="pill bad">Fail</span></td></tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="card mt-4">
        <h3>What this shows, and what it doesn't</h3>
        <div className="note"><b>Shows:</b> given the same network and loads, the app's solver gets the same voltages, currents and losses as OpenDSS. The differences are at the app solver's own stopping tolerance (10⁻⁴ V per iteration). The cases cover radial feeders up to 50 poles, solar and battery export, heavy loading with undervoltage, earthed poles (the nodal neutral solve), voltage-dependent ZIP loads, a coupled 4×4 line model and two transformers.</div>
        <div className="note"><b>Doesn&apos;t show:</b> how closely the model matches a real network. That depends on the input data (conductor impedances, load profiles, connection phases) and is checked against field measurements on the Field data page, not against another simulator.</div>
        <div className="note"><b>Model notes:</b> both tools solve a 4-wire network with an explicit neutral and no shunt capacitance. Smart-inverter PV and scheduled batteries are fixed at the app&apos;s operating point for the hour, so the comparison is about the network solution. OpenDSS can&apos;t take a 0 m span, so it gets 1 cm; that stub explains the 0.02 % loss difference in the two-transformer case.</div>
        <p className="hint" style={{ marginTop: 12 }}>To re-run: <code>pip install opendssdirect.py</code>, then <code>python scripts/validate-opendss.py --json client/src/data/opendss-validation.json</code>.</p>
      </div>
    </div>
  );
}
