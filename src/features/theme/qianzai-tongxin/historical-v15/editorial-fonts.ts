import type { DisplayFontDescriptorV1 } from "@/lib/assessment-contract/display-v1";
import fonts from "./editorial-fonts.json";

/** Compiled local assets only. This is not a QuizPack or HTTP font contract. */
export type QianzaiEditorialFont = Omit<DisplayFontDescriptorV1, "weight"> & {
  readonly weight: 400;
};
const fixed = (
  value: (typeof fonts)[keyof typeof fonts],
): QianzaiEditorialFont => {
  if (
    value.weight !== 400 ||
    !value.file.startsWith("/assets/fonts/qianzai-") ||
    !value.coverage.startsWith("/assets/fonts/qianzai-") ||
    !value.licenseFile.startsWith("/assets/fonts/qianzai-")
  )
    throw Error("INVALID_FIXED_EDITORIAL_FONT");
  return Object.freeze(value) as QianzaiEditorialFont;
};
export const QIANZAI_EDITORIAL_FONTS = Object.freeze({
  brush: fixed(fonts.brush),
  literary: fixed(fonts.literary),
});
