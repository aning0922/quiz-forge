/** Public marketing artwork only. Source files remain outside the repository. */
export type PlatformArt = Readonly<{
  id: string;
  file: string;
  mediaType: "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}>;
export const PLATFORM_ART: readonly PlatformArt[] = Object.freeze([
  {
    id: "home",
    file: "home-v2.png",
    bytes: 2362951,
    width: 766,
    height: 1377,
    sha256: "3329b663b3030affbed0a71c526c9b8972d868912f6fad3719697a331d03ca80",
    mediaType: "image/png",
  },
  {
    id: "qian",
    file: "qian-v2.png",
    bytes: 1253190,
    width: 708,
    height: 592,
    sha256: "ce9652919d664916c0a986a0989f5548929b62ecc4d9fb2064369e44a6872a11",
    mediaType: "image/png",
  },
  {
    id: "cover",
    file: "cover-v8.png",
    bytes: 979137,
    width: 390,
    height: 844,
    sha256: "955ff7577cb47f6e9a35103f4efc972e62596c82df4dcc5d284b29a26225436d",
    mediaType: "image/png",
  },
  {
    id: "heart",
    file: "heart.png",
    bytes: 118733,
    width: 354,
    height: 208,
    sha256: "c582741251343ab77c079d997740c4ab47c1c2925b1967a116d594e30a2ef8c5",
    mediaType: "image/png",
  },
  {
    id: "cat",
    file: "cat.png",
    bytes: 104944,
    width: 341,
    height: 208,
    sha256: "b059dcbd7f3cc508c4cfd242b393ddef8f18537f3f817d031155fb0d6a4b5e67",
    mediaType: "image/png",
  },
]);
export function findPlatformArt(id: string) {
  return PLATFORM_ART.find((art) => art.id === id);
}
