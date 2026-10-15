"""Rebuild the pinned P3-C font with fonttools==4.61.1 and brotli==1.2.0.

The full upstream TTF stays outside Git. Supply its local path; no network runs.
"""
import argparse
import hashlib
import json
from pathlib import Path

import brotli
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE_COMMIT = "8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5"
SOURCE_SHA = "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9"
LICENSE_SHA = "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6"
FAMILY = "QuizForge Historical Preview Serif"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-font", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("public/assets/fonts/preview-v1"))
    args = parser.parse_args()
    if fontTools.__version__ != "4.61.1" or brotli.__version__ != "1.2.0":
        raise RuntimeError("PINNED_FONT_TOOLS_REQUIRED")
    source = args.source_font.read_bytes()
    if sha(source) != SOURCE_SHA:
        raise RuntimeError("FONT_SOURCE_HASH_MISMATCH")
    characters = Path("public/assets/fonts/preview-v1/characters.txt").read_bytes()
    license_bytes = Path("public/assets/fonts/preview-v1/OFL.txt").read_bytes()
    if sha(license_bytes) != LICENSE_SHA:
        raise RuntimeError("FONT_LICENSE_HASH_MISMATCH")
    requested = {ord(c) for c in characters.decode("utf-8").rstrip("\n")}
    font = TTFont(args.source_font, recalcTimestamp=False)
    if requested - font.getBestCmap().keys():
        raise RuntimeError("SOURCE_GLYPH_MISSING")
    font = instantiateVariableFont(font, {"wght": 600}, inplace=True, optimize=True)
    for name_id, value in {1: FAMILY, 2: "SemiBold", 3: "QuizForgeHistoricalPreviewSerif-1.0.0", 4: FAMILY + " SemiBold", 6: "QuizForgeHistoricalPreviewSerif-SemiBold", 16: FAMILY, 17: "SemiBold"}.items():
        font["name"].setName(value, name_id, 3, 1, 0x409)
        font["name"].setName(value, name_id, 1, 0, 0)
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=requested)
    sub.subset(font)
    font.recalcTimestamp = False
    font.flavor = "woff2"
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output / "serif-600.woff2"
    font.save(target)
    actual = TTFont(target, recalcTimestamp=False).getBestCmap()
    if requested - actual.keys():
        raise RuntimeError("OUTPUT_GLYPH_MISSING")
    data = target.read_bytes()
    descriptor = {
        "id": "historical-preview-serif",
        "version": "1.0.0",
        "family": FAMILY,
        "weight": 600,
        "file": "/assets/fonts/preview-v1/serif-600.woff2",
        "fileSha256": sha(data),
        "bytes": len(data),
        "coverage": "/assets/fonts/preview-v1/characters.txt",
        "coverageSha256": sha(characters),
        "coveredCodepoints": len(requested),
        "license": "SIL OFL 1.1",
        "licenseFile": "/assets/fonts/preview-v1/OFL.txt",
        "licenseSha256": LICENSE_SHA,
        "sourceRepository": "https://github.com/google/fonts",
        "sourceCommit": SOURCE_COMMIT,
        "sourceFile": "ofl/notoserifsc/NotoSerifSC[wght].ttf",
        "sourceSha256": SOURCE_SHA,
        "tools": {"fonttools": fontTools.__version__, "brotli": brotli.__version__},
        "audit": {"missingCodepoints": [], "knownMissingSevenNowCovered": all(ord(c) in actual for c in "守序织传周归邀")},
        "scope": "Fixed declared subset; no arbitrary Chinese coverage claim. Visual and PNG checks remain required.",
    }
    (args.output / "manifest.json").write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"bytes": len(data), "coveredCodepoints": len(requested), "fileSha256": sha(data), "missing": 0}))


if __name__ == "__main__":
    main()
