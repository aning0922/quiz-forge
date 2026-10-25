import { StudioClientError, studioMessage } from "../client";
import { DraftPendingError } from "./pending";
import { RevisionPendingError } from "../draft-revisions/pending";
export function draftMessage(error: unknown): string {
  if (error instanceof RevisionPendingError)
    return "上次草稿更新仍待确认，或本地操作记录无法读取。请先查询处理结果；确认前不能新增操作。";
  if (error instanceof DraftPendingError)
    return "无法可靠保存或读取上次草稿操作记录。请保留当前浏览器记录，联系维护者核实；确认前不要重新创建操作。";
  if (error instanceof StudioClientError)
    switch (error.code) {
      case "DRAFT_ALREADY_EXISTS":
        return "此工作区已有草稿。请查看当前草稿；已有待确认请求仍须按原操作查询。";
      case "DRAFT_SOURCE_CHANGED":
        return "来源验证修订已变化。请读取最新来源；原操作记录继续保留。";
      case "DRAFT_SOURCE_INVALID":
        return "来源不符合建立第一版草稿条件。请核实当前验证归档。";
      case "DRAFT_NOT_FOUND":
      case "DRAFT_REVISION_NOT_FOUND":
        return "服务器未找到此草稿或固定修订。";
      case "IDEMPOTENCY_CONFLICT":
        return "原操作记录与服务器请求绑定不一致。请保留本地操作记录，由维护者核实。";
      case "WRITE_OUTCOME_UNKNOWN":
        return "上次操作结果暂未确认，请先查询处理结果，确认前避免重复提交。如需再次发送，须明确选择原操作。";
      case "WRITE_BUSY":
        return "服务器写入繁忙。请保留原操作编号，稍后核对处理结果或明确再次发送原操作。";
    }
  return studioMessage(error);
}
