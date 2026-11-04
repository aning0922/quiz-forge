import type { QianzaiMusicTrack } from "./music-owner";
/** One original private-test candidate. Metadata is public source; raw audio stays
 * outside Git/public/build output. This is not author listening or release approval. */
export const QIANZAI_MUSIC = Object.freeze({
  id: "moonlit-water",
  version: "1.0.0",
  title: "月汀灯影",
  url: "/qianzai-test-audio/moonlit-water/1.0.0",
  file: "moonlit-water-final.m4a",
  mediaType: "audio/mp4",
  bytes: 870273,
  sha256: "157fb0d4ee2cfdada45fe32e48fd4f1d11879eb56dc101c169c3ff530a1afb5a",
  durationSeconds: 64,
  status: "original-private-test-candidate",
} as const satisfies QianzaiMusicTrack & {
  title: string;
  file: string;
  status: string;
});
