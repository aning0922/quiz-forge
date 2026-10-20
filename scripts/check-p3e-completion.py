"""Actual Playwright status/selection lifecycle; no browser, account, DB or fixture."""
import json
import os
from pathlib import Path
import subprocess
import uuid
root = Path.cwd()
output = root / ".cache/p3e-network-privacy" / ("completion-" + uuid.uuid4().hex)
output.mkdir(parents=True, mode=0o700)
results = []
for mode in ["full", "subset", "skip", "xfail", "xpass", "retry", "extra"]:
    directory = output / mode
    directory.mkdir(mode=0o700)
    env = dict(os.environ, QF_INTERNAL_NETWORK_PROBE_OUTPUT=str(directory), QF_INTERNAL_COMPLETION_MODE=mode)
    args = ["node", "node_modules/@playwright/test/cli.js", "test", "p3e-completion.spec.ts", "--config", "playwright.p3e-privacy.config.ts"]
    if mode == "subset": args += ["-g", "case0"]
    if mode == "retry": args += ["--retries=1"]
    child = subprocess.run(args, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
    (directory / "stdout.txt").write_bytes(child.stdout)
    eligible = (directory / "eligible-to-finish.json").exists()
    result = {"mode": mode, "exitCode": child.returncode, "eligibleToFinish": eligible, "passed": eligible == (mode == "full") and (mode != "full" or child.returncode == 0)}
    results.append(result)
    print(json.dumps(result), flush=True)
summary = {"qualification": "actual-playwright-statuses-no-browser-no-instance-no-fixture", "results": results, "passed": all(r["passed"] for r in results)}
(output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({"passed": summary["passed"], "evidence": str(output / "summary.json")}), flush=True)
if not summary["passed"]: raise SystemExit(1)
