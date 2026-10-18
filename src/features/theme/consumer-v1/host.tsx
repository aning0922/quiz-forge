"use client";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { DisplayAssetV1 } from "@/lib/assessment-contract/display-v1";
import { consumerAnswersForDisplay } from "@/lib/consumer-contract/v1/state";
import { loadVerifiedImage } from "@/lib/browser/display-assets";
import type { ConsumerEntryView } from "@/features/fulfillment/consumer-flow/display-contract";
import type { bindConsumerRendererClientV1 } from "./renderer-client-v1";
import {
  ConsumerControllerV1,
  type ConsumerHostStateV1,
  type ConsumerTaskV1,
} from "./controller";
import { consumerResourceTransportV1 } from "./resource";
import type {
  ConsumerControls,
  ConsumerMediaPresentation,
  ConsumerPosterExportPresentation,
} from "./interfaces";
import styles from "./host.module.css";

type Runtime = NonNullable<ReturnType<typeof bindConsumerRendererClientV1>>;
type RuntimeFacts = Pick<
  ConsumerEntryView["facts"],
  "renderer" | "mapping" | "font"
>;
/** Composition boundary resolves the exact registered identity; this closure never imports its descriptor. */
export type ConsumerExperienceV1Props = Readonly<{
  sessionId: string;
  initialScreen?: "report";
  resolveRuntime: (facts: RuntimeFacts) => Runtime | null;
}>;
function Panel({ children }: { children: ReactNode }) {
  return <section className={styles.panel}>{children}</section>;
}
function VerifiedMedia({
  asset,
  task,
  controller,
  render,
}: {
  asset: DisplayAssetV1 | undefined;
  task: ConsumerTaskV1;
  controller: ConsumerControllerV1;
  render: (media: ConsumerMediaPresentation) => ReactNode;
}) {
  const [media, setMedia] = useState<ConsumerMediaPresentation>({
    kind: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!asset) return;
    const active = new AbortController();
    const cancel = () => active.abort();
    task.signal.addEventListener("abort", cancel, { once: true });
    let released: (() => void) | undefined;
    void loadVerifiedImage(
      asset,
      consumerResourceTransportV1(
        controller.sessionId,
        task,
        controller.revoke,
      ),
      active.signal,
    ).then(
      (image) => {
        if (!task.current() || active.signal.aborted) {
          image.release();
          return;
        }
        released = image.release;
        setMedia({
          kind: "ready",
          content: (
            // eslint-disable-next-line @next/next/no-img-element -- verified private blob, revoked on cleanup
            <img
              src={image.url}
              alt={asset.alt}
              width={asset.width}
              height={asset.height}
            />
          ),
        });
      },
      () => {
        if (task.current() && !active.signal.aborted)
          setMedia({
            kind: "unavailable",
            onRetry: () => {
              setMedia({ kind: "loading" });
              setAttempt((n) => n + 1);
            },
          });
      },
    );
    return () => {
      active.abort();
      task.signal.removeEventListener("abort", cancel);
      released?.();
    };
  }, [asset, task, controller, attempt]);
  return render(asset ? media : { kind: "unavailable" });
}
function entryAsset(state: ConsumerHostStateV1) {
  const entry = state.entry?.facts.entry;
  if (!entry) return;
  let ref = entry.visualPresentation.coverSceneRef;
  if (state.screen === "question") {
    const frame = entry.visualPresentation.questionFrames.find(
      (f) => f.questionRef.id === state.progress.questionId,
    );
    const section = entry.visualPresentation.sections.find(
      (s) => s.id === frame?.sectionId,
    );
    ref = frame?.sceneOverrideRef ?? section?.sceneRef ?? ref;
  }
  return entry.assets.find(
    (a) =>
      a.resourceRef.id === ref.id &&
      a.resourceRef.version === ref.version &&
      a.resourceRef.productId === ref.productId,
  );
}
function Completed({
  state,
  runtime,
  controller,
  task,
}: {
  state: ConsumerHostStateV1;
  runtime: Runtime;
  controller: ConsumerControllerV1;
  task: ConsumerTaskV1;
}) {
  const [exportState, setExportState] =
    useState<ConsumerPosterExportPresentation>({
      kind: "idle",
      onExport: () => {
        void exportPng();
      },
    });
  const [active] = useState(() => new AbortController());
  useEffect(() => () => active.abort(), [active]);
  const display = state.report!.view.display;
  const navigate = (screen: "result" | "report" | "poster") =>
    controller.readonlyScreen(screen);
  async function exportPng() {
    if (
      !task.current() ||
      active.signal.aborted ||
      display.poster.kind !== "ready"
    )
      return;
    setExportState({ kind: "exporting" });
    const cancel = () => active.abort();
    task.signal.addEventListener("abort", cancel, { once: true });
    try {
      const blob = await runtime.exportPoster(
        {
          answersHash: display.answersHash,
          logicHash: display.logicHash,
          selectedResultRef: display.selectedResultRef,
          reportTemplateRef: display.reportTemplateRef,
          poster: display.poster,
        },
        consumerResourceTransportV1(
          controller.sessionId,
          task,
          controller.revoke,
        ),
        active.signal,
        task.current,
      );
      if (!task.current() || active.signal.aborted) return;
      setExportState({
        kind: "ready",
        onDownload: () => {
          if (!task.current() || active.signal.aborted) return;
          const url = URL.createObjectURL(blob),
            link = document.createElement("a");
          link.href = url;
          link.download = "quizforge-internal-report.png";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        },
      });
    } catch {
      if (task.current() && !active.signal.aborted)
        setExportState({
          kind: "unavailable",
          reason: "encoding",
          onRetry: () => {
            void exportPng();
          },
        });
    } finally {
      task.signal.removeEventListener("abort", cancel);
    }
  }
  const C = runtime.components;
  return (
    <VerifiedMedia
      asset={display.result.portrait}
      task={task}
      controller={controller}
      render={(media) => {
        if (state.screen === "poster") {
          const Poster = C["consumer-folio-poster"];
          return (
            <Poster
              display={display}
              media={media}
              exportState={exportState}
              onReport={() => navigate("report")}
            />
          );
        }
        if (state.screen === "report") {
          const Report = C["consumer-folio-report"];
          return (
            <Report
              display={display}
              media={media}
              onResult={() => navigate("result")}
              onPoster={() => navigate("poster")}
            />
          );
        }
        const Result = C["consumer-cabinet-result"];
        return (
          <Result
            display={display}
            media={media}
            onReport={() => navigate("report")}
            onPoster={() => navigate("poster")}
          />
        );
      }}
    />
  );
}
function Pending({
  controller,
  state,
}: {
  controller: ConsumerControllerV1;
  state: ConsumerHostStateV1;
}) {
  const kind = state.resolution?.kind;
  return (
    <Panel>
      <h2>核对上一次操作</h2>
      <p>
        {state.keyExpired
          ? "本次答题期限已到，可查询原提交结果。原操作记录继续保留，当前不能重放或新建提交。"
          : kind === "superseded"
            ? "服务器进度已更新。采用当前保存的答案后再继续，本次候选不会自动合并。"
            : kind === "unresolved"
              ? "暂未取得最终结果，原操作仍保留。核对或重放都沿用同一次请求。"
              : kind
                ? "已取得服务器记录，请确认采用后继续。"
                : "上一次操作的结果还不确定。答题与完成已暂时停用，原请求已保留在本标签中。"}
      </p>
      <div className={styles.actions}>
        <button
          onClick={() => {
            void controller.recover();
          }}
        >
          核对原操作
        </button>
        {!state.keyExpired && (!kind || kind === "unresolved") && (
          <button
            onClick={() => {
              void controller.recover(true);
            }}
          >
            重放原操作
          </button>
        )}
        {kind && kind !== "unresolved" && (
          <button
            onClick={() => {
              void controller.adoptObserved();
            }}
          >
            {kind === "superseded" || kind === "state-conflict"
              ? "采用服务器答案"
              : "采用已核对结果"}
          </button>
        )}
      </div>
    </Panel>
  );
}
export function ConsumerExperienceV1({
  sessionId,
  initialScreen,
  resolveRuntime,
}: ConsumerExperienceV1Props) {
  const controller = useMemo(
    () =>
      new ConsumerControllerV1(sessionId, {
        getItem: (key) => sessionStorage.getItem(key),
        setItem: (key, value) => sessionStorage.setItem(key, value),
        removeItem: (key) => sessionStorage.removeItem(key),
      }),
    [sessionId],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.bootstrap(initialScreen);
    return () => controller.dispose();
  }, [controller, initialScreen]);
  const facts = state.report?.view ?? state.entry?.facts;
  const runtime = useMemo(() => {
    try {
      return facts ? resolveRuntime(facts) : null;
    } catch {
      return null;
    }
  }, [facts, resolveRuntime]);
  const task = useMemo(
    () => (state.session ? controller.task() : null),
    [controller, state.session],
  );
  const refresh = () => {
    void controller.bootstrap(initialScreen);
  };
  if (state.phase === "loading")
    return (
      <main className={styles.host}>
        <Panel>
          <h1>正在读取你的体验</h1>
          <p role="status">正在核对当前授权与已保存的进度。</p>
        </Panel>
      </main>
    );
  if (state.phase === "lost")
    return (
      <main className={styles.host}>
        <Panel>
          <h1>请重新验证访问</h1>
          <p>当前授权已失效。原操作仍保留，重新验证后再核对。</p>
          <a href="/access">返回访问入口</a>
        </Panel>
      </main>
    );
  if (state.phase === "unavailable" || !task || !facts || !runtime)
    return (
      <main className={styles.host}>
        {state.phase === "pending" && state.pending && task?.current() && (
          <Pending controller={controller} state={state} />
        )}
        <Panel>
          <h1>暂时无法读取体验</h1>
          <p>尚未取得可用的授权内容。已保留的操作不会因此清除。</p>
          <button onClick={refresh}>重新读取</button>
        </Panel>
      </main>
    );
  const controls = <A,>(actions: A): ConsumerControls<A> =>
    state.phase === "active"
      ? {
          kind: "enabled",
          save: controller.unsaved()
            ? { kind: "unsaved" }
            : {
                kind: "saved",
                stateRevision: state.accepted!.stateRevision,
                savedAt: state.accepted!.lastSave?.savedAt ?? null,
              },
          actions,
        }
      : {
          kind: "blocked",
          reason:
            state.phase === "busy"
              ? "saving"
              : state.phase === "pending"
                ? state.resolution && state.resolution.kind !== "unresolved"
                  ? "conflict"
                  : "unknown"
                : "unavailable",
        };
  const navigate = (
    questionId: string | null,
    screen: "cover" | "question" | "resume" | "review",
  ) => {
    void controller.navigate({ questionId }, screen);
  };
  let content: ReactNode;
  if (state.report)
    content = (
      <Completed
        key={`${state.report.receipt.reportId}:${state.screen}`}
        state={state}
        runtime={runtime}
        controller={controller}
        task={task}
      />
    );
  else {
    const entry = state.entry!.facts.entry,
      answers = consumerAnswersForDisplay(state.answers),
      C = runtime.components;
    if (state.screen === "review")
      content = (
        <Panel>
          <h1 data-consumer-heading>确认完成本次测评</h1>
          <p>
            共 {entry.questions.length} 题，已选择 {state.answers.length}{" "}
            题。确认后将生成并锁定这次报告，原链接用于只读查看。
          </p>
          <div className={styles.actions}>
            <button
              disabled={
                state.phase !== "active" ||
                state.answers.length !== entry.questions.length
              }
              onClick={() => {
                void controller.complete();
              }}
            >
              确认完成并查看报告
            </button>
            <button
              disabled={state.phase !== "active"}
              onClick={() => navigate(null, "resume")}
            >
              返回检查答案
            </button>
          </div>
        </Panel>
      );
    else if (state.screen === "resume") {
      const Resume = C["consumer-folio-resume"];
      content = (
        <Resume
          entry={entry}
          answers={answers}
          controls={controls({
            onContinue: () =>
              navigate(
                state.progress.questionId ??
                  entry.questions.find((q) => !answers[q.id])?.id ??
                  entry.questions[0]!.id,
                "question",
              ),
            onQuestion: (id: string) => navigate(id, "question"),
            onCover: () => navigate(null, "cover"),
            onReviewCompletion: () => navigate(null, "review"),
          })}
        />
      );
    } else
      content = (
        <VerifiedMedia
          key={`${state.screen}:${state.progress.questionId}`}
          asset={entryAsset(state)}
          task={task}
          controller={controller}
          render={(media) => {
            if (state.screen === "question" && state.progress.questionId) {
              const Question = C["consumer-folio-question"];
              return (
                <Question
                  entry={entry}
                  answers={answers}
                  questionId={state.progress.questionId}
                  media={media}
                  controls={controls({
                    onChoose: (q: string, o: string) => controller.choose(q, o),
                    onMove: (id: string) => navigate(id, "question"),
                    onOverview: () => navigate(null, "resume"),
                    onReviewCompletion: () => navigate(null, "review"),
                  })}
                />
              );
            }
            const Cover = C["consumer-folio-cover"];
            return (
              <Cover
                entry={entry}
                answers={answers}
                media={media}
                controls={controls({
                  onStart: () =>
                    navigate(
                      entry.questions.find((q) => !answers[q.id])?.id ??
                        entry.questions[0]!.id,
                      "question",
                    ),
                })}
              />
            );
          }}
        />
      );
  }
  return (
    <main className={styles.host}>
      {state.phase === "pending" && (
        <Pending controller={controller} state={state} />
      )}
      {state.phase === "busy" && (
        <p className={styles.notice} role="status">
          正在核对并保存，请稍候。
        </p>
      )}
      {state.phase === "expired" && (
        <Panel>
          <h2>本次答题期限已到</h2>
          <p>已保存的进度仍保留，当前不能继续修改或完成。</p>
          <button onClick={refresh}>重新核对状态</button>
        </Panel>
      )}
      {content}
      <footer className={styles.footer}>
        <button
          onClick={() => {
            void controller.logout();
          }}
        >
          退出当前授权
        </button>
      </footer>
    </main>
  );
}
