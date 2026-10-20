"""Run at the repository root. Independent exact arithmetic; no engine imports."""

import hashlib
import json
import re
import subprocess
from fractions import Fraction
from pathlib import Path


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def digest(value, domain=""):
    return hashlib.sha256(domain.encode() + canonical(value)).hexdigest()


root = Path("docs/qa/p3a-scoring")
fixture_bytes = Path("src/features/quiz/scoring/fixtures/historical-review.json").read_bytes()
fixture = json.loads(fixture_bytes)
artifact = json.loads((root / "historical-execution.json").read_bytes())
source = fixture["source"]
raw = subprocess.check_output(["git", "show", source["commit"] + ":" + source["path"]])
assert hashlib.sha256(raw).hexdigest() == source["sha256"]
text = raw.decode()
rows = re.findall(r"^\|\s*(q\d\d-[a-d])\s*\|[^\n]*?\|\s*\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)\s*\|", text, re.M)
assert len(rows) == 48
vectors = {row[0]: list(map(int, row[1:])) for row in rows}
targets = {}
for line in text.splitlines():
    parts = [p.strip() for p in line.split("|")[1:-1]]
    if len(parts) >= 3 and parts[0] in ["li-bai", "su-shi", "tao-yuan-ming", "bai-ju-yi"]:
        match = re.fullmatch(r"\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)", parts[2])
        if match:
            targets[parts[0]] = list(map(int, match.groups()))
assert len(targets) == 4
witness_rows = re.findall(r"^\|\s*(q\d\d)\s*\|\s*(q\d\d-[a-d])\s*\|\s*(q\d\d-[a-d])\s*\|\s*(q\d\d-[a-d])\s*\|\s*(q\d\d-[a-d])\s*\|", text, re.M)
assert len(witness_rows) == 12
definition = fixture["definition"]
order = [r["id"] for r in definition["rules"]["resultOrder"]]
assert order == ["li-bai", "su-shi", "tao-yuan-ming", "bai-ju-yi"]
for question in definition["questions"]:
    for option in question["options"]:
        assert [c["value"] for c in option["contributions"]] == vectors[option["ref"]["id"]]
for profile in definition["rules"]["profiles"]:
    assert [t["value"] for t in profile["targets"]] == targets[profile["resultRef"]["id"]]
payload = {k: v for k, v in fixture.items() if k != "transcriptionSha256"}
assert digest(payload, "quizforge:quiz-authoring-transcription.v1\n") == fixture["transcriptionSha256"]
assert artifact["sourceBinding"] == {"kind": "authoring-review", "source": source, "transcriptionSha256": fixture["transcriptionSha256"]}
logic_hash = digest(definition, "quizforge:quiz-logic.v1\n")
assert artifact["identity"]["logicHash"] == logic_hash
assert artifact["witnessEvidence"]["logicHash"] == logic_hash
assert artifact["witnessEvidence"]["inputSha256"] == digest(fixture["witnesses"])
assert artifact["witnessEvidence"]["witnessesHash"] == digest(fixture["witnesses"], "quizforge:quiz-witnesses.v1\n")
bounds = [(sum(min(vectors[f"q{qi:02d}-{letter}"][di] for letter in "abcd") for qi in range(1, 13)), sum(max(vectors[f"q{qi:02d}-{letter}"][di] for letter in "abcd") for qi in range(1, 13))) for di in range(4)]
assert bounds == [(0, 48), (0, 48), (4, 48), (2, 48)]
checks = []
for wi, score in enumerate(artifact["scores"]):
    answers = [{"questionId": row[0], "optionId": row[wi + 1]} for row in witness_rows]
    assert fixture["witnesses"]["entries"][wi]["answers"] == answers == score["normalizedAnswers"]
    sums = [sum(vectors[a["optionId"]][di] for a in answers) for di in range(4)]
    normalized = [Fraction(100 * (r - lo), hi - lo) for r, (lo, hi) in zip(sums, bounds)]
    distances = [sum((v - t) ** 2 for v, t in zip(normalized, targets[r])) for r in order]
    fraction = lambda v: {"numerator": str(v.numerator), "denominator": str(v.denominator)}
    assert score["logicHash"] == logic_hash
    assert score["answersHash"] == digest({"schemaVersion": "quiz-answers.v1", "logicHash": logic_hash, "answers": answers}, "quizforge:quiz-answers.v1\n")
    assert [d["rawSum"] for d in score["dimensions"]] == sums
    assert [d["normalized"] for d in score["dimensions"]] == list(map(fraction, normalized))
    assert [d["value"] for d in score["decision"]["distances"]] == list(map(fraction, distances))
    selected = order[distances.index(min(distances))]
    assert selected == order[wi] == score["decision"]["selectedResultRef"]["id"]
    checks.append({"resultId": selected, "rawSums": sums, "normalized": list(map(fraction, normalized)), "distances": [{"resultId": r, "value": fraction(v)} for r, v in zip(order, distances)]})
report = {"schemaVersion": "quiz-source-fraction-verification.v1", "method": "Python fractions.Fraction recomputed from exact Git source tables; no TypeScript engine imports", "implementationCommit": artifact["implementationCommit"], "source": source, "fixtureFileSha256": hashlib.sha256(fixture_bytes).hexdigest(), "logicHash": logic_hash, "transcriptionSha256": fixture["transcriptionSha256"], "optionVectorsVerified": 48, "witnessesVerified": 4, "distancesVerified": 16, "status": "passed", "checks": checks}
(root / "source-fraction-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": "passed", "optionVectorsVerified": 48, "witnessesVerified": 4, "distancesVerified": 16, "logicHash": logic_hash}))
