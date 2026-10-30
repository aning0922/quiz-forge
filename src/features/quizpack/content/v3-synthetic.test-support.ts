import { createHash } from "node:crypto";
import sharp from "sharp";
import { syntheticEditorialV05 } from "./v3-fixtures.test-support";
import { convertEditorialV05 } from "./v3-editorial-import";
import { quizPackContentV3Schema, COMPOSED_VOLUME_IDS } from "./v3";
import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";

/** Invented 24-question content and deterministic generated pixels. No authored art or answers. */
export async function synthetic24ContentV3(productId = "synthetic-d2") {
  const source = syntheticEditorialV05();
  const vectors = [
    Array(5).fill(100),
    Array(5).fill(75),
    Array(5).fill(25),
    Array(5).fill(0),
    [81, 75, 75, 75, 75],
  ];
  source.personas.characters.forEach((p, i) => {
    p.vector = vectors[i]!;
  });
  const converted = convertEditorialV05({
    questionsJson: source.questionsJson,
    personasJson: JSON.stringify(source.personas),
    familiesJson: source.familiesJson,
    productId,
    version: "1.0.0",
    title: "Synthetic D2 assessment",
  });
  if (!converted.ok) throw Error("SYNTHETIC_CONVERSION_FAILED");
  const core = converted.value,
    ref = (id: string) => ({ id, productId, version: "1.0.0" });
  const bytes = await sharp(
    Buffer.from(Array.from({ length: 8 * 8 * 3 }, (_, i) => (i * 17) % 256)),
    { raw: { width: 8, height: 8, channels: 3 } },
  )
    .png()
    .toBuffer();
  const resource = (
    id: string,
    purpose: "cover" | "portrait" | "decoration",
  ) => ({
    ...ref(id),
    path: `assets/${id}.png`,
    mediaType: "image/png",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: 8,
    height: 8,
    purpose,
    source: {
      kind: "original",
      attribution: "QuizForge synthetic pixel generator",
      evidence: "Original deterministic fixture pixels; no character artwork.",
    },
    license: {
      commercialUse: true,
      redistribution: true,
      evidence: "Original synthetic test pixels; declaration only.",
    },
    approval: "pending",
  });
  const resources = [
    resource("cover", "cover"),
    resource("paper", "decoration"),
    ...Array.from({ length: 3 }, (_, i) =>
      resource(`scene-${i + 1}`, "decoration"),
    ),
    ...core.results.flatMap((r) => [
      resource(`portrait-${r.ref.id}`, "portrait"),
      resource(`name-${r.ref.id}`, "decoration"),
    ]),
  ];
  const characters = core.results.map((r) => ({
    resultRef: r.ref,
    reveal: ref(`portrait-${r.ref.id}`),
    nameArt: ref(`name-${r.ref.id}`),
    report: ref(`portrait-${r.ref.id}`),
    poster: ref(`portrait-${r.ref.id}`),
  }));
  const acts = Array.from({ length: 3 }, (_, i) => ({
    sectionId: `act-${i + 1}`,
    background: ref(`scene-${i + 1}`),
    questionPaper: ref("paper"),
    optionIdle: ref("paper"),
    optionSelected: ref("paper"),
  }));
  const sceneRefs = [...acts.map((a) => a.background), ref("paper")],
    portraits = characters.flatMap((c) => [c.reveal, c.nameArt]);
  const claims = core.questions.flatMap((q) =>
    q.options.map((o) => ({
      ref: ref(`claim-${o.ref.id}`),
      kind: "fact",
      dimensionRef: core.scoringDefinition.questions
        .find((v) => v.ref.id === q.ref.id)!
        .options.find((v) => v.ref.id === o.ref.id)!
        .contributions.find((c) => c.value !== 0)!.dimensionRef,
      direction: "high",
      text: "This choice was recorded in the stated scenario.",
      evidence: [
        { questionRef: q.ref, optionRef: o.ref, scope: `Scenario ${q.ref.id}` },
      ],
      counterevidence: [],
      when: {
        answers: [],
        selectedResultRef: null,
        scoreRange: null,
        nearTie: null,
      },
      literaryBridge: null,
    })),
  );
  const template = {
    ref: ref("template"),
    schemaVersion: "quiz-composed-template.v1",
    mode: "COMPOSED",
    claims,
    volumes: COMPOSED_VOLUME_IDS.map((id) => ({
      id,
      title: `Synthetic ${id}`,
      claimRefs:
        id === "dimensions"
          ? claims.slice(0, 32).map((c) => c.ref)
          : id === "patterns"
            ? claims.slice(32, 64).map((c) => c.ref)
            : id === "counterevidence"
              ? claims.slice(64).map((c) => c.ref)
              : [],
      maxClaims: 16,
      fallbackText:
        "Only the recorded scenario choices and the literary matching rule are available; no broader conclusion is asserted.",
    })),
  };
  const content = quizPackContentV3Schema.parse({
    schemaVersion: "quizpack-content.v3",
    core,
    bindings: {
      schemaVersion: "quizpack-bindings.v3",
      kind: "synthetic",
      visualVersion: "1.0.0",
      resourceVersion: "1.0.0",
      componentVersion: "1.0.0",
      reportVersion: "1.0.0",
      reportTemplates: [template],
      resultReports: core.results.map((r) => ({
        resultRef: r.ref,
        templateRef: template.ref,
      })),
      witnesses: {
        schemaVersion: "quiz-content-witnesses.v3",
        status: "declared-not-executed",
        entries: core.results.map((r, i) => ({
          expectedResultRef: r.ref,
          preference: "any",
          answers: core.questions.map((q, qi) => ({
            questionId: q.ref.id,
            optionId:
              q.options[
                i === 0
                  ? 3
                  : i === 1
                    ? 2
                    : i === 2
                      ? 1
                      : i === 3
                        ? 0
                        : qi === 0
                          ? 3
                          : 2
              ]!.ref.id,
          })),
        })),
      },
      slots: {
        neutral: {
          cover: ref("cover"),
          acts,
          reportPaper: ref("paper"),
          reportBorder: null,
          seal: null,
        },
        characters,
      },
      resources,
      layouts: Object.fromEntries(
        Object.entries(CONTENT_COMPONENTS_V3).map(([state, id]) => [
          state,
          {
            component: { id, version: "1.0.0", propsSchemaVersion: "1.0.0" },
            resourceRefs:
              state === "cover"
                ? [ref("cover")]
                : state === "question"
                  ? sceneRefs
                  : state === "resume"
                    ? [ref("cover"), ...sceneRefs]
                    : state === "result"
                      ? portraits
                      : [ref("paper"), ...portraits],
          },
        ]),
      ),
      visualPresentation: {
        coverSceneRef: ref("cover"),
        sections: acts.map((a, i) => ({
          id: a.sectionId,
          name: `Act ${i + 1}`,
          chapter: `Chapter ${i + 1}`,
          introduction: "Synthetic scenario introduction",
          sceneRef: a.background,
        })),
        questionFrames: core.questions.map((q) => ({
          questionRef: q.ref,
          sectionId: `act-${q.act}`,
          caption: "Synthetic question",
        })),
        resourceDescriptions: resources.map((r) => ({
          resourceRef: ref(r.id),
          alt: `Synthetic pixels ${r.id}`,
        })),
      },
    },
  });
  return {
    content,
    assets: content.bindings.resources.map((r) => ({
      path: r.path,
      bytes: new Uint8Array(bytes),
    })),
  };
}
