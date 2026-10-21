// @ts-check
// Public entry point of the load-flow engine. Pure, dependency-free ES modules: they run unchanged
// in the browser, a Web Worker and Node. `client/src/lib/loadflow.js` re-exports everything here,
// so existing `import { … } from '../lib/loadflow.js'` lines keep working.
//
// Module map:
//   complex.js              complex arithmetic, dense complex linear solve
//   sequence.js             symmetrical components, voltage unbalance factor
//   model.js                constants & libraries, defaultDesign/withDefaults, network helpers,
//                           transformer electrical model
//   loads.js                per-pole injections (curves, growth, ZIP, PV, BESS schedule)
//   solver.js               backward-forward sweep, runSnapshot
//   scan.js                 24 h scans, loss accounting, scan summary
//   profile.js              distance from the transformer, voltage-vs-distance profiles
//   faults.js               fault levels (IEC 60909-style), fuse protection check
//   standards.js            standards profiles (voltage band, VUF, loading limits, disconnection time)
//   inverter.js             smart-inverter PV (volt-var, volt-watt, export limit)
//   bessDispatch.js         BESS state of charge: sequential day simulation
//   thermal.js              transformer hot spot and ageing (IEC 60076-7)
//   lineModel.js            optional coupled 4×4 line impedance model
//   random.js               seeded PRNG (mulberry32) for reproducible searches
//   sensitivity.js          voltage sensitivity matrix (∂|V|/∂P, ∂|V|/∂Q), linear previews
//   monteCarlo.js           probabilistic planning (random EV/PV adoption, seeded)
//   scenarios.js            named scenarios: overrides + design patches, side-by-side comparison
//   issues.js               the issues list (violations, protection, solver, missing data)
//   explain.js              "explain this number" traces (formula, substituted values, result)
//   geo.js                  map editor geometry (haversine, measured vs entered spans)
//   economics.js            loss cost, capex, payback, NPV (user-entered costs only)
//   velander.js             demand from annual kWh (Velander), least-squares fit of k1, k2
//   ami.js                  smart-meter import: curves, peaks and ADMD suggestions
//   fieldReadings.js        measured vs simulated voltages, phase-label check
//   summary.js              compact per-design summary for the fleet dashboard
//   hosting.js              PV hosting capacity
//   bess.js                 BESS hosting capacity
//   advisors/feederSplit.js feeder split advisor
//   advisors/phaseBalance.js load balance advisor (Quick, nameplate greedy)
//   advisors/phaseOptimiser.js phase balancing v2 (objectives, local search, Pareto table)
//   advisors/tapAdvisor.js  off-load tap advisor
//   advisors/reconductor.js reconductoring advisor
//   advisors/fixItLadder.js combined fix-it ladder
export * from './complex.js';
export * from './sequence.js';
export * from './model.js';
export * from './loads.js';
export * from './solver.js';
export * from './scan.js';
export * from './profile.js';
export * from './faults.js';
export * from './standards.js';
export * from './inverter.js';
export * from './bessDispatch.js';
export * from './thermal.js';
export * from './lineModel.js';
export * from './random.js';
export * from './sensitivity.js';
export * from './monteCarlo.js';
export * from './scenarios.js';
export * from './issues.js';
export * from './explain.js';
export * from './geo.js';
export * from './economics.js';
export * from './velander.js';
export * from './ami.js';
export * from './fieldReadings.js';
export * from './summary.js';
export * from './opendss.js';
export * from './fieldSurvey.js';
export * from './hosting.js';
export * from './bess.js';
export * from './advisors/feederSplit.js';
export * from './advisors/phaseBalance.js';
export * from './advisors/phaseOptimiser.js';
export * from './advisors/tapAdvisor.js';
export * from './advisors/reconductor.js';
export * from './advisors/fixItLadder.js';
