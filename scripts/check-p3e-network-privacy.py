"""Synthetic-only real Chromium failure probe; never loads a QuizForge instance/config."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
import zipfile

root = Path.cwd()
output = root / ".cache" / "p3e-network-privacy" / uuid.uuid4().hex
output.mkdir(parents=True, mode=0o700)
values = ["synthetic_cookie_" + uuid.uuid4().hex, "synthetic_csrf_" + uuid.uuid4().hex]
env = dict(os.environ)
for name in ["QUIZFORGE_P2A_CONFIG", "DEBUG", "PWDEBUG", "PLAYWRIGHT_HTML_ATTACHMENTS_BASE_URL"]:
    env.pop(name, None)
env.update(QF_INTERNAL_NETWORK_SENTINEL="synthetic-only", QF_INTERNAL_COOKIE_SENTINEL=values[0], QF_INTERNAL_CSRF_SENTINEL=values[1])
modes = ["unsafe-api-reset", "unsafe-relay-refused", "safe-api-refused", "safe-post-reset", "safe-post-stall", "safe-relay-refused", "safe-relay-stall", "safe-relay-late"]
results = []
def contains(data):
    return [value.encode() in data for value in values]
def scan(data):
    found = contains(data)
    for match in re.finditer(rb"data:application/zip;base64,([A-Za-z0-9+/=]+)", data):
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(match.group(1)))) as archive:
            for name in archive.namelist():
                more = contains(archive.read(name))
                found = [a or b for a, b in zip(found, more)]
    return found
for mode in modes:
    directory = output / mode
    directory.mkdir(mode=0o700)
    child_env = dict(env, QF_INTERNAL_NETWORK_PROBE_MODE=mode, QF_INTERNAL_NETWORK_PROBE_OUTPUT=str(directory))
    child = subprocess.run(["node", "node_modules/@playwright/test/cli.js", "test", "p3e-network-privacy.spec.ts", "--config", "playwright.p3e-privacy.config.ts"], cwd=root, env=child_env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
    (directory / "stdout.txt").write_bytes(child.stdout)
    hits = [False, False]
    files = []
    for file in directory.rglob("*"):
        if not file.is_file():
            continue
        data = file.read_bytes()
        flags = scan(data)
        hits = [a or b for a, b in zip(hits, flags)]
        files.append({"path": str(file.relative_to(directory)), "sha256": hashlib.sha256(data).hexdigest()})
    report = json.loads((directory / "result.json").read_text())
    errors = report.get("errors", [])
    messages = []
    def walk(value):
        if isinstance(value, dict):
            if isinstance(value.get("message"), str):
                messages.append(value["message"])
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(report)
    fixed_reached = bool(messages) and all(message.splitlines()[0] == "Error: FIXED_SAFE_FAILURE" for message in messages)
    expected_failure = report.get("stats", {}).get("expected") == 1 and report.get("stats", {}).get("unexpected") == 0 and not errors and fixed_reached
    result = {"mode": mode, "exitCode": child.returncode, "expectedFailureRendered": expected_failure, "cookieInArtifacts": hits[0], "csrfInArtifacts": hits[1], "files": files}
    results.append(result)
    print(json.dumps({k:v for k,v in result.items() if k != "files"}), flush=True)
source_files = ["tests/e2e/studio-internal-versions.network.ts", "tests/browser/p3e-network-privacy.spec.ts", "tests/e2e/studio-internal-versions.completion.ts", "playwright.p3e-privacy.config.ts", "scripts/check-p3e-network-privacy.py"]
summary = {"qualification": "synthetic-only-no-instance-no3100", "sourceFiles": [{"path": name, "sha256": hashlib.sha256((root / name).read_bytes()).hexdigest()} for name in source_files], "results": results}
summary["passed"] = all(r["exitCode"] == 0 and r["expectedFailureRendered"] and (all([r["cookieInArtifacts"], r["csrfInArtifacts"]]) if r["mode"].startswith("unsafe-") else not any([r["cookieInArtifacts"], r["csrfInArtifacts"]])) for r in results)
(output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({"passed": summary["passed"], "evidence": str(output / "summary.json")}), flush=True)
if not summary["passed"]:
    raise SystemExit(1)
