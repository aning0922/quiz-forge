import { createSyntheticFixture } from "../v1/fixtures/synthetic";
import type { ContentReference } from "../v1/content";
import type { QuizPackContentV2 } from "./v2";

export const asRef = ({
  id,
  productId,
  version,
}: ContentReference): ContentReference => ({ id, productId, version });
/** Declaration-only synthetic test. No new package, media execution or artwork license. */
export async function createContentV2Fixture(
  engine: "dimensions" | "archetype" = "archetype",
): Promise<QuizPackContentV2> {
  const { content } = await createSyntheticFixture(engine);
  const scene = {
    ...structuredClone(content.resources[0]!),
    id: "neutral-scene",
    path: "assets/neutral-scene.png",
    purpose: "decoration" as const,
  };
  const resources = [...content.resources, scene];
  const cover = asRef(resources[0]!),
    sceneRef = asRef(scene);
  const portraits = content.results.map((result) => result.portraitRef);
  const layouts = Object.fromEntries(
    Object.entries(content.layouts).map(([state, layout]) => [
      state,
      {
        ...layout,
        component: { ...layout.component, version: "2.0.0" },
        resourceRefs:
          state === "cover"
            ? [cover]
            : state === "question"
              ? [sceneRef]
              : state === "resume"
                ? [cover, sceneRef]
                : portraits,
      },
    ]),
  );
  return {
    ...content,
    schemaVersion: "quizpack-content.v2",
    componentVersion: "2.0.0",
    resources,
    layouts: layouts as QuizPackContentV2["layouts"],
    reportTemplates: content.reportTemplates.map((report) => ({
      ...report,
      component: {
        ...report.component,
        version: "2.0.0",
        propsSchemaVersion: "1.0.0",
      },
    })),
    visualPresentation: {
      coverSceneRef: cover,
      sections: [
        {
          id: "first-hall",
          name: "第一厅",
          chapter: "入馆",
          introduction: "仅作结构测试。",
          sceneRef,
        },
      ],
      questionFrames: content.questions.map((question) => ({
        questionRef: asRef(question),
        sectionId: "first-hall",
        caption: "测试题签",
      })),
      resourceDescriptions: resources.map((resource) => ({
        resourceRef: asRef(resource),
        alt: "合成测试像素",
      })),
    },
    reportPresentation: {
      resultCards: content.results.map((result) => ({
        resultRef: asRef(result),
        displayName: result.label,
        subtitle: "结构测试",
        posterLine: { kind: "original", text: "仅作测试。" },
        posterDisclosure: "合成测试，非正式结果。",
      })),
    },
  };
}
