import { galleryRooms } from "../visual-v2-questions/rooms";
import type { CabinetPresentation } from "../visual-v2-questions/question";

/** Editorial chapter framing only. No weights, scores, result identity or answer inference. */
export const convergedPresentation: CabinetPresentation = {
  storageNamespace: "cabinet-converged",
  coverHref: "/studies/visual-v2-c",
  revealHref: "/studies/visual-v2-c/reveal",
  responsiveArt: true,
  rooms: galleryRooms.map((room, index) => ({
    ...room,
    chapter: ["起念与选择", "表达与留白", "同行与变化", "投入与告别"][index]!,
    line: [
      "从如何出发，慢慢看见自己的节奏。",
      "灯下成器，也为不同的声音留座。",
      "与人同行，容纳计划之外的雨。",
      "回看投入、承诺，与想留下的事。",
    ][index]!,
  })),
};
