import {
  PREVIEW_COMPONENT_IDS,
  PREVIEW_RENDERER,
} from "@/features/product/preview/descriptor";
import { previewLayoutPropsSchema } from "@/features/product/preview/display-shapes";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";

export type PreviewState = keyof typeof PREVIEW_COMPONENT_IDS;
/** Fixed projection capabilities. Browser component composition is a separate implementation milestone. */
export const PREVIEW_REGISTRY = Object.freeze({
  renderer: PREVIEW_RENDERER,
  contentSchemaVersion: "quizpack-content.v2",
  componentVersion: "2.0.0",
  propsSchemaVersion: "1.0.0",
  engines: Object.freeze([
    Object.freeze({ id: "dimensions", version: "1.0.0" }),
    Object.freeze({ id: "archetype", version: "1.0.0" }),
  ]),
  states: PREVIEW_COMPONENT_IDS,
});
/** Input is the projection's private strict snapshot, never a caller-selected registry. */
export function supportsPreviewContent(content: QuizPackContentV2): boolean {
  return (
    content.schemaVersion === PREVIEW_REGISTRY.contentSchemaVersion &&
    content.componentVersion === PREVIEW_REGISTRY.componentVersion &&
    PREVIEW_REGISTRY.engines.some(
      (engine) =>
        engine.id === content.engine.id &&
        engine.version === content.engine.version,
    ) &&
    (Object.keys(PREVIEW_COMPONENT_IDS) as PreviewState[]).every((state) => {
      const { component, props } = content.layouts[state];
      return (
        component.id === PREVIEW_COMPONENT_IDS[state] &&
        component.version === PREVIEW_REGISTRY.componentVersion &&
        component.propsSchemaVersion === PREVIEW_REGISTRY.propsSchemaVersion &&
        previewLayoutPropsSchema.safeParse(props).success
      );
    }) &&
    content.reportTemplates.every(
      (template) =>
        template.component.id === PREVIEW_COMPONENT_IDS.report &&
        template.component.version === PREVIEW_REGISTRY.componentVersion &&
        template.component.propsSchemaVersion ===
          PREVIEW_REGISTRY.propsSchemaVersion,
    )
  );
}
export function projectPreviewLayout<S extends PreviewState>(
  content: QuizPackContentV2,
  state: S,
) {
  const layout = content.layouts[state];
  return { component: layout.component, props: layout.props };
}
