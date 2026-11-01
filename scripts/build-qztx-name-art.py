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
WIDTH, HEIGHT, EM_PIXELS = 500, 700, 200
INK_WIDTH, INK_HEIGHT = 420, 580
# Build a diagonal name first, then fit and center the whole ink composition.
# Every glyph within a name receives one uniform scale; names may differ.
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
        raw = []
        for char, (cx, cy) in zip(name, CENTERS[len(name)]):
            if ord(char) not in cmap or cmap[ord(char)] == ".notdef":
                raise ValueError(f"MISSING_GLYPH:{char}")
            glyph = cmap[ord(char)]
            pen, bounds = SVGPathPen(glyphs), BoundsPen(glyphs)
            glyphs[glyph].draw(pen)
            glyphs[glyph].draw(bounds)
            x0, y0, x1, y1 = bounds.bounds
            tx, ty = cx - (x0 + x1) * scale / 2, cy + (y0 + y1) * scale / 2
            raw.append({"char": char, "glyph": glyph, "path": pen.getCommands(),
                        "tx": tx, "ty": ty, "center": [cx, cy],
                        "bounds": [tx + x0 * scale, ty - y1 * scale,
                                   tx + x1 * scale, ty - y0 * scale]})
        left = min(g["bounds"][0] for g in raw)
        top = min(g["bounds"][1] for g in raw)
        right = max(g["bounds"][2] for g in raw)
        bottom = max(g["bounds"][3] for g in raw)
        fit = min(INK_WIDTH / (right - left), INK_HEIGHT / (bottom - top))
        dx = WIDTH / 2 - (left + right) / 2 * fit
        dy = HEIGHT / 2 - (top + bottom) / 2 * fit
        paths, proof = [], []
        for index, g in enumerate(raw):
            path = (f'<g transform="translate({dx:.6f} {dy:.6f}) scale({fit:.6f})">'
                    f'<path d="{g["path"]}" transform="translate({g["tx"]:.6f} {g["ty"]:.6f}) scale({scale:.6f} {-scale:.6f})"/></g>')
            paths.append(path)
            glyph_file = out / f"{role}-glyph-{index}.svg"
            glyph_file.write_text(svg([path]))
            proof.append({"character": g["char"], "glyph": g["glyph"],
                          "scale": scale * fit,
                          "center": [g["center"][0] * fit + dx, g["center"][1] * fit + dy],
                          "source": glyph_file.name})
        source = out / f"{role}.svg"
        source.write_text(svg(paths))
        row = {"id": role, "displayName": name, "syntheticOnly": synthetic,
               "width": WIDTH, "height": HEIGHT, "sourceSvg": source.name,
               "sourceSvgSha256": sha(source.read_bytes()), "png": f"{role}.png",
               "wholeNameFit": {"scale": fit, "translate": [dx, dy]},
               "glyphPixelsPerEm": EM_PIXELS * fit, "glyphs": proof}
        if not synthetic:
            row["resultRef"] = {"productId": "qianzai-tongxin", "id": role, "version": "1.0.0"}
        rows.append(row)
    rasterizer = ROOT / "scripts/raster-qztx-name-art.mjs"
    manifest = {
        "schemaVersion": "qianzai-name-art-candidate.v3", "reviewStatus": "candidate",
        "layoutPolicy": "fit-and-center-whole-visible-name",
        "canvas": {"width": WIDTH, "height": HEIGHT},
        "inkBudget": {"width": INK_WIDTH, "height": INK_HEIGHT},
        "expectedAlphaCenter": [WIDTH / 2, HEIGHT / 2],
        "fontFileSha256": font_facts["fileSha256"], "fontLicense": "SIL OFL 1.1",
        "fontUnitsPerEm": em, "webDisplay": {"width": 180, "height": 252},
        "generatorSha256": sha(Path(__file__).read_bytes()),
        "rasterizerSha256": sha(rasterizer.read_bytes()),
        "tools": {"fonttools": fontTools.__version__},
        "roles": [r for r in rows if not r["syntheticOnly"]],
        "syntheticSamples": [r for r in rows if r["syntheticOnly"]],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    shutil.copyfile(font_path.with_name("OFL.txt"), out / "OFL-font-source.txt")
    subprocess.run(["node", str(rasterizer), str(out)], cwd=ROOT, check=True)
    print(out / "manifest.json")

if __name__ == "__main__":
    main()
