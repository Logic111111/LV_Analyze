// @ts-check
// JSDoc type definitions for the engine's data model and results. Types only — no runtime code.
// Engine modules reference them as `import('./types.js').Design` etc.; `npm run typecheck` checks
// the engine against them (tsconfig.engine.json).
//
// Units, used throughout: voltages in V (phase-to-local-neutral unless stated), currents in A,
// impedances in Ω, powers in kW / kVAR / kVA, losses in W per snapshot and kWh per scan, lengths
// in m (span) or km (per-km conductor data).

/** @typedef {{ re: number, im: number }} Complex */
/** @typedef {'A' | 'B' | 'C'} Phase */
/** Single-phase connection, or a balanced 3-phase one (split equally over A/B/C). */
/** @typedef {Phase | 'ABC'} ConnectionPhase */
/**
 * @template T
 * @typedef {{ A: T, B: T, C: T }} PhaseMap
 */

/**
 * One distribution transformer (Dyn11, 11 kV / 415 V).
 * @typedef {object} Transformer
 * @property {string} id
 * @property {string} [name]
 * @property {number} txRating   Nameplate kVA; key into the transformer library.
 * @property {number} tap        Off-load tap position 1–4 (see TAPS).
 * @property {number} hvActual   Assumed constant HV supply voltage, V line-line.
 * @property {number} [txXR]     X/R ratio used to split |Z| (default 3).
 * @property {number} [txGroundOhms] Star-point earth electrode resistance, Ω (default 7.5).
 */

/**
 * A pole and the span that feeds it from its parent (a transformer id or another pole id).
 * @typedef {object} Pole
 * @property {string} id
 * @property {string} feeder
 * @property {string} parent
 * @property {number} spanM      Length of the span from the parent, m.
 * @property {string} cond       Conductor code of that span; key into the conductor library.
 * @property {boolean} [grounded] Earth electrode bonded to the neutral at this pole.
 * @property {number} [groundOhms]
 */

/**
 * A demand connection. `kva` null or '' (a blank form field) means "use the design ADMD".
 * @typedef {object} Connection
 * @property {string} id
 * @property {string} pole
 * @property {'general' | 'ev' | 'shop' | 'evcs'} type
 * @property {ConnectionPhase} phase
 * @property {number | string | null} [kva]
 */

/**
 * Rooftop PV, rated kVA (unity pf unless a smart-inverter mode applies — P3.1).
 * @typedef {object} PvConnection
 * @property {string} [id]
 * @property {string} pole
 * @property {ConnectionPhase} phase
 * @property {number | string} kva
 * @property {string} [inverterMode] Per-unit override of design.inverter.mode.
 */
/**
 * A BESS unit. Rated power is `kva`; the SOC fields are used only by the SOC-aware modes (P3.2).
 * @typedef {object} BessConnection
 * @property {string} [id]
 * @property {string} pole
 * @property {ConnectionPhase} phase
 * @property {number | string} kva
 * @property {'schedule' | 'socSchedule' | 'solarFollowing'} [mode]  Default 'schedule'.
 * @property {number | null} [kWh]       Usable energy capacity (required by the SOC modes).
 * @property {number} [socInitial]       State of charge at 00:00, 0–1 (default 0.5).
 * @property {number} [socMin]           Default 0.
 * @property {number} [socMax]           Default 1.
 * @property {number} [etaCharge]        Default √RTE.
 * @property {number} [etaDischarge]     Default √RTE.
 */

/**
 * Normally-open tie between two feeders — carries no current; a siting reference only.
 * @typedef {object} OpenPoint
 * @property {string} id
 * @property {string} poleA
 * @property {string} poleB
 * @property {number} spanM
 * @property {string} cond
 */

/**
 * Conductor library entry. R and |Z| are per km at 20 °C; X is derived as √(|Z|² − R²).
 * @typedef {object} ConductorType
 * @property {number} R             Phase resistance, Ω/km.
 * @property {number} Z             Phase |Z|, Ω/km.
 * @property {number} I             Current rating, A.
 * @property {number} neutralScale  Rn = R × neutralScale.
 * @property {number} [L_mH]        Self-inductance, mH/km (informational).
 */

/**
 * Transformer library entry, keyed by rating.
 * @typedef {object} TransformerType
 * @property {number} kVA
 * @property {number} z        Per-unit impedance on its own rating.
 * @property {number} noLoadW  Core (no-load) loss, W.
 */

/**
 * A complete design (one island: one or more transformers and their radial trees).
 * @typedef {object} Design
 * @property {string} name
 * @property {Transformer[]} transformers
 * @property {Pole[]} poles
 * @property {Connection[]} loads
 * @property {PvConnection[]} pv
 * @property {BessConnection[]} bess
 * @property {OpenPoint[]} openPoints
 * @property {number} admd   After-diversity maximum demand per general connection, kVA.
 * @property {number} pf     Demand power factor.
 * @property {number} growth Annual demand growth, %.
 * @property {'constant' | 'zip'} loadModel
 * @property {number} [zipZ]
 * @property {number} [zipI]
 * @property {number} [zipP]
 * @property {Record<string, number>} [txNoLoadW] Per-rating no-load loss override, W.
 * @property {number} vnom   Nominal phase-neutral voltage, V.
 * @property {number} vdev   Allowed deviation, ±%.
 * @property {number} maxpv
 * @property {number} maxbess
 * @property {number} bessRte
 * @property {boolean} includeGeneral
 * @property {boolean} includeEV
 * @property {boolean} includeSolar
 * @property {boolean} includeShop
 * @property {boolean} includeBess
 * @property {boolean} includeEVCS
 * @property {number} bessChargeStartHour
 * @property {number} bessChargeEndHour
 * @property {number} bessDischargeStartHour
 * @property {number} bessDischargeEndHour
 * @property {number[]} loadCurve
 * @property {number[]} evCurve
 * @property {number[]} solarCurve
 * @property {number[]} shopCurve
 * @property {number[]} evcsCurve
 * @property {Standards} [standards]
 * @property {import('./inverter.js').InverterSettings} [inverter]
 * @property {Partial<typeof import('./thermal.js').THERMAL_DEFAULTS> & { ambientC?: number[] }} [thermal]
 * @property {import('./faults.js').FaultSettings} [fault]
 * @property {import('./faults.js').FuseType[]} [fuseLibrary]
 * @property {{ feederFuses: Record<string, string>, poleFuses: Record<string, string> }} [protection]
 * @property {Record<string, ConductorType>} [conductorLibrary]
 * @property {Record<string, TransformerType>} [transformerLibrary]
 */

/**
 * The standards results are judged against (more fields arrive with P2.3 / P2.7).
 * @typedef {object} Standards
 * @property {number} vufLimitPct     Voltage unbalance factor limit, % (EN 50160 LV: 2 %).
 * @property {boolean} vufAsViolation Raise an 'unbalance' violation above the limit (default off).
 * @property {number} [disconnectTimeS] Fuse disconnection time the protection check uses: 5 or 0.4 s.
 * @property {number} [cableLoadingLimitPct] Thermal violation above this % of a span's rating (100).
 * @property {number} [txLoadingLimitPct] Transformer overload above this % of rating, importing (100).
 * @property {string} [profileName] The standards profile last applied (informational).
 */

/**
 * Options for one snapshot.
 * @typedef {object} SnapshotOptions
 * @property {number} year
 * @property {number} hour
 * @property {number} [loadMult]
 * @property {number} [solarMult]
 * @property {PvConnection[]} [extraPV]    Candidate PV additions (hosting searches).
 * @property {BessConnection[]} [extraBess] Candidate BESS additions.
 * @property {Record<string, number> | null} [bessDispatch] SOC-mode BESS grid power this hour, kW (+ discharge).
 */

/**
 * @typedef {object} Violation
 * @property {string} pole   Pole id, or the transformer id for 'transformer overload'.
 * @property {Phase | '-'} phase
 * @property {'undervoltage' | 'overvoltage' | 'thermal' | 'transformer overload' | 'unbalance'} type
 * @property {number} value  V for voltage types, % for thermal/overload, VUF % for unbalance.
 */

/**
 * Per-pole result. Currents/flows are for the span feeding this pole.
 * @typedef {object} PoleResult
 * @property {string} id
 * @property {string} feeder
 * @property {string} parent
 * @property {string} cond
 * @property {number} spanM
 * @property {PhaseMap<number>} volt    |V| phase-to-local-neutral, V.
 * @property {PhaseMap<Complex>} vph    The same voltages as complex phasors (source phase A at 0°).
 * @property {{ id?: string, phase: Phase, mode: string, vPu: number, pAvailKw: number, pKw: number, qKvar: number, curtailedKw: number }[]} [inverters]
 *   Smart-inverter PV units at this pole (empty in unity mode): final output and curtailment.
 * @property {number} vufPct            Voltage unbalance factor |V2|/|V1|, %.
 * @property {PhaseMap<number>} cur     |I| per phase in the span, A.
 * @property {number} In                |I| in the span's neutral, A.
 * @property {number} rating            Conductor rating, A.
 * @property {PhaseMap<number>} condPct Loading, % of rating.
 * @property {number} flowKW            Real power into the pole (negative = reverse flow).
 * @property {number} flowKVAR
 */

/**
 * @typedef {object} TransformerSummary
 * @property {string} id
 * @property {string} name
 * @property {number} txKVA
 * @property {number} txPct
 * @property {'import' | 'export'} flowDirection
 * @property {number} netKW
 * @property {number} netKVAR
 * @property {PhaseMap<number>} busVoltPct LV bus |V| per phase, V (historical name).
 * @property {PhaseMap<Complex>} busVph LV bus voltage phasors.
 * @property {number} busVufPct LV bus voltage unbalance factor, %.
 * @property {PhaseMap<number>} phaseCurrentA |I| per phase through the transformer, A.
 * @property {{ r: number, x: number, z: number }} txZ
 * @property {number} txLossW   Copper loss, W.
 * @property {number} txNoLoadW Core loss, W.
 * @property {number} V0        Open-circuit phase-neutral voltage at this tap, V.
 */

/**
 * @typedef {object} SnapshotResult
 * @property {boolean} converged
 * @property {number} iterUsed
 * @property {number} lastDelta   Final max |ΔV| between iterations, V.
 * @property {PoleResult[]} poleResults
 * @property {number} totalLossW  Line (phase + neutral conductor) loss, W.
 * @property {Record<string, number>} lossByPole
 * @property {number} groundLossW
 * @property {Record<string, number>} groundLossByPole
 * @property {TransformerSummary[]} transformers
 * @property {Violation[]} violations
 * @property {number} vLimLow
 * @property {number} vLimHigh
 * @property {number} vufLimitPct
 * @property {{ pole: string, value: number } | null} worstVuf Highest pole VUF in this snapshot.
 * @property {number} year
 * @property {number} hour
 * @property {number} loadMult
 * @property {number} solarMult
 */

/**
 * Progress report from a long-running engine function, for a progress bar: `done` of `total`
 * steps of the current `stage` (a short human-readable label, e.g. "2/2 Simultaneous queue").
 * @typedef {{ stage?: string, done: number, total: number }} Progress
 */
/** @typedef {{ onProgress?: (p: Progress) => void }} ProgressHooks */

export {};
