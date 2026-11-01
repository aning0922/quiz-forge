import exportParityFixture from "@/features/quizpack/content/qianzai-local-export-parity-fixture.json";
import localArtFixture from "@/features/quizpack/content/qianzai-local-art-fixture.json";
import localNameFixture from "@/features/quizpack/content/qianzai-local-name-fixture.json";
import centeredNameFixture from "@/features/quizpack/content/qianzai-local-centered-name-fixture.json";
import liQingzhaoOnlineFixture from "@/features/quizpack/content/qianzai-local-liqingzhao-online-fixture.json";
/** A finite presentation-only alias after explicit semantic comparison. No resource or source authority. */
export const QIANZAI_V11_CONTENT_SHA256 =
  "e81fad61f2258e44ba58fe84fda12fedccfb0d7517e97546010f4fa35cfbe767";
export function qianzaiPresentationSourceMatches(
  value: string | undefined,
): boolean {
  return (
    value === QIANZAI_V11_CONTENT_SHA256 ||
    value === exportParityFixture.canonicalContentSha256 ||
    value === localArtFixture.canonicalContentSha256 ||
    value === localNameFixture.canonicalContentSha256 ||
    value === centeredNameFixture.canonicalContentSha256 ||
    value === liQingzhaoOnlineFixture.canonicalContentSha256
  );
}
