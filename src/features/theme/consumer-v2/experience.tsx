"use client";
import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import type { ConsumerEntryViewV2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import type { ConsumerImplementationDescriptorV2 } from "@/features/product/internal-play/implementation-schema-v2";
import { ConsumerControllerV2 } from "./controller";
import styles from "./consumer.module.css";

export type { ConsumerExperiencePropsV2 } from "./interfaces";
import type { ConsumerExperiencePropsV2 } from "./interfaces";
export type ConsumerRuntimeFactsV2 = Pick<
  ConsumerEntryViewV2["facts"],
  "renderer" | "mapping" | "font"
>;
export type ConsumerExperienceRuntimeV2 = Readonly<{
  descriptor: ConsumerImplementationDescriptorV2;
  Experience: ComponentType<ConsumerExperiencePropsV2>;
}>;
type Owner = Pick<
  ConsumerControllerV2,
  | "getSnapshot"
  | "getInternalSnapshot"
  | "subscribe"
  | "onEvent"
  | "bootstrap"
  | "dispose"
>;
export type ConsumerSessionRuntimeV2Props = {
  sessionId: string;
  initialScreen?: "report";
  resolveRuntime: (
    facts: ConsumerRuntimeFactsV2,
  ) => ConsumerExperienceRuntimeV2 | null;
  createController?: (sessionId: string) => Owner;
};
const createOwner = (sessionId: string) =>
  new ConsumerControllerV2(sessionId, {
    getItem: (key) => sessionStorage.getItem(key),
    setItem: (key, value) => sessionStorage.setItem(key, value),
    removeItem: (key) => sessionStorage.removeItem(key),
  });
/** One authority/pending owner per mounted session. Runtime catalog stays outside this closure. */
export function ConsumerSessionRuntimeV2({
  sessionId,
  initialScreen,
  resolveRuntime,
  createController = createOwner,
}: ConsumerSessionRuntimeV2Props) {
  const controller = useMemo(
    () => createController(sessionId),
    [createController, sessionId],
  );
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.bootstrap(initialScreen);
    return () => controller.dispose();
  }, [controller, initialScreen]);
  const internal = controller.getInternalSnapshot();
  const facts = internal.report?.view ?? internal.entry?.facts;
  const runtime = useMemo(() => {
    if (!facts) return null;
    try {
      return resolveRuntime({
        renderer: facts.renderer,
        mapping: facts.mapping,
        font: facts.font,
      });
    } catch {
      return null;
    }
  }, [facts, resolveRuntime]);
  if (runtime) {
    const Experience = runtime.Experience;
    return (
      <Experience
        model={model}
        onEvent={controller.onEvent}
        {...(initialScreen ? { initialScreen } : {})}
      />
    );
  }
  return (
    <main className={styles.host}>
      <section className={styles.panel}>
        <h1>
          {model.phase === "loading"
            ? "正在核对当前体验"
            : model.phase === "denied"
              ? "请重新验证访问"
              : "暂时无法读取此固定版本"}
        </h1>
        <p role="status">
          {model.message ??
            (model.phase === "loading"
              ? "正在读取服务端授权与固定版本。"
              : "尚未绑定可用的准确运行时，未切换到其他版本。")}
        </p>
        {model.pendingOperation && (
          <p>
            原{model.pendingOperation === "save" ? "保存" : "完成"}
            操作继续保留。
          </p>
        )}
        <div className={styles.actions}>
          {model.pendingOperation &&
            ["unknown", "conflict", "unavailable"].includes(model.phase) && (
              <button onClick={() => controller.onEvent({ type: "resolve" })}>
                核对原操作
              </button>
            )}
          {model.phase === "conflict" && (
            <button onClick={() => controller.onEvent({ type: "reload" })}>
              采用已核对服务器记录
            </button>
          )}
          {!model.pendingOperation && model.phase === "unavailable" && (
            <button onClick={() => controller.onEvent({ type: "reload" })}>
              重新读取固定版本
            </button>
          )}
          {model.phase === "denied" && <a href="/access">返回访问入口</a>}
        </div>
      </section>
    </main>
  );
}
