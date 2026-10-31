/** A presentation crop of the known private Li Bai report reference.
 * Its baked blurred heading is not clean portrait artwork. Keep original bytes
 * and provenance; this finite mapping never accepts cropping instructions from
 * a QuizPack and does not constitute approval of final character artwork.
 */
export function qianzaiArtworkCrop(asset: {
  sha256: string;
  width: number;
  height: number;
}):
  | Readonly<{ x: number; y: number; width: number; height: number }>
  | undefined {
  if (
    asset.sha256 ===
      "de0e06800bc25f0cc53ad217c1ef2ff22126dc8780139e9ccdf0b05bd2e6780d" &&
    asset.width === 780 &&
    asset.height === 874
  )
    return { x: 0, y: 284, width: 780, height: 590 };
  return undefined;
}
