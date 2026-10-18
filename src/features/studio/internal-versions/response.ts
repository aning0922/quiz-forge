import { INTERNAL_VERSION_LIMITS as L } from "@/features/product/internal-versions/contracts";
import {
  readBoundedDraftJson,
  type DraftResponseBudget,
} from "../drafts/response";
/** The original request deadline also bounds the body; no fresh read budget is started. */
export function readInternalResponse(
  response: Response,
  maximum: number,
  budget: DraftResponseBudget,
) {
  if (
    ![L.responseBytes, L.listResponseBytes, L.errorResponseBytes].some(
      (value) => value === maximum,
    )
  )
    throw Error("INTERNAL_RESPONSE_BUDGET");
  return readBoundedDraftJson(response, maximum, budget);
}
