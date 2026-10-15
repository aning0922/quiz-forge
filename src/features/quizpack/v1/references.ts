import type { PackIssue } from "./api";
import type { QuizPackContent } from "./content";
import { P1_STATE_COMPONENT_CONTRACTS } from "./compatibility";
import type { QuizPackManifest } from "./manifest";
import { validateContentGraph } from "../content/reference-graph";

/** P1 retains manifest/file declarations and its original state contracts. */
export function validateContentReferences(
  manifest: QuizPackManifest,
  content: QuizPackContent,
  targetProductId: string,
): PackIssue[] {
  return validateContentGraph(
    content,
    targetProductId,
    P1_STATE_COMPONENT_CONTRACTS,
    manifest,
  );
}
