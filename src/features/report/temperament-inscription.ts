interface InscriptionBase {
  readonly id: string;
  readonly lines: readonly [string, string];
  readonly interpretation: string;
  /** An exact complete line from this inscription, not an invented quotation. */
  readonly posterLine: string;
}

export type TemperamentInscription = InscriptionBase &
  (
    | {
        readonly kind: "classical";
        readonly author: string;
        readonly work: string;
        readonly source: {
          readonly title: string;
          readonly url: string;
          readonly verifiedOn: string;
        };
      }
    | {
        readonly kind: "original";
        readonly credit: string;
      }
  );

export interface InscriptionCandidate {
  readonly inscription: TemperamentInscription;
  /** Editorial planning metadata only; not an implemented selector. */
  readonly forArchetypes: readonly string[];
  readonly relevantDimensionIds: readonly string[];
  readonly editorialIntent: string;
}

export function validateInscription(value: TemperamentInscription): boolean {
  const text = (item: unknown) =>
    typeof item === "string" && item.trim().length > 0;
  if (
    !text(value.id) ||
    !Array.isArray(value.lines) ||
    value.lines.length !== 2 ||
    !value.lines.every(text) ||
    !text(value.interpretation) ||
    !value.lines.includes(value.posterLine)
  )
    return false;
  if (value.kind === "original")
    return (
      text(value.credit) &&
      !("author" in value) &&
      !("work" in value) &&
      !("source" in value)
    );
  if (
    value.kind !== "classical" ||
    !text(value.author) ||
    !text(value.work) ||
    !value.source ||
    !text(value.source.title) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.source.verifiedOn)
  )
    return false;
  try {
    return new URL(value.source.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function inscriptionAttribution(value: TemperamentInscription): string {
  return value.kind === "classical"
    ? `${value.author}《${value.work}》`
    : `原创拟古 · ${value.credit}`;
}
