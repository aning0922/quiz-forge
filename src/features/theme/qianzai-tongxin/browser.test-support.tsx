import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ConsumerControllerV2 } from "../consumer-v2/controller";
import {
  consumerSaveBindingSha256V2,
  type ConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
import type { consumerSessionFixtureV2 } from "../consumer-v2/session.test-support";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import { QianzaiTongxinExperience } from "./experience";
import { QianzaiWater, QianzaiPetals, useQianzaiMotion } from "./motion";
import styles from "./qianzai.module.css";

/** Actual owner and renderer, synthetic HTTP only. No catalog admission or DB. */
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  session: Awaited<ReturnType<typeof consumerSessionFixtureV2>>;
  completed: ConsumerV2ReaderModel;
};
const restored = JSON.parse(
  localStorage.getItem("qianzai-synthetic-server-state") ?? "null",
) as typeof fixture.session.initial | null;
let state = restored ?? fixture.session.initial;
let original: ConsumerSaveInputV2 | undefined;
let drop = false,
  hold = false,
  release: (() => void) | undefined;
const calls: { path: string; method: string }[] = [];
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
async function apply(input: ConsumerSaveInputV2) {
  const bindingSha256 = await consumerSaveBindingSha256V2(input.binding);
  state = {
    ...state,
    stateRevision: input.binding.expectedStateRevision + 1,
    answers: input.answers,
    progress: input.progress,
    matchingContext: input.matchingContext,
    consumerStateAnswersSha256: input.binding.consumerStateAnswersSha256,
    progressSha256: input.binding.progressSha256,
    matchingContextSha256: input.binding.matchingContextSha256,
    lastSave: {
      schemaVersion: "quizforge.consumer-save-receipt.v2",
      binding: input.binding,
      bindingSha256,
      appliedStateRevision: input.binding.expectedStateRevision + 1,
      savedAt: fixture.session.view.observedAt,
    },
  };
  localStorage.setItem("qianzai-synthetic-server-state", JSON.stringify(state));
  return {
    schemaVersion: "quizforge.consumer-save-resolution.v2",
    kind: "applied-current",
    binding: input.binding,
    bindingSha256,
    state,
  };
}
const fetcher: typeof fetch = async (url, options) => {
  const path = String(url);
  calls.push({ path, method: options?.method ?? "GET" });
  if (path.endsWith("session"))
    return json({
      ...fixture.session.view,
      outcome: { kind: "editable", state },
    });
  if (path.endsWith("entry")) return json(fixture.session.entry);
  if (path.endsWith("save/resolve")) return json(await apply(original!));
  if (path.endsWith("save")) {
    const input = JSON.parse(String(options?.body)) as ConsumerSaveInputV2;
    if (hold) {
      hold = false;
      await new Promise<void>((r) => {
        release = r;
      });
    }
    const result = await apply(input);
    if (drop) {
      drop = false;
      original = input;
      throw Error("SYNTHETIC_LOST_ACK");
    }
    return json(result);
  }
  if (path.endsWith("logout")) return new Response(null, { status: 204 });
  throw Error("UNEXPECTED_SYNTHETIC_REQUEST");
};
const owner = new ConsumerControllerV2(
  fixture.session.session.sessionId,
  {
    getItem: (k) => sessionStorage.getItem(k),
    setItem: (k, v) => sessionStorage.setItem(k, v),
    removeItem: (k) => sessionStorage.removeItem(k),
  },
  fetcher,
);
const root = createRoot(document.getElementById("root")!);
function Runtime() {
  const model = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  );
  useEffect(() => {
    void owner.bootstrap();
    return () => owner.dispose();
  }, []);
  return <QianzaiTongxinExperience model={model} onEvent={owner.onEvent} />;
}
Object.assign(window, {
  qianzaiProbe: {
    calls,
    owner,
    snapshot: owner.getSnapshot,
    dropNext: () => {
      drop = true;
    },
    holdNext: () => {
      hold = true;
    },
    release: () => release?.(),
    completed: () =>
      root.render(
        <QianzaiTongxinExperience
          model={fixture.completed}
          initialScreen="report"
          onEvent={() => {
            throw Error("READ_ONLY_REPORT_MUTATION");
          }}
        />,
      ),
  },
});
function MotionStudy() {
  const [src, setSrc] = useState<string>(),
    [paused, setPaused] = useState(false);
  const running = useQianzaiMotion(!paused);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void fetch("/private-v8-reference", { signal: controller.signal })
      .then((r) => r.blob())
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);
  return (
    <main className={styles.host}>
      <p>私有 V8 原件动效研究 · 非资源准入或正式消费者画面</p>
      <div
        className={styles.coverScene}
        data-motion={running ? "running" : "paused"}
        style={{ width: 390, height: 844, minHeight: 0, margin: "auto" }}
      >
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="私有 V8 原件参考" className={styles.fullArt} />
        )}
        <div className={styles.lamps} aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} />
          ))}
        </div>
        <QianzaiWater src={src} active={!paused} />
        <QianzaiPetals active={!paused} />
        <button
          className={styles.motionToggle}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "继续动效" : "暂停动效"}
        </button>
      </div>
    </main>
  );
}
root.render(
  new URLSearchParams(location.search).has("motion-study") ? (
    <MotionStudy />
  ) : (
    <Runtime />
  ),
);
