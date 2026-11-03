import {
  consumerExchangeInputSchema,
  consumerExchangeResultSchema,
  type ConsumerExchangeResult,
} from "@/features/fulfillment/consumer-flow/contracts";
import {
  consumerPlayPageUrl,
  consumerReportPageUrl,
} from "@/features/fulfillment/consumer-flow/urls";
import { ConsumerClientError } from "@/features/theme/consumer-v1/request";
import type { ConsumerErrorCode } from "@/lib/consumer-contract/v1/errors";

export type PlatformAccessState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "navigating" }
  | { phase: "cancelled" }
  | { phase: "error"; code: ConsumerErrorCode };
export type PlatformAccessEnvironment = Readonly<{
  exchange(
    rawKey: string,
    signal: AbortSignal,
  ): Promise<ConsumerExchangeResult>;
  navigate(path: string): void;
}>;
type Attempt = Readonly<{ epoch: number; abort: AbortController }>;
const idle = Object.freeze({ phase: "idle" as const });

/** Only non-secret status leaves this owner. Cancellation does not undo a server exchange. */
export class PlatformAccessController {
  #raw: string | null = null;
  #attempt: Attempt | null = null;
  #attached = false;
  #epoch = 0;
  #mount = 0;
  #state: PlatformAccessState = idle;
  #listeners = new Set<() => void>();
  constructor(private readonly environment: PlatformAccessEnvironment) {}
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = (): PlatformAccessState => this.#state;
  getServerSnapshot = (): PlatformAccessState => idle;
  #publish(state: PlatformAccessState) {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) listener();
  }
  #invalidate() {
    this.#epoch++;
    const previous = this.#attempt;
    this.#attempt = null;
    this.#raw = null;
    previous?.abort.abort();
  }
  attach = () => {
    const mount = ++this.#mount;
    this.#attached = true;
    if (this.#state.phase !== "idle") this.#publish(idle);
    return () => {
      if (mount !== this.#mount) return;
      this.#attached = false;
      this.#invalidate();
      this.#publish(idle);
    };
  };
  cancel = () => {
    const waiting = this.#attempt !== null;
    this.#invalidate();
    this.#publish(waiting ? { phase: "cancelled" } : idle);
  };
  edit = () => {
    if (this.#attached && this.#state.phase === "error") this.#publish(idle);
  };
  #owns(attempt: Attempt) {
    return (
      this.#attached &&
      this.#attempt === attempt &&
      this.#epoch === attempt.epoch &&
      !attempt.abort.signal.aborted
    );
  }
  async submit(rawKey: string): Promise<void> {
    if (!this.#attached || this.#attempt || this.#state.phase === "navigating")
      return;
    const input = consumerExchangeInputSchema.safeParse({ rawKey });
    if (!input.success) {
      this.#publish({ phase: "error", code: "INVALID_REQUEST" });
      return;
    }
    this.#raw = input.data.rawKey;
    const attempt: Attempt = {
      epoch: ++this.#epoch,
      abort: new AbortController(),
    };
    this.#attempt = attempt;
    this.#publish({ phase: "busy" });
    try {
      if (!this.#owns(attempt) || !this.#raw) return;
      const result = consumerExchangeResultSchema.parse(
        await this.environment.exchange(this.#raw, attempt.abort.signal),
      );
      if (!this.#owns(attempt)) return;
      this.#raw = null;
      const path =
        result.destination === "report"
          ? consumerReportPageUrl(result.session.sessionId)
          : consumerPlayPageUrl(result.session.sessionId);
      this.#publish({ phase: "navigating" });
      if (this.#owns(attempt)) this.environment.navigate(path);
    } catch (error) {
      if (!this.#owns(attempt)) return;
      this.#raw = null;
      this.#publish({
        phase: "error",
        code: error instanceof ConsumerClientError ? error.code : "UNAVAILABLE",
      });
    } finally {
      if (this.#attempt === attempt) {
        this.#raw = null;
        this.#attempt = null;
      }
    }
  }
}

/** Protocol facts only; no response messages or credentials are rendered. */
export function platformAccessMessage(state: PlatformAccessState): string {
  if (state.phase === "idle")
    return "输入完整兑换码，验证后进入对应测评或原报告。";
  if (state.phase === "busy") return "正在验证兑换码，请稍候。";
  if (state.phase === "navigating") return "验证通过，正在进入对应页面。";
  if (state.phase === "cancelled")
    return "本页已停止等待，但服务端可能已处理本次请求。可重新打开原私密链接；本页不会自动重复提交。";
  switch (state.code) {
    case "INVALID_REQUEST":
    case "PAYLOAD_TOO_LARGE":
      return "兑换码格式不正确，请重新输入完整兑换码。";
    case "KEY_NOT_ACTIVE":
      return "兑换码无效、已到期或已停用，请核对原始兑换码或联系提供方。";
    case "KEY_ALREADY_CLAIMED":
      return "该兑换码已有绑定访问。请使用原私密链接或原测评地址继续访问。";
    case "PRODUCT_ARCHIVED":
      return "对应测评已归档，当前无法兑换，请联系提供方。";
    case "SOURCE_OBSOLETE":
      return "对应测评版本已不可用，请联系提供方核对访问资格。";
    case "UNSUPPORTED_IMPLEMENTATION":
      return "当前无法打开该测评版本，请联系提供方。";
    case "RATE_LIMITED":
      return "验证次数较多，请稍后再手动验证。";
    case "BUSY":
      return "兑换服务正忙，请稍后再手动验证。";
    case "OUTCOME_UNKNOWN":
    case "TIMEOUT":
      return "尚未收到有效回执，无法确认本次验证结果。可重新打开原私密链接；本页不会自动重复提交。";
    case "ACCESS_DENIED":
      return "当前无法验证访问资格，请核对原私密链接或联系提供方。";
    case "SOURCE_REJECTED":
    case "CSRF_REJECTED":
    case "OPERATOR_REQUIRED":
      return "当前访问环境未通过验证，请从原入口重新打开。";
    case "DEPENDENCY_UNAVAILABLE":
      return "兑换所需服务暂不可用，请稍后再手动验证。";
    default:
      return "暂时无法验证访问。请重新输入兑换码手动验证，或重新打开原私密链接。";
  }
}
