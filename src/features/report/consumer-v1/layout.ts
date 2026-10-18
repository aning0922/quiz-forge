import type { DisplayPosterExportBodyV1 } from "@/lib/assessment-contract/display-v1";
export const CONSUMER_REPORT_MARK = "内测报告／已完成";
export type TextBlock = Readonly<{
  text: string;
  x: number;
  y: number;
  size: number;
  maxWidth: number;
}>;
type Measure = (text: string, size: number) => number;
/** No clipping, ellipsis, character dropping, font shrinking, or dimension selection. */
export function wrapPosterText(
  text: string,
  size: number,
  maxWidth: number,
  maxLines: number,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let current = "";
    for (const char of paragraph) {
      if (measure(char, size) > maxWidth) throw Error("POSTER_LIMIT_EXCEEDED");
      if (current && measure(current + char, size) > maxWidth) {
        lines.push(current);
        current = "";
      }
      current += char;
    }
    lines.push(current);
  }
  if (lines.length > maxLines) throw Error("POSTER_LIMIT_EXCEEDED");
  return lines;
}
export function layoutConsumerPosterV1(
  input: DisplayPosterExportBodyV1,
  measure: Measure,
): readonly TextBlock[] {
  const p = input.poster,
    blocks: TextBlock[] = [];
  let y = 1220;
  const add = (
    text: string,
    size: number,
    lineHeight: number,
    maxLines: number,
    gap: number,
  ) => {
    for (const line of wrapPosterText(text, size, 900, maxLines, measure)) {
      if (y + lineHeight > 1868) throw Error("POSTER_LIMIT_EXCEEDED");
      blocks.push(Object.freeze({ text: line, x: 90, y, size, maxWidth: 900 }));
      y += lineHeight;
    }
    y += gap;
  };
  add(p.displayName, 60, 76, 1, 4);
  add(p.subtitle, 30, 42, 1, 12);
  add(p.posterLine.text, 32, 44, 2, 10);
  // All actual dimensions, each on its own line. A fifth dimension never enters this DTO.
  for (const d of p.dimensions)
    add(`${d.label}  ${d.normalizedText}`, 26, 34, 1, 0);
  y += 12;
  add(p.posterDisclosure, 24, 32, 2, 8);
  add(CONSUMER_REPORT_MARK, 24, 32, 1, 0);
  return Object.freeze(blocks);
}
