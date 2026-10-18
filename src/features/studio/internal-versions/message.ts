import { StudioClientError, studioMessage } from "../client";
import { InternalPendingError } from "./storage";
export function internalVersionMessage(error: unknown) {
  if (error instanceof InternalPendingError)
    return "无法可靠核对原请求锚点，或已有待核实请求。请保留会话存储；新准备保持关闭，原请求仍可只读核实。";
  if (error instanceof StudioClientError)
    switch (error.code) {
      case "WRITE_OUTCOME_UNKNOWN":
        return "本次提交未收到可确认的成功回执。请保留原 key 和完整目标，以原请求核实区的最新证据为准。";
      case "REVIEW_BASELINE_MISMATCH":
        return "此修订未精确匹配服务器已有的内测基线登记，不能记录为作者批准。原请求保持。";
      case "REVIEW_ALREADY_RECORDED":
        return "该固定目标已有基线记录。请核实原请求及唯一目标证据，不能将另一 key 的记录当成本请求成功。";
      case "VERSION_ALREADY_SEALED":
        return "该固定快照已有内测版本。请核实原请求及唯一快照证据，不能将另一 key 的版本当成本请求成功。";
      case "REVIEW_LIMIT":
        return "基线记录已达本批容量上限；原请求与历史记录仍可核实。";
      case "VERSION_LIMIT":
        return "内测版本已达本批容量上限。普通容量错误不能清除原锚点；请核实原请求的严格证据。";
      case "DRAFT_BASE_CONFLICT":
        return "提交时的当前修订不再符合原目标。原请求保持不变，请核实后再显式处理。";
      case "VERSION_DEPENDENCY_UNAVAILABLE":
        return "固定实现依赖暂不可用。历史身份和原请求仍保留，不自动改用最新实现。";
      case "VERSION_RESOURCE_UNAVAILABLE":
        return "固定资源暂未完成核验。不能推定请求已回滚，请保留原锚点并核实。";
      default:
        return studioMessage(error);
    }
  return studioMessage(error);
}
