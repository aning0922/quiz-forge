import { previewApiPath } from "./urls";
import type { PreviewScope } from "./contracts";
export const currentPreviewApiPath = (
  scope: PreviewScope,
  action: "entry" | "score" = "entry",
) => previewApiPath(scope) + "/current" + (action === "score" ? "/score" : "");
