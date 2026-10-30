"""Build the QZTX body font from the already pinned, licensed upstream source.

The input character list is versioned; private manuscripts and the full source
TTF are not published. This font does not replace approved calligraphy artwork.
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


def sha(value):
    return hashlib.sha256(value).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-font", required=True, type=Path)
    parser.add_argument("--profile", choices=("v1", "v2", "v3", "v4"), default="v1")
    args = parser.parse_args()
    version = {"v1": "1.0.0", "v2": "1.1.0", "v3": "1.2.0", "v4": "1.3.0"}[args.profile]
    family = "QuizForge Qianzai Serif" + ("" if args.profile == "v1" else " " + args.profile.upper())
    out = Path(f"public/assets/fonts/qianzai-{args.profile}")
    if fontTools.__version__ != "4.61.1" or brotli.__version__ != "1.2.0":
        raise RuntimeError("PINNED_FONT_TOOLS_REQUIRED")
    if sha(args.source_font.read_bytes()) != SOURCE_SHA:
        raise RuntimeError("FONT_SOURCE_HASH_MISMATCH")
    license_bytes = (out / "OFL.txt").read_bytes()
    if sha(license_bytes) != LICENSE_SHA:
        raise RuntimeError("FONT_LICENSE_HASH_MISMATCH")
    characters = (out / "characters.txt").read_bytes()
    requested = {ord(c) for c in characters.decode("utf-8").rstrip("\n")}
    font = TTFont(args.source_font, recalcTimestamp=False)
    missing = requested - font.getBestCmap().keys()
    if missing:
        raise RuntimeError("SOURCE_GLYPH_MISSING:" + ",".join(hex(c) for c in sorted(missing)))
    font = instantiateVariableFont(font, {"wght": 600}, inplace=True, optimize=True)
    for name_id, value in {
        1: family, 2: "SemiBold", 3: f"QuizForgeQianzaiSerif-{version}",
        4: family + " SemiBold", 6: "QuizForgeQianzaiSerif-SemiBold" + ("" if args.profile == "v1" else args.profile.upper()),
        16: family, 17: "SemiBold",
    }.items():
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
    target = out / "serif-600.woff2"
    font.save(target)
    if requested - TTFont(target, recalcTimestamp=False).getBestCmap().keys():
        raise RuntimeError("OUTPUT_GLYPH_MISSING")
    data = target.read_bytes()
    descriptor = {
        "id": "qianzai-tongxin-serif", "version": version, "family": family,
        "weight": 600, "file": f"/assets/fonts/qianzai-{args.profile}/serif-600.woff2",
        "fileSha256": sha(data), "bytes": len(data),
        "coverage": f"/assets/fonts/qianzai-{args.profile}/characters.txt",
        "coverageSha256": sha(characters), "coveredCodepoints": len(requested),
        "license": "SIL OFL 1.1", "licenseFile": f"/assets/fonts/qianzai-{args.profile}/OFL.txt",
        "licenseSha256": LICENSE_SHA, "sourceRepository": "https://github.com/google/fonts",
        "sourceCommit": SOURCE_COMMIT, "sourceFile": "ofl/notoserifsc/NotoSerifSC[wght].ttf",
        "sourceSha256": SOURCE_SHA,
        "tools": {"fonttools": fontTools.__version__, "brotli": brotli.__version__},
        "audit": {"missingCodepoints": [], "allFiveCharacterNamesCovered": all(ord(c) in requested for c in "李白苏轼陶渊明李清照木兰")},
        "scope": "Declared QZTX body-copy subset, including pending copy candidates. No arbitrary Chinese or calligraphy coverage claim."
    }
    (out / "manifest.json").write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"bytes": len(data), "coveredCodepoints": len(requested), "fileSha256": sha(data), "missing": 0}))


if __name__ == "__main__":
    main()
