import {
  syntheticV2,
  syntheticRef as r,
} from "@/features/quiz/scoring/v2/fixtures.test-support";
import {
  COMPOSED_VOLUME_IDS,
  composedClaimV1Schema,
  quizPackContentV3Schema,
  contentCoreV3Schema,
  type ComposedClaimV1,
} from "./v3";
import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";

export function syntheticCoreV3() {
  const scoringDefinition = syntheticV2(1, 3);
  return contentCoreV3Schema.parse({
    schemaVersion: "quizpack-core.v3",
    title: "Synthetic assessment",
    scoringDefinition,
    dimensions: scoringDefinition.dimensions.map((v) => ({
      ref: v.ref,
      label: "Strategy preference",
    })),
    questions: scoringDefinition.questions.map((q, i) => ({
      ref: q.ref,
      prompt: `Synthetic scenario ${i}`,
      act: 1,
      options: q.options.map((o, oi) => ({
        ref: o.ref,
        label: `Synthetic choice ${i}/${oi}`,
      })),
    })),
    results: scoringDefinition.profiles.map((p) => ({
      ref: p.resultRef,
      label: p.resultRef.id,
    })),
    evidenceFamilies: {
      version: "1.0.0",
      entries: scoringDefinition.questions.map((q, i) => ({
        questionRef: q.ref,
        dimensionRef: r("axis-0"),
        family: `family-${i}`,
        core: true,
      })),
    },
    provenance: [
      { kind: "questions", sha256: "1".repeat(64) },
      { kind: "personas", sha256: "2".repeat(64) },
    ],
  });
}
export function syntheticClaim(kind: ComposedClaimV1["kind"] = "summary") {
  const evidence = (q: number, oi = 2) => ({
    questionRef: r(`q-${q}`),
    optionRef: r(`q-${q}-o-${oi}`),
    scope: `Synthetic context ${q}`,
  });
  return composedClaimV1Schema.parse({
    ref: r("claim"),
    kind,
    dimensionRef: r("axis-0"),
    direction: "high",
    text: "Bounded synthetic statement",
    evidence: kind === "context" ? [evidence(0)] : [evidence(0), evidence(1)],
    counterevidence: kind === "context" ? [evidence(1, 0)] : [],
    when: {
      answers: [],
      selectedResultRef: null,
      scoreRange: null,
      nearTie: null,
    },
    literaryBridge: null,
  });
}
export function syntheticContentV3(claim = syntheticClaim()) {
  const core = syntheticCoreV3();
  const characters = core.results.map((v) => ({
    resultRef: v.ref,
    reveal: r(`portrait-${v.ref.id}`),
    nameArt: r(`name-${v.ref.id}`),
    report: r(`portrait-${v.ref.id}`),
    poster: r(`portrait-${v.ref.id}`),
  }));
  const portraits = characters.flatMap((c) => [c.report, c.nameArt]);
  const resource = (
    id: string,
    purpose: "cover" | "portrait" | "decoration",
  ) => ({
    ...r(id),
    path: `assets/${id}.png`,
    mediaType: "image/png",
    bytes: 1,
    sha256: "a".repeat(64),
    width: 1,
    height: 1,
    purpose,
    source: {
      kind: "original",
      attribution: "Synthetic test only",
      evidence: "Synthetic fixture",
    },
    license: {
      commercialUse: true,
      redistribution: true,
      evidence: "Synthetic fixture",
    },
    approval: "approved",
  });
  return quizPackContentV3Schema.parse({
    schemaVersion: "quizpack-content.v3",
    core,
    bindings: {
      schemaVersion: "quizpack-bindings.v3",
      kind: "synthetic",
      visualVersion: "1.0.0",
      resourceVersion: "1.0.0",
      componentVersion: "1.0.0",
      witnesses: {
        schemaVersion: "quiz-content-witnesses.v3",
        status: "declared-not-executed",
        entries: core.scoringDefinition.profiles.map((p) => ({
          expectedResultRef: p.resultRef,
          preference: p.sex,
          answers: core.questions.map((q) => ({
            questionId: q.ref.id,
            optionId: q.options[2]!.ref.id,
          })),
        })),
      },
      reportVersion: "1.0.0",
      reportTemplates: [
        {
          ref: r("template"),
          schemaVersion: "quiz-composed-template.v1",
          mode: "COMPOSED",
          claims: [claim],
          volumes: COMPOSED_VOLUME_IDS.map((id) => ({
            id,
            title: id,
            claimRefs: [claim.ref],
            maxClaims: 1,
            fallbackText: "Only the recorded scenario choices are available.",
          })),
        },
      ],
      resultReports: core.results.map((v) => ({
        resultRef: v.ref,
        templateRef: r("template"),
      })),
      slots: {
        neutral: {
          cover: r("cover"),
          acts: [
            {
              sectionId: "act-one",
              background: r("scene"),
              questionPaper: r("scene"),
              optionIdle: r("scene"),
              optionSelected: r("scene"),
            },
          ],
          reportPaper: r("scene"),
          reportBorder: null,
          seal: null,
        },
        characters,
      },
      resources: [
        resource("cover", "cover"),
        resource("scene", "decoration"),
        ...core.results.flatMap((v) => [
          resource(`portrait-${v.ref.id}`, "portrait"),
          resource(`name-${v.ref.id}`, "decoration"),
        ]),
      ],
      layouts: Object.fromEntries(
        ["cover", "question", "resume", "result", "report", "poster"].map(
          (state) => [
            state,
            {
              component: {
                id: CONTENT_COMPONENTS_V3[
                  state as keyof typeof CONTENT_COMPONENTS_V3
                ],
                version: "1.0.0",
                propsSchemaVersion: "1.0.0",
              },
              resourceRefs:
                state === "cover"
                  ? [r("cover")]
                  : state === "question"
                    ? [r("scene")]
                    : state === "resume"
                      ? [r("cover"), r("scene")]
                      : state === "result"
                        ? portraits
                        : [r("scene"), ...portraits],
            },
          ],
        ),
      ),
      visualPresentation: {
        coverSceneRef: r("cover"),
        sections: [
          {
            id: "act-one",
            name: "Synthetic act",
            chapter: "One",
            introduction: "Synthetic introduction",
            sceneRef: r("scene"),
          },
        ],
        questionFrames: core.questions.map((q) => ({
          questionRef: q.ref,
          sectionId: "act-one",
          caption: "Synthetic",
        })),
        resourceDescriptions: [
          "cover",
          "scene",
          ...portraits.map((p) => p.id),
        ].map((id) => ({
          resourceRef: r(id),
          alt: `Synthetic ${id}`,
        })),
      },
    },
  });
}
/** Invented content only; nothing copied from authored questions or artwork. */
export function syntheticEditorialV05() {
  const axes = ["Axis A", "Axis B", "Axis C", "Axis D", "Axis E"];
  const dims = Array.from({ length: 24 }, (_, i) =>
    i < 20
      ? [axes[i % 5]!]
      : [
          [axes[0]!, axes[1]!],
          [axes[1]!, axes[2]!],
          [axes[2]!, axes[3]!],
          [axes[3]!, axes[4]!],
        ][i - 20]!,
  );
  const questions = {
    assumed_scoring: {
      axes,
      core_weight: 1,
      cross_axis_weight: 0.5,
      rounding: "ties-to-even (the V0.3 demonstration baseline)",
      formula:
        "score_d = round_even(50 + 25 * SUM(w_q,d * effect_q,d) / SUM(w_q,d))",
    },
    questions: dims.map((dimensions, i) => ({
      id: `Q${String(i + 1).padStart(2, "0")}`,
      act: Math.floor(i / 8) + 1,
      dimensions,
      prompt: `Invented question ${i + 1}`,
      options: [-2, -1, 1, 2].map((value, oi) => ({
        key: ["A", "B", "C", "D"][oi]!,
        text: `Invented choice ${oi}`,
        effects: Object.fromEntries(dimensions.map((d) => [d, value])),
      })),
    })),
  };
  const personas = {
    model: {
      dimensions: axes,
      raw_distance: "D=mean_d |user_score_d-role_anchor_d|",
      ranking: "ascending D; exact tie = stable role id",
      near_tie_threshold_raw_distance: 4,
      gender_filter: "candidate pool only, no score changes",
    },
    characters: Array.from({ length: 5 }, (_, i) => ({
      id: `role_${i}`,
      name: `Invented role ${i}`,
      sex: i === 0 || i === 2 ? "male" : "female",
      kind: i === 4 ? "legendary_literary" : "documented_historical",
      vector: Array(5).fill(100 - i * 20),
    })),
  };
  const families = {
    family_mapping: Object.fromEntries(
      questions.questions.map((q, i) => [
        q.id,
        Object.fromEntries(q.dimensions.map((d) => [d, `family-${i}`])),
      ]),
    ),
  };
  return {
    questions,
    personas,
    families,
    questionsJson: JSON.stringify(questions),
    personasJson: JSON.stringify(personas),
    familiesJson: JSON.stringify(families),
    productId: "synthetic-editorial",
    version: "1.0.0",
    title: "Synthetic import",
  };
}
