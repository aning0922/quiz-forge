"""Use exact pinned source fonts to prove rejection before any new subset output."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4

root = Path.cwd().resolve()
sources = Path(sys.argv[1]).resolve()
assert sources.is_relative_to(root / ".cache")
out = root / ".cache/known-ten" / ("font-glyph-guards-" + str(uuid4()))
out.mkdir(mode=0o700)
checks = []


def run(name, arguments, expected, serif=False):
    cwd = out / name
    cwd.mkdir()
    chars = cwd / "characters.txt"
    chars.write_text("字\n" if expected == "FONT_SPACE_REQUIRED" else " 字\U0010ffff\n", encoding="utf8")
    if serif:
        font_out = cwd / "public/assets/fonts/qianzai-v13"
        font_out.mkdir(parents=True)
        shutil.copyfile(sources / "serif-OFL.txt", font_out / "OFL.txt")
        shutil.copyfile(chars, font_out / "characters.txt")
        script = "build-qztx-font.py"
        args = ["--profile", "v13", "--source-font", str(sources / "serif.ttf")]
    else:
        script = "build-qztx-editorial-fonts.py"
        args = ["--profile", "v6", "--source-dir", str(sources), "--characters", str(chars), "--descriptor-out", str(cwd / ".cache/candidate.json"), *arguments]
    result = subprocess.run([sys.executable, str(root / "scripts" / script), *args], cwd=cwd, capture_output=True, text=True, timeout=15)
    assert result.returncode != 0 and expected in result.stderr, name
    assert not list(cwd.rglob("*.woff2")), name
    assert not list(cwd.rglob("manifest.json")), name
    assert not (cwd / ".cache/candidate.json").exists(), name
    checks.append({"case": name, "expected": expected, "fontOutputs": 0})


try:
    run("serif-missing", [], "SOURCE_GLYPH_MISSING:0x10ffff", True)
    run("brush-missing", ["--kind", "brush"], "SOURCE_GLYPH_MISSING:0x10ffff")
    run("literary-missing", ["--kind", "literary"], "SOURCE_GLYPH_MISSING:0x10ffff")
    run("serif-space", [], "FONT_SPACE_REQUIRED", True)
    run("literary-space", ["--kind", "literary"], "FONT_SPACE_REQUIRED")
    receipt = {"status": "PASS_PINNED_SOURCE_GLYPH_GUARDS_NO_SUBSETTING", "sourceDirectory": str(sources), "checks": checks, "newFontsGenerated": False, "finalCorpusCoverage": "NOT_RUN"}
    (out / "result.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps({"status": receipt["status"], "checks": len(checks), "receipt": str(out / "result.json")}))
except Exception as error:
    (out / "failure.json").write_text(json.dumps({"status": "FAILED_PRESERVED", "checks": checks, "error": str(error)}, indent=2))
    raise
