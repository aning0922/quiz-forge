"""Build new candidate PNG name art from pinned OFL glyph outlines, without AI.
Run with fontTools installed and this repository's locked Node dependencies.
The output is private local material for review, never an admission declaration.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import fontTools
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT, EM_PIXELS = 500, 880, 200
# Only translations differ. Every glyph retains the exact same outline scale.
CENTERS = {
    2: [(180, 135), (300, 345)],
    3: [(180, 135), (240, 345), (300, 555)],
    4: [(180, 135), (220, 345), (260, 555), (300, 765)],
}
ROLES = [
    ("li-bai", "李白"), ("su-shi", "苏轼"),
    ("tao-yuanming", "陶渊明"), ("li-qingzhao", "李清照"),
    ("mulan-ballad", "木兰"),
]
GOLD = '<defs><linearGradient id="gold" x1="0" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="#fff5cd"/><stop offset=".28" stop-color="#f0d397"/><stop offset=".62" stop-color="#d6a348"/><stop offset=".83" stop-color="#f5d99b"/><stop offset="1" stop-color="#c58c38"/></linearGradient></defs>'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def svg(paths):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">{GOLD}<g fill="url(#gold)">{"".join(paths)}</g></svg>'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    out = args.out.resolve()
    if not out.is_relative_to(ROOT / ".cache") or out.exists():
        parser.error("output must be a new directory under this repository's .cache")
    font_path = ROOT / "public/assets/fonts/qianzai-brush-v1/regular.woff2"
    font_facts = json.loads(font_path.with_name("manifest.json").read_text())
    if sha(font_path.read_bytes()) != font_facts["fileSha256"]:
        raise ValueError("FONT_SOURCE_SHA_CHANGED")
    if fontTools.__version__ != "4.61.1":
        raise ValueError("PINNED_FONTTOOLS_REQUIRED:4.61.1")
    font = TTFont(font_path)
    glyphs, cmap, em = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    scale = EM_PIXELS / em
    out.mkdir(parents=True)
    rows = []
    # The four-character example is deliberately separate from the five role rows.
    samples = [(role, name, False) for role, name in ROLES] + [("synthetic-four-character", "千载同心", True)]
    for role, name, synthetic in samples:
        paths, proof = [], []
        for index, (char, (cx, cy)) in enumerate(zip(name, CENTERS[len(name)])):
            if ord(char) not in cmap or cmap[ord(char)] == ".notdef":
                raise ValueError(f"MISSING_GLYPH:{char}")
            glyph = cmap[ord(char)]
            pen, bounds = SVGPathPen(glyphs), BoundsPen(glyphs)
            glyphs[glyph].draw(pen)
            glyphs[glyph].draw(bounds)
            x0, y0, x1, y1 = bounds.bounds
            tx, ty = cx - (x0 + x1) * scale / 2, cy + (y0 + y1) * scale / 2
            path = f'<path d="{pen.getCommands()}" transform="translate({tx:.6f} {ty:.6f}) scale({scale:.6f} {-scale:.6f})"/>'
            paths.append(path)
            glyph_file = out / f"{role}-glyph-{index}.svg"
            glyph_file.write_text(svg([path]))
            proof.append({"character": char, "glyph": glyph, "scale": scale, "center": [cx, cy], "source": glyph_file.name})
        source = out / f"{role}.svg"
        source.write_text(svg(paths))
        row = {"id": role, "displayName": name, "syntheticOnly": synthetic, "width": WIDTH, "height": HEIGHT, "sourceSvg": source.name, "sourceSvgSha256": sha(source.read_bytes()), "png": f"{role}.png", "glyphs": proof}
        if not synthetic:
            row["resultRef"] = {"productId": "qianzai-tongxin", "id": role, "version": "1.0.0"}
        rows.append(row)
    rasterizer = ROOT / "scripts/raster-qztx-name-art.mjs"
    manifest = {"schemaVersion": "qianzai-name-art-candidate.v2", "reviewStatus": "candidate", "canvas": {"width": WIDTH, "height": HEIGHT}, "fontFileSha256": font_facts["fileSha256"], "fontLicense": "SIL OFL 1.1", "fontUnitsPerEm": em, "glyphScale": scale, "glyphPixelsPerEm": EM_PIXELS, "webDisplay": {"width": 200, "height": 352, "pixelsPerEm": 80}, "generatorSha256": sha(Path(__file__).read_bytes()), "rasterizerSha256": sha(rasterizer.read_bytes()), "tools": {"fonttools": fontTools.__version__}, "roles": [r for r in rows if not r["syntheticOnly"]], "syntheticSamples": [r for r in rows if r["syntheticOnly"]]}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    shutil.copyfile(font_path.with_name("OFL.txt"), out / "OFL-font-source.txt")
    subprocess.run(["node", str(rasterizer), str(out)], cwd=ROOT, check=True)
    print(out / "manifest.json")

if __name__ == "__main__":
    main()
