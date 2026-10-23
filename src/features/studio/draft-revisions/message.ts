import { StudioClientError, studioMessage } from "../client";
import { draftMessage } from "../drafts/message";
import { RevisionPendingError } from "./pending";
export function revisionMessage(error: unknown): string {
  if (error instanceof RevisionPendingError)
    return "无法可靠核对操作记录，或此工作区还有原操作待核实。请保留会话存储，先核实原操作；新准备已关闭。";
  if (error instanceof StudioClientError)
    switch (error.code) {
      case "DRAFT_BASE_CONFLICT":
        return "草稿基准已变化。原操作保持不变，请先核实原操作，不能直接替换基准重发。";
      case "DRAFT_SOURCE_ALREADY_APPLIED":
        return "此来源已经应用。请核实原操作及重复来源证据，再明确解除本地操作记录并选择其他来源。";
      case "DRAFT_REVISION_LIMIT":
        return "草稿已达到本批 100 个修订的容量上限。旧修订仍可阅读。";
      case "DRAFT_SOURCE_INVALID":
        return "来源不符合追加条件。请核实验证归档；原操作记录保持。";
      case "WRITE_OUTCOME_UNKNOWN":
        return "上次操作结果暂未确认，请先查询处理结果，确认前避免重复提交。原内容来源与基准会保留；如需再次发送，须由你明确选择原操作。";
      case "CAPABILITY_DENIED":
        return "当前身份没有草稿写权限。仍可核实原操作、阅读当前与历史修订。";
      default:
        return draftMessage(error);
    }
  return studioMessage(error);
}
