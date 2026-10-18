import { StudioClientError, studioMessage } from "../client";
import { DraftPendingError } from "./pending";
import { RevisionPendingError } from "../draft-revisions/pending";
export function draftMessage(error: unknown): string {
  if (error instanceof RevisionPendingError)
    return "此工作区有追加请求待核实，或追加锚点存储不可用。请先核实原请求，新准备已关闭。";
  if (error instanceof DraftPendingError)
    return "本页无法可靠保存或核对请求锚点。请保留当前会话存储，由维护者核实；不要建立新请求。";
  if (error instanceof StudioClientError)
    switch (error.code) {
      case "DRAFT_ALREADY_EXISTS":
        return "此工作区已有草稿。请查看服务器草稿；已有待确认请求仍须按原 key 核对。";
      case "DRAFT_SOURCE_CHANGED":
        return "来源验证修订已变化。请读取最新来源；原请求锚点继续保留。";
      case "DRAFT_SOURCE_INVALID":
        return "来源不符合首次草稿应用条件。请核实当前验证归档。";
      case "DRAFT_NOT_FOUND":
      case "DRAFT_REVISION_NOT_FOUND":
        return "服务器未找到此草稿或固定修订。";
      case "IDEMPOTENCY_CONFLICT":
        return "原 key 与服务器请求绑定不一致。请保留锚点，由维护者核实。";
      case "WRITE_OUTCOME_UNKNOWN":
        return "应用结果尚未确认。原 key 已保留；请先核对回执，或明确选择按原 key 重放。";
      case "WRITE_BUSY":
        return "服务器写入繁忙。请保留原 key，稍后核对回执或明确重放原请求。";
    }
  return studioMessage(error);
}
