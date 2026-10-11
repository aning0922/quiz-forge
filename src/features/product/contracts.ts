/** D0 proposal only. Published product releases will be immutable. */
export interface ProductVersionBinding {
  productId: string;
  productVersion: string;
  quizPackId: string;
  quizPackVersion: string;
  quizVersionId: string;
  visualVersionId: string;
  reportTemplateVersionId: string;
  state: "draft" | "review" | "published" | "archived";
}
