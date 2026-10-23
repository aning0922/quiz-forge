import { StudioClientError, studioMessage } from "../client";
import { InternalPendingError } from "./storage";
export function internalVersionMessage(error: unknown) {
  if (error instanceof InternalPendingError)
    return "无法可靠读取上次操作记录，或有操作仍待确认。请保留当前浏览器记录，先查询处理结果；确认前不能新增操作。";
  if (error instanceof StudioClientError)
    switch (error.code) {
      case "WRITE_BUSY":
        return "写入暂忙。请保留原操作记录并核实，不自动重试或推定回滚。";
      case "WRITE_OUTCOME_UNKNOWN":
        return "上次操作结果暂未确认，请先查询处理结果，确认前避免重复提交。原操作记录会保留；如需再次发送，须由你明确选择原操作。";
      case "REVIEW_BASELINE_MISMATCH":
        return "此修订未精确匹配服务器已有的内测基线登记，不能记录为作者批准。原操作保持。";
      case "REVIEW_ALREADY_RECORDED":
        return "该固定目标已有审核依据记录。请核实原操作及唯一目标证据，不能将另一操作的记录当成本请求成功。";
      case "VERSION_ALREADY_SEALED":
        return "该固定快照已有内测版本。请核实原操作及唯一快照证据，不能将另一操作的版本当成本请求成功。";
      case "REVIEW_LIMIT":
        return "审核依据记录已达本批容量上限；原操作与历史记录仍可核实。";
      case "VERSION_LIMIT":
        return "内测版本已达本批容量上限。普通容量错误不能清除原操作记录；请核实原操作的严格证据。";
      case "DRAFT_BASE_CONFLICT":
        return "提交时的当前修订不再符合原目标。原操作保持不变，请核实后再显式处理。";
      case "VERSION_DEPENDENCY_UNAVAILABLE":
        return "固定实现依赖暂不可用。历史身份和原操作仍保留，不自动改用最新实现。";
      case "VERSION_RESOURCE_UNAVAILABLE":
        return "固定资源暂未完成核验。不能推定请求已回滚，请保留原操作记录并核实。";
      default:
        return studioMessage(error);
    }
  return studioMessage(error);
}
