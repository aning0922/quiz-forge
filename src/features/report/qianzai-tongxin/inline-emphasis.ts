export type QianzaiInlineText = Readonly<{ text: string; strong: boolean }>;

/** Only balanced same-line **text** is emphasis. Other syntax stays literal. */
export function qianzaiInlineEmphasis(
  text: string,
): readonly QianzaiInlineText[] {
  const parts: QianzaiInlineText[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/(^|[^*\\])\*\*([^*\r\n]+)\*\*(?!\*)/g)) {
    const start = match.index! + match[1]!.length;
    if (start > cursor)
      parts.push({ text: text.slice(cursor, start), strong: false });
    parts.push({ text: match[2]!, strong: true });
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), strong: false });
  return parts;
}

export const qianzaiPlainReportText = (text: string): string =>
  qianzaiInlineEmphasis(text)
    .map((part) => part.text)
    .join("");
