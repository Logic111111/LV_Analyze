"""Cross-validate the app's load flow against OpenDSS (P7.6). Dev-only — not a runtime dependency.

    pip install opendssdirect.py
    python scripts/validate-opendss.py [--tol 0.5] [--out <dir>] [--json <file>]

Runs scripts/opendss-cases.mjs (Node) to export each case as an OpenDSS script plus the app's own
results for the same snapshot, solves each script in OpenDSS, and compares every pole's and
transformer bus's phase-to-local-neutral voltage, every span's phase and neutral current, and the
total losses. Exits non-zero if any case's voltages differ by more than --tol volts (default 0.5 V,
the agreement target in the brief). --json writes every compared point for the app's Validation
page (client/src/data/opendss-validation.json).
"""
import argparse
import datetime
import json
import math
import os
import subprocess
import sys
import tempfile

import opendssdirect as dss

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def phase_neutral(bus):
    """|V(node k) - V(node 4)| for k = 1, 2, 3 at one bus (volts)."""
    dss.Circuit.SetActiveBus(bus)
    nodes = dss.Bus.Nodes()
    v = dss.Bus.Voltages()
    ph = {n: complex(v[2 * i], v[2 * i + 1]) for i, n in enumerate(nodes)}
    vn = ph.get(4, 0j)
    return {name: abs(ph[k] - vn) for name, k in (("A", 1), ("B", 2), ("C", 3))}


def line_currents():
    """Bus2 name -> |I| of phases A, B, C and the neutral at the line's sending end (amps)."""
    out = {}
    for name in dss.Lines.AllNames():
        dss.Lines.Name(name)
        mags = dss.CktElement.CurrentsMagAng()[0::2]
        out[dss.Lines.Bus2().split(".")[0]] = dict(zip(("A", "B", "C", "N"), mags[:4]))
    return out


def transformer_kva():
    """LV bus name -> apparent power at the transformer's LV terminal (kVA). Includes the few watts
    into the transformer's earth electrode, which the app's txKVA (power into the feeders) leaves out."""
    out = {}
    for name in dss.Transformers.AllNames():
        dss.Transformers.Name(name)
        n = dss.CktElement.NumConductors()
        t2 = dss.CktElement.Powers()[2 * n:4 * n]  # terminal 2 (LV): (kW, kvar) per conductor
        out[dss.CktElement.BusNames()[1].split(".")[0].lower()] = math.hypot(sum(t2[0::2]), sum(t2[1::2]))
    return out


def element_losses():
    """Real losses of every line, transformer and earth resistor (watts). Circuit.Losses() leaves out
    the earth Reactors, which the app counts."""
    total = 0.0
    for el in dss.Circuit.AllElementNames():
        if el.split(".")[0] in ("Line", "Transformer", "Reactor"):
            dss.Circuit.SetActiveElement(el)
            total += dss.CktElement.Losses()[0]
    return total


def stats(diffs):
    """Largest |d| (with where), RMS, count, for a list of (d, where) pairs."""
    if not diffs:
        return {"max": 0.0, "where": "", "rms": 0.0, "n": 0}
    worst = max(diffs, key=lambda x: abs(x[0]))
    return {"max": abs(worst[0]), "where": worst[1], "rms": math.sqrt(sum(d * d for d, _ in diffs) / len(diffs)), "n": len(diffs)}


def run_case(out_dir, name):
    with open(os.path.join(out_dir, name + ".app.json"), encoding="utf-8") as f:
        app = json.load(f)
    dss.Basic.ClearAll()
    dss.Text.Command("Redirect [" + os.path.join(out_dir, name + ".dss") + "]")
    if not dss.Solution.Converged():
        return {"name": name, "ok": False, "error": "OpenDSS did not converge"}
    v_points, i_points = [], []
    for item in app["transformers"] + app["poles"]:
        got = phase_neutral(item["bus"])
        for p in ("A", "B", "C"):
            v_points.append([item["id"], p, item["V"][p], got[p]])
    lines = line_currents()
    for item in app["poles"]:
        got = lines[item["bus"]]
        for p in ("A", "B", "C", "N"):
            i_points.append([item["id"], p, item["I"][p], got[p]])
    dss_loss = element_losses()
    kva = transformer_kva()
    return {
        "name": name, "ok": True, "label": app.get("label", name), "status": app["status"],
        "poleCount": app.get("poleCount"), "hour": app.get("hour"), "loadMult": app.get("loadMult"),
        "iterations": dss.Solution.Iterations(), "notes": app.get("notes", []),
        "voltage": stats([(a - b, f"{i} {p}") for i, p, a, b in v_points]),
        "current": stats([(a - b, f"{i} {p}") for i, p, a, b in i_points]),
        "losses": {"appW": app["lossW"], "dssW": dss_loss, "diffW": app["lossW"] - dss_loss,
                   "diffPct": 100 * (app["lossW"] - dss_loss) / dss_loss if dss_loss else 0.0},
        "points": [[i, p, round(a, 6), round(b, 6)] for i, p, a, b in v_points],
        "currents": [[i, p, round(a, 6), round(b, 6)] for i, p, a, b in i_points],
        "transformers": [[t["id"], round(t["kVA"], 6), round(kva[t["bus"].lower()], 6)] for t in app["transformers"]],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tol", type=float, default=0.5, help="largest allowed voltage difference, volts")
    ap.add_argument("--out", default=None, help="where to write the cases (default: a temp dir)")
    ap.add_argument("--json", default=None, help="write the full comparison to this JSON file")
    ap.add_argument("--single", metavar="BASE", default=None,
                    help="compare one exported case (BASE.dss + BASE.app.json) and print it as JSON (the server's check)")
    args = ap.parse_args()
    if args.single:
        r = run_case(os.path.dirname(args.single), os.path.basename(args.single))
        r.update(opendss=dss.Basic.Version().split(";")[0], tolerance=args.tol)
        r["pass"] = r["ok"] and r["voltage"]["max"] <= args.tol
        print(json.dumps(r, separators=(",", ":")))
        return
    out_dir = args.out or tempfile.mkdtemp(prefix="opendss-")
    subprocess.run(["node", os.path.join(HERE, "opendss-cases.mjs"), out_dir], check=True, cwd=ROOT)
    with open(os.path.join(out_dir, "cases.json"), encoding="utf-8") as f:
        names = json.load(f)
    version = dss.Basic.Version().split(";")[0]
    print("OpenDSS", version)
    print(f"{'case':28} {'app':10} {'V pts':>5} {'max |dV| V':>11} {'rms V':>9} {'I pts':>5} {'max |dI| A':>11} {'loss diff %':>11}  worst V")
    failed = False
    results = []
    for name in names:
        r = run_case(out_dir, name)
        results.append(r)
        if not r["ok"]:
            print(f"{name:28} ERROR {r['error']}")
            failed = True
            continue
        v, i, lo = r["voltage"], r["current"], r["losses"]
        flag = "" if v["max"] <= args.tol else "  <-- over tolerance"
        failed = failed or bool(flag)
        print(f"{name:28} {r['status']:10} {v['n']:5d} {v['max']:11.5f} {v['rms']:9.5f} {i['n']:5d} {i['max']:11.5f} {lo['diffPct']:11.6f}  {v['where']}{flag}")
        for n in r["notes"]:
            print(f"{'':28} note: {n}")
    print("PASS" if not failed else "FAIL", f"(tolerance {args.tol} V)")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                       "opendss": version, "tolerance": args.tol, "pass": not failed, "cases": results}, f, separators=(",", ":"))
        print("wrote", args.json)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
