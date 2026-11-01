/** Fixed 2/3/4-character program lettering sample, not an authored calligraphy asset. */
export function qianzaiBrushNameGlyphs(
  name: string,
  box: Readonly<{ x: number; y: number; width: number; height: number }>,
) {
  const chars = [...name];
  if (chars.length < 2 || chars.length > 4) return null;
  const size = Math.floor(
    Math.min(box.width * 0.78, box.height / (chars.length + 0.3)),
  );
  return chars.map((text, i) => ({
    text,
    size,
    centerX: box.x + box.width / 2,
    centerY:
      box.y + box.height / 2 + (i - (chars.length - 1) / 2) * size * 1.04,
  }));
}
