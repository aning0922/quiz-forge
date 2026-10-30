import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ConsumerControllerV2 } from "../consumer-v2/controller";
import {
  consumerSaveBindingSha256V2,
  consumerCompleteBindingSha256V2,
  type ConsumerCompleteBindingV2,
  type ConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
import type { consumerSessionFixtureV2 } from "../consumer-v2/session.test-support";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import { QianzaiTongxinExperience } from "./experience";
import { QianzaiWater, QianzaiPetals, useQianzaiMotion } from "./motion";
import type {
  QianzaiResolvedImage,
  QianzaiPrototypeImage,
  QianzaiVisualProps,
} from "./art";
import styles from "./qianzai.module.css";
import {
  consumerCanonicalText,
  consumerTextSha256,
} from "@/lib/consumer-contract/v1/integrity";
import { consumerMappingSha256V2 } from "@/lib/consumer-contract/v2/identities";
import { CONSUMER_LIMITS_V1 } from "@/lib/consumer-contract/v1/limits";
import { persistedReportDisplaySha256V2 } from "@/features/report/persisted/view-contracts-v2";
import { QianzaiResourceOwner } from "./resource-owner";

/** Actual owner and renderer, synthetic HTTP only. No catalog admission or DB. */
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  session: Awaited<ReturnType<typeof consumerSessionFixtureV2>>;
  completed: ConsumerV2ReaderModel;
  visuals?: {
    asset: QianzaiResolvedImage["asset"];
    url: string;
    layer: QianzaiResolvedImage["layer"] | QianzaiPrototypeImage["layer"];
  }[];
  preferenceSceneRef?: QianzaiResolvedImage["asset"]["resourceRef"];
  completedVisuals?: {
    asset: QianzaiResolvedImage["asset"];
    url: string;
    layer: "clean";
  }[];
  leaseRemount?: boolean;
};
const restored = JSON.parse(
  localStorage.getItem("qianzai-synthetic-server-state") ?? "null",
) as typeof fixture.session.initial | null;
let state = restored ?? fixture.session.initial;
let original: ConsumerSaveInputV2 | undefined;
let completedReport: NonNullable<ConsumerV2ReaderModel["report"]> | null = null;
let holdArt = false;
const artWaiters = new Set<() => void>();
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
async function applyComplete(binding: ConsumerCompleteBindingV2) {
  if (completedReport)
    return {
      schemaVersion: "quizforge.consumer-complete-resolution.v2",
      kind: "applied",
      binding,
      bindingSha256: await consumerCompleteBindingSha256V2(binding),
      report: completedReport.receipt,
    };
  const report = structuredClone(fixture.completed.report!);
  report.receipt.binding = binding;
  report.receipt.bindingSha256 = await consumerCompleteBindingSha256V2(binding);
  report.view.session = binding.session;
  report.view.completionBindingSha256 = report.receipt.bindingSha256;
  const display = report.view.display;
  display.matchingContextSha256 = binding.matchingContextSha256;
  display.body.provenance.matchingContextSha256 = binding.matchingContextSha256;
  display.bodySha256 = await consumerTextSha256(
    consumerCanonicalText(display.body, CONSUMER_LIMITS_V1.reportResponseBytes),
  );
  report.view.mappingSha256 = await consumerMappingSha256V2(
    report.view.mapping,
  );
  report.receipt.displaySha256 = await persistedReportDisplaySha256V2(
    report.view,
  );
  completedReport = report;
  return {
    schemaVersion: "quizforge.consumer-complete-resolution.v2",
    kind: "applied",
    binding,
    bindingSha256: report.receipt.bindingSha256,
    report: report.receipt,
  };
}
const fetcher: typeof fetch = async (url, options) => {
  const path = String(url);
  calls.push({ path, method: options?.method ?? "GET" });
  if (path.endsWith("session"))
    return json({
      ...fixture.session.view,
      outcome: completedReport
        ? { kind: "completed", report: completedReport.receipt }
        : { kind: "editable", state },
    });
  if (path.endsWith("entry")) return json(fixture.session.entry);
  if (path.endsWith("report")) return json(completedReport);
  if (path.endsWith("complete/resolve"))
    return json(await applyComplete(JSON.parse(String(options?.body))));
  if (path.endsWith("complete")) {
    const binding = JSON.parse(
      String(options?.body),
    ) as ConsumerCompleteBindingV2;
    if (hold) {
      hold = false;
      await new Promise<void>((r) => {
        release = r;
      });
    }
    const result = await applyComplete(binding);
    if (drop) {
      drop = false;
      throw Error("SYNTHETIC_LOST_COMPLETE_ACK");
    }
    return json(result);
  }
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
  const [visuals, setVisuals] = useState<QianzaiVisualProps>({});
  const [generation, setGeneration] = useState(0);
  const [reportImages, setReportImages] = useState<{
    generation: number;
    view: NonNullable<ConsumerV2ReaderModel["report"]>["view"];
    images: readonly QianzaiResolvedImage[];
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const urls: string[] = [];
    Object.assign(
      (window as unknown as { qianzaiProbe: object }).qianzaiProbe,
      {
        remountSameReport: () => setGeneration((old) => old + 1),
        hideQuestionPaper: () => {
          const current = owner.getSnapshot();
          const q = current.entry?.questions.find(
            (q) => q.ref.id === current.draft?.progress.questionId,
          );
          const ref = q
            ? current.entry?.slots.acts[q.act - 1]?.questionPaper
            : undefined;
          if (ref)
            setVisuals((old) => ({
              ...old,
              images:
                old.images?.filter(
                  (image) => image.asset.resourceRef.id !== ref.id,
                ) ?? [],
            }));
        },
      },
    );
    void Promise.all(
      (fixture.visuals ?? []).map(async (entry) => {
        const response = await fetch(entry.url, { signal: abort.signal });
        const blob = await response.blob();
        const bytes = await blob.arrayBuffer();
        const sha = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        if (
          sha !== entry.asset.sha256 ||
          bytes.byteLength !== entry.asset.bytes
        )
          throw Error("PROTOTYPE_FIXTURE_CHANGED");
        const decoded = await createImageBitmap(blob);
        decoded.close();
        if (abort.signal.aborted) return null;
        const objectUrl = URL.createObjectURL(blob) as `blob:${string}`;
        urls.push(objectUrl);
        return { asset: entry.asset, objectUrl, layer: entry.layer };
      }),
    ).then((images) => {
      if (abort.signal.aborted) return;
      setVisuals({
        images: images.filter(
          (i): i is QianzaiResolvedImage => !!i && i.layer === "clean",
        ),
        prototypeImages: images.filter(
          (i): i is QianzaiPrototypeImage => !!i && i.layer !== "clean",
        ),
      });
    });
    return () => {
      abort.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);
  const model = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  );
  useEffect(() => {
    if (
      !model.report ||
      model.phase !== "completed" ||
      !fixture.completedVisuals?.length
    )
      return;
    const abort = new AbortController(),
      view = model.report.view;
    const resourceOwner = new QianzaiResourceOwner({
      generation,
      model,
      view,
      signal: abort.signal,
      getSnapshot: owner.getSnapshot,
      current: () =>
        !abort.signal.aborted &&
        owner.getSnapshot().phase === "completed" &&
        owner.getSnapshot().report?.view === view,
      transport: async (ref, options) => {
        const asset = fixture.completedVisuals!.find(
          (v) => v.asset.resourceRef.id === ref.resourceRef.id,
        );
        if (!asset) throw Error("UNSCOPED_MOTION_FIXTURE");
        if (holdArt)
          await new Promise<void>((resolve) => {
            const done = () => {
              artWaiters.delete(done);
              options.removeEventListener("abort", done);
              resolve();
            };
            artWaiters.add(done);
            options.addEventListener("abort", done, { once: true });
            if (options.aborted) done();
          });
        return fetch(asset.url, { signal: options });
      },
    });
    const unsubscribe = resourceOwner.subscribe(() =>
      setReportImages({
        generation,
        view,
        images: resourceOwner
          .getSnapshot()
          .filter(
            (image): image is typeof image & { layer: "clean" } =>
              image.layer === "clean",
          ),
      }),
    );
    void resourceOwner.load(
      fixture.completedVisuals.map((v, i) => ({
        asset: v.asset,
        slot: i === 0 ? "character.reveal" : "character.nameArt",
        layer: "clean",
      })),
    );
    return () => {
      abort.abort();
      unsubscribe();
      resourceOwner.dispose();
    };
  }, [model, generation]);
  useEffect(() => {
    void owner.bootstrap().then(async () => {
      if (!new URLSearchParams(location.search).has("motion-question")) return;
      owner.choosePreference("any");
      await owner.navigate(
        { questionId: owner.getSnapshot().entry!.questions[0]!.ref.id },
        "question",
      );
      // Isolated synthetic setup ends here; assertions count subsequent UI IO.
      calls.length = 0;
      setGeneration((old) => old + 1);
    });
    return () => owner.dispose();
  }, []);
  // UI-only projection of the agreed optional preference slot; this fixture
  // does not register or claim the companion shared-schema/runtime delivery.
  const viewModel =
    model.entry && fixture.preferenceSceneRef
      ? {
          ...model,
          entry: {
            ...model.entry,
            slots: {
              ...model.entry.slots,
              preferenceScene: fixture.preferenceSceneRef,
            },
          },
        }
      : model;
  return (
    <QianzaiTongxinExperience
      key={
        fixture.leaseRemount
          ? `${model.report ? "report" : "entry"}:${generation}`
          : "stable"
      }
      model={viewModel}
      onEvent={owner.onEvent}
      {...(model.report
        ? {
            images:
              reportImages?.generation === generation &&
              reportImages.view === model.report.view
                ? reportImages.images
                : [],
          }
        : visuals)}
    />
  );
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
    delayArt: () => {
      holdArt = true;
    },
    releaseArt: () => {
      holdArt = false;
      for (const done of [...artWaiters]) done();
    },
    setHidden: (hidden: boolean) => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: hidden,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    },
    prepareLast: async () => {
      owner.choosePreference("any");
      const questions = owner.getSnapshot().entry!.questions;
      for (const q of questions) owner.choose(q.ref.id, q.options[0]!.ref.id);
      await owner.navigate(
        { questionId: questions.at(-1)!.ref.id },
        "question",
      );
    },
    unmount: () => root.unmount(),
    completed: (label?: string) => {
      const model = structuredClone(fixture.completed);
      if (label)
        model.report!.view.display.body.matching.selected.label = label;
      root.render(
        <QianzaiTongxinExperience
          key={label ?? "readonly-report"}
          model={model}
          initialScreen="report"
          onEvent={() => {
            throw Error("READ_ONLY_REPORT_MUTATION");
          }}
        />,
      );
    },
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
