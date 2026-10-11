/** D0 proposal only. Runtime registry and configuration validation are not implemented. */
export interface TrustedComponentReference {
  registryId: string;
  componentVersion: string;
  propsSchemaVersion: string;
}

export type ProductPageState =
  "cover" | "question" | "resume" | "result" | "report" | "poster";

export interface ProductVisualBinding {
  visualVersion: string;
  themeId: string;
  themeVersion: string;
  assetPackVersions: readonly string[];
  layouts: Record<ProductPageState, TrustedComponentReference>;
  interactionRecipeId: string;
  interactionRecipeVersion: string;
}
