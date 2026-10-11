import { notFound } from "next/navigation";
import { historicalReportFixture } from "@/features/report/historical-fixture";
import { historicalAtlasFixture } from "@/features/report/historical-atlas-fixture";
import { historicalVisualCopyFixture } from "@/features/report/historical-visual-copy";
import {
  getStudyInscription,
  inscriptionVariants,
  type InscriptionVariant,
} from "@/features/report/historical-inscriptions";
import {
  historicalArtLongReportFixture,
  historicalArtLongInscriptionFixture,
} from "@/features/report/historical-art-layout-fixture";
import { ArtStudy } from "@/features/theme/historical/visual-v2-b/art-study";
import {
  artDirections,
  type ArtDirection,
  type ArtView,
} from "@/features/theme/historical/visual-v2-b/art-direction";

export const metadata = { title: "千载同心 · 人物相逢" };

export default async function ArtStudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ direction: string; view: string }>;
  searchParams: Promise<{ inscription?: string; sample?: string }>;
}) {
  const { direction, view } = await params;
  const { inscription: variant = "classical", sample = "default" } =
    await searchParams;
  if (
    !artDirections.includes(direction as ArtDirection) ||
    !["reveal", "report", "poster"].includes(view) ||
    !inscriptionVariants.includes(variant as InscriptionVariant) ||
    !["default", "long"].includes(sample)
  )
    notFound();
  // Explicit layout stress sample only: no answers, scoring, storage, random or AI service.
  const report =
    sample === "long"
      ? historicalArtLongReportFixture
      : historicalReportFixture;
  const inscription =
    sample === "long" && variant !== "none"
      ? historicalArtLongInscriptionFixture
      : getStudyInscription(variant as InscriptionVariant);
  const query = `?inscription=${variant}${sample === "long" ? "&sample=long" : ""}`;
  return (
    <ArtStudy
      direction={direction as ArtDirection}
      view={view as ArtView}
      report={report}
      copy={historicalVisualCopyFixture}
      atlas={historicalAtlasFixture}
      inscription={inscription}
      query={query}
    />
  );
}
