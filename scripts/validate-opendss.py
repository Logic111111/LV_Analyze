"""Cross-validate the app's load flow against OpenDSS (P7.6). Dev-only — not a runtime dependency.

    pip install opendssdirect.py
    python scripts/validate-opendss.py [--tol 0.5] [--out <dir>]

Runs scripts/opendss-cases.mjs (Node) to export each case as an OpenDSS script plus the app's own
voltages for the same snapshot, solves each script in OpenDSS, and compares every pole's and
transformer bus's phase-to-local-neutral voltage. Exits non-zero if any case differs by more than
--tol volts (default 0.5 V, the agreement target in the brief).
"""
import argparse
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


def run_case(out_dir, name):
    with open(os.path.join(out_dir, name + ".app.json"), encoding="utf-8") as f:
        app = json.load(f)
    dss.Basic.ClearAll()
    dss.Text.Command("Redirect [" + os.path.join(out_dir, name + ".dss") + "]")
    if not dss.Solution.Converged():
        return {"name": name, "ok": False, "error": "OpenDSS did not converge"}
    worst = (0.0, "", "")
    diffs = []
    for item in app["transformers"] + app["poles"]:
        got = phase_neutral(item["bus"])
        for p in ("A", "B", "C"):
            d = abs(got[p] - item["V"][p])
            diffs.append(d)
            if d > worst[0]:
                worst = (d, item["id"], p)
    rms = math.sqrt(sum(d * d for d in diffs) / len(diffs))
    return {"name": name, "ok": True, "status": app["status"], "max": worst[0], "where": f"{worst[1]} {worst[2]}",
            "rms": rms, "n": len(diffs), "iterations": dss.Solution.Iterations(), "notes": app.get("notes", [])}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tol", type=float, default=0.5, help="largest allowed difference, volts")
    ap.add_argument("--out", default=None, help="where to write the cases (default: a temp dir)")
    args = ap.parse_args()
    out_dir = args.out or tempfile.mkdtemp(prefix="opendss-")
    subprocess.run(["node", os.path.join(HERE, "opendss-cases.mjs"), out_dir], check=True, cwd=ROOT)
    with open(os.path.join(out_dir, "cases.json"), encoding="utf-8") as f:
        names = json.load(f)
    print("OpenDSS", dss.Basic.Version().split(";")[0])
    print(f"{'case':30} {'app':10} {'points':>6} {'max |dV| V':>11} {'rms V':>9}  worst")
    failed = False
    for name in names:
        r = run_case(out_dir, name)
        if not r["ok"]:
            print(f"{name:30} ERROR {r['error']}")
            failed = True
            continue
        flag = "" if r["max"] <= args.tol else "  <-- over tolerance"
        failed = failed or bool(flag)
        print(f"{name:30} {r['status']:10} {r['n']:6d} {r['max']:11.5f} {r['rms']:9.5f}  {r['where']}{flag}")
        for n in r["notes"]:
            print(f"{'':30} note: {n}")
    print("PASS" if not failed else "FAIL", f"(tolerance {args.tol} V)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
