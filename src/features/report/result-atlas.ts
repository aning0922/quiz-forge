/** Internal read-only visual proposal. Not a QuizPack schema or scoring engine. */
export interface ResultDimensionView {
  readonly dimensionId: string;
  readonly label: string;
  readonly normalizedScore: number;
  readonly interpretation: string;
  readonly scaleDescription: string;
  readonly displayOrder: number;
  readonly lowLabel: string;
  readonly highLabel: string;
}

export interface ResultAtlasView {
  readonly kind: "synthetic";
  readonly fixtureId: string;
  readonly dimensions: readonly ResultDimensionView[];
}

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Guard display data without clamping, rounding, normalizing or changing input order. */
export function prepareResultAtlas(
  atlas: ResultAtlasView,
): readonly ResultDimensionView[] {
  if (
    atlas.kind !== "synthetic" ||
    !hasText(atlas.fixtureId) ||
    !Array.isArray(atlas.dimensions) ||
    atlas.dimensions.length < 4 ||
    atlas.dimensions.length > 7
  )
    throw new Error("Unsupported synthetic atlas");
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const d of atlas.dimensions) {
    if (
      !d ||
      ![
        d.dimensionId,
        d.label,
        d.interpretation,
        d.scaleDescription,
        d.lowLabel,
        d.highLabel,
      ].every(hasText) ||
      !Number.isFinite(d.normalizedScore) ||
      d.normalizedScore < 0 ||
      d.normalizedScore > 100 ||
      !Number.isInteger(d.displayOrder) ||
      d.displayOrder < 0 ||
      ids.has(d.dimensionId) ||
      orders.has(d.displayOrder)
    ) {
      throw new Error("Invalid atlas dimension");
    }
    ids.add(d.dimensionId);
    orders.add(d.displayOrder);
  }
  return [...atlas.dimensions].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Explicit editorial references, not a highest-score ranking or matching algorithm. */
export function referencedDimensions(
  atlas: ResultAtlasView,
  ids: readonly string[],
): readonly ResultDimensionView[] {
  const dimensions = prepareResultAtlas(atlas);
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error("Invalid dimension references");
  return ids.map((id) => {
    const dimension = dimensions.find((item) => item.dimensionId === id);
    if (!dimension) throw new Error("Unknown dimension reference");
    return dimension;
  });
}
