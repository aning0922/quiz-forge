"use client";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { exchangeConsumerAccessV1 } from "@/features/theme/consumer-v1/client";
import {
  PlatformAccessController,
  platformAccessMessage,
} from "./access-controller";
export type PlatformAccessFormProps = {
  active?: boolean;
  className?: string;
  classNames?: Partial<
    Record<"label" | "input" | "message" | "submit" | "cancel", string>
  >;
};
/** A single active form; B owns its visual classes. No key/destination comes from page props. */
export function PlatformAccessForm({
  active = true,
  className,
  classNames,
}: PlatformAccessFormProps) {
  const input = useRef<HTMLInputElement>(null),
    id = useId();
  const controller = useMemo(
    () =>
      new PlatformAccessController({
        exchange: (rawKey, signal) =>
          exchangeConsumerAccessV1(rawKey, { signal }),
        navigate: (path) => window.location.replace(path),
      }),
    [],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useLayoutEffect(() => {
    if (!active) {
      controller.cancel();
      if (input.current) input.current.value = "";
      return;
    }
    const detach = controller.attach();
    const field = input.current;
    return () => {
      if (field) field.value = "";
      detach();
    };
  }, [active, controller]);
  const busy = state.phase === "busy" || state.phase === "navigating";
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const rawKey = input.current?.value ?? "";
        if (input.current) input.current.value = "";
        if (active) void controller.submit(rawKey);
      }}
    >
      <label htmlFor={id} className={classNames?.label}>
        兑换码
      </label>
      <input
        ref={input}
        id={id}
        className={classNames?.input}
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={256}
        placeholder="请输入完整兑换码"
        disabled={!active || busy}
        aria-describedby={`${id}-message`}
        aria-invalid={state.phase === "error"}
        onInput={() => controller.edit()}
      />
      <p
        id={`${id}-message`}
        className={classNames?.message}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {platformAccessMessage(state)}
      </p>
      <button
        className={classNames?.submit}
        type="submit"
        disabled={!active || busy}
      >
        {busy ? "正在验证…" : "兑换并进入"}
      </button>
      {state.phase === "busy" && (
        <button
          className={classNames?.cancel}
          type="button"
          onClick={() => {
            controller.cancel();
            if (input.current) input.current.value = "";
          }}
        >
          取消验证
        </button>
      )}
    </form>
  );
}
