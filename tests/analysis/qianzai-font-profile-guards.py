"""CLI output-guard probes only. Never subsets a font or reads a real source TTF."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

root = Path.cwd().resolve()
directory = root / ".cache" / "known-ten" / ("font-profile-guards-" + str(uuid4()))
directory.mkdir(mode=0o700)
descriptor = root / "src/features/theme/qianzai-tongxin/editorial-fonts.json"
before = hashlib.sha256(descriptor.read_bytes()).hexdigest()
(directory / "intent.json").write_text(json.dumps({
    "scope": "new-profile output guards; no source TTF, glyph-coverage or subset proof",
    "root": str(root),
    "python": sys.executable,
    "editorialDescriptorSha256Before": before,
}, indent=2))
checks = []


def rejected(cwd, script, args, message):
    result = subprocess.run(
        [sys.executable, str(root / "scripts" / script), *args],
        cwd=cwd, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode != 0 and message in result.stderr, message
    checks.append(message)


try:
    serif = directory / "serif"
    out = serif / "public/assets/fonts/qianzai-v13"
    out.mkdir(parents=True)
    target = out / "serif-600.woff2"
    sentinel = b"output-guard-sentinel-not-a-font"
    target.write_bytes(sentinel)
    rejected(serif, "build-qztx-font.py", ["--profile", "v13", "--source-font", "never-read.ttf"], "NEW_FONT_OUTPUT_ALREADY_EXISTS")
    assert target.read_bytes() == sentinel
    assert not (out / "manifest.json").exists()
    editorial = directory / "editorial"
    editorial.mkdir()
    chars = editorial / "characters.txt"
    chars.write_text(" 字\n", encoding="utf8")
    args = ["--profile", "v6", "--kind", "literary", "--source-dir", "never-read", "--characters", str(chars)]
    rejected(editorial, "build-qztx-editorial-fonts.py", ["--profile", "v6", "--source-dir", "never-read", "--characters", str(chars)], "NEW_FONT_KIND_REQUIRED")
    rejected(editorial, "build-qztx-editorial-fonts.py", args, "NEW_FONT_DESCRIPTOR_OUTPUT_REQUIRED")
    rejected(editorial, "build-qztx-editorial-fonts.py", [*args, "--descriptor-out", str(editorial / "candidate.json")], "PRIVATE_FONT_DESCRIPTOR_REQUIRED")
    assert not (editorial / "public").exists()
    assert not (editorial / "candidate.json").exists()
    assert hashlib.sha256(descriptor.read_bytes()).hexdigest() == before
    result = {"status": "PASS_PROFILE_OUTPUT_GUARDS_NO_SUBSETTING", "checks": checks,
              "existingEditorialDescriptorUnchanged": True, "realFontSourcesRead": False,
              "newFontsGenerated": False, "glyphCoverage": "NOT_RUN_PENDING_FROZEN_CORPUS_AND_PINNED_SOURCES"}
    (directory / "result.json").write_text(json.dumps(result, indent=2))
    print(json.dumps({"status": result["status"], "checks": len(checks), "receipt": str(directory / "result.json")}))
except Exception as error:
    (directory / "failure.json").write_text(json.dumps({"status": "FAILED_PRESERVED", "checks": checks, "error": str(error)}, indent=2))
    raise
