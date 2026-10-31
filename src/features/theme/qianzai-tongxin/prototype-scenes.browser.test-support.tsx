import { useEffect, useRef, useState } from "react";
import styles from "./qianzai.module.css";
import scenes from "./scenes.module.css";
import {
  QianzaiContinuousReader,
  type QianzaiReaderNavigation,
} from "./experience";
import { QianzaiReportReader } from "./report";
import { QianzaiSharePanel } from "./share-panel";
import { qianzaiReferenceDocument } from "@/features/report/qianzai-tongxin/reference-document.test-support";
import { createRoot } from "react-dom/client";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import type { QianzaiPrototypeImage, QianzaiResolvedImage } from "./art";
import {
  ACTS,
  useQianzaiSceneScale,
  QianzaiCover,
  QianzaiPreference,
  QianzaiQuestion,
  QianzaiReveal,
  type QianzaiRevealReference,
} from "./views";

/** Reference-only props, not a consumer controller or a score/snapshot producer.
 * Every interaction stays in this component's local state. No business transport.
 */
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  mode: "reference-only";
  probe: "q08-selected-wrap" | "reader-contract" | null;
  report: { hero: string; paper: string };
  model: ConsumerV2ReaderModel;
  completed: ConsumerV2ReaderModel;
  assets: {
    asset: QianzaiResolvedImage["asset"];
    url: string;
    layer: QianzaiResolvedImage["layer"] | QianzaiPrototypeImage["layer"];
  }[];
  before: { url: string; sha256: QianzaiRevealReference["before"]["sha256"] };
  full: { url: string; sha256: QianzaiRevealReference["full"]["sha256"] };
};
if (fixture.mode !== "reference-only")
  throw Error("REFERENCE_ONLY_FIXTURE_REQUIRED");
function ReferenceScenes() {
  const sceneScale = useQianzaiSceneScale();
  const navigation = useRef<QianzaiReaderNavigation | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [model, setModel] = useState(fixture.model),
    [screen, setScreen] = useState(
      new URLSearchParams(location.search).get("screen") ?? "cover",
    ),
    [images, setImages] = useState<{
      clean: QianzaiResolvedImage[];
      prototype: QianzaiPrototypeImage[];
      reference: QianzaiRevealReference;
    } | null>(null);
  useEffect(() => {
    let live = true;
    const abort = new AbortController(),
      urls: string[] = [];
    const load = async (url: string, sha256: string) => {
      const response = await fetch(url, { signal: abort.signal }),
        blob = await response.blob();
      const sha = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (sha !== sha256) throw Error("REFERENCE_BYTES_CHANGED");
      const objectUrl = URL.createObjectURL(blob) as `blob:${string}`;
      urls.push(objectUrl);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      return objectUrl;
    };
    void (async () => {
      const loaded = await Promise.all(
          fixture.assets.map(async (item) => ({
            ...item,
            objectUrl: await load(item.url, item.asset.sha256),
          })),
        ),
        before = await load(fixture.before.url, fixture.before.sha256),
        full = await load(fixture.full.url, fixture.full.sha256);
      if (live)
        setImages({
          clean: loaded.filter(
            (v): v is typeof v & { layer: "clean" } => v.layer === "clean",
          ),
          prototype: loaded.filter(
            (v): v is typeof v & { layer: QianzaiPrototypeImage["layer"] } =>
              v.layer !== "clean",
          ),
          reference: {
            mode: "reference-only",
            before: { objectUrl: before, sha256: fixture.before.sha256 },
            full: { objectUrl: full, sha256: fixture.full.sha256 },
          },
        });
    })().catch((e) => {
      if (live) document.body.dataset.referenceError = String(e);
    });
    return () => {
      live = false;
      abort.abort();
      urls.forEach(URL.revokeObjectURL);
    };
  }, []);
  const [revealPhase, setRevealPhase] = useState<"ready" | "playing">("ready"),
    [startedAt, setStartedAt] = useState(0),
    [revealCycle, setRevealCycle] = useState(0);
  useEffect(() => {
    Object.assign(window, {
      qianzaiReference: {
        playReveal() {
          setRevealCycle((old) => old + 1);
          setStartedAt(performance.now());
          setRevealPhase("playing");
        },
      },
    });
    return () => {
      delete (window as Window & { qianzaiReference?: unknown })
        .qianzaiReference;
    };
  }, []);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (pending.current !== null) clearTimeout(pending.current);
    pending.current = null;
  };
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current);
    },
    [],
  );
  const showReveal = () => {
    cancel();
    setStartedAt(performance.now());
    setRevealCycle((old) => old + 1);
    setRevealPhase(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "ready"
        : "playing",
    );
    setScreen("result");
  };
  const read = (next: string) => {
    cancel();
    if (screen === "result" || screen === "report") {
      if (next === "report") navigation.current?.toReport();
      else if (next === "result") navigation.current?.toReveal();
      else setScreen(next);
    } else if (next === "result") showReveal();
    else setScreen(next);
  };
  const moveQuestion = (questionId: string) => {
    cancel();
    setModel((old) => ({
      ...old,
      state: { ...old.state!, progress: { questionId } },
      draft: { ...old.draft!, progress: { questionId } },
    }));
    setScreen("question");
  };
  const enterQuestion = (questionId: string, first = false) => {
    const target = model.entry!.questions.find((q) => q.ref.id === questionId)!;
    const current = model.entry!.questions.find(
      (q) => q.ref.id === model.draft!.progress.questionId,
    );
    if (first || target.act !== current?.act) {
      cancel();
      setChapter(target.act);
      pending.current = setTimeout(
        () => {
          setChapter(null);
          moveQuestion(questionId);
        },
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 450
          : 860,
      );
    } else moveQuestion(questionId);
  };
  const afterFeedback = (action: () => void) => {
    cancel();
    pending.current = setTimeout(() => {
      pending.current = null;
      action();
    }, 400);
  };
  const change = (questionId: string, optionId: string) => {
    setModel((old) => {
      const answers = [
        ...old.draft!.answers.filter((a) => a.questionId !== questionId),
        { questionId, optionId },
      ];
      // Only the original HTML's local reference-cache presentation, never IO.
      return {
        ...old,
        state: { ...old.state!, answers },
        draft: { ...old.draft!, answers },
      };
    });
    const index = model.entry!.questions.findIndex(
        (q) => q.ref.id === questionId,
      ),
      next = model.entry!.questions[index + 1];
    afterFeedback(() => (next ? enterQuestion(next.ref.id) : showReveal()));
  };
  const visual = images
    ? { images: images.clean, prototypeImages: images.prototype }
    : {};
  return (
    <main
      className={`${styles.host} ${scenes.journey}`}
      data-reference-only="true"
      data-reference-probe={fixture.probe ?? undefined}
      data-reference-ready={!!images}
    >
      {chapter !== null && (
        <div
          className={scenes.transitionStage}
          data-qianzai-transition
          data-active="true"
          data-kind="chapter"
          data-act={chapter}
          data-reduced="true"
          style={
            {
              left: `calc(50% - ${195 * sceneScale}px)`,
              transform: `scale(${sceneScale})`,
              "--transition-duration": "860ms",
            } as React.CSSProperties
          }
          role="status"
        >
          <div className={scenes.transitionCurtain} />
          <div className={scenes.transitionFiligree} />
          <div className={scenes.transitionWords}>
            <p data-transition-part="kicker">
              {["第一幕", "第二幕", "第三幕"][chapter - 1]}
            </p>
            <h2>{ACTS[chapter - 1]?.title}</h2>
            <p data-transition-part="place">{ACTS[chapter - 1]?.place}</p>
          </div>
        </div>
      )}
      <div inert={chapter !== null}>
        {screen === "cover" ? (
          <QianzaiCover
            model={model}
            {...visual}
            onEvent={() => {
              throw Error("REFERENCE_NO_BUSINESS_IO");
            }}
            onRead={read}
            active
          />
        ) : screen === "preference" ? (
          <QianzaiPreference
            model={model}
            {...visual}
            onEvent={() => {
              throw Error("REFERENCE_NO_BUSINESS_IO");
            }}
            onRead={read}
            onEnter={() =>
              afterFeedback(() =>
                enterQuestion(model.entry!.questions[0]!.ref.id, true),
              )
            }
            onChoose={(preference) => {
              setModel((old) => ({
                ...old,
                state: {
                  ...old.state!,
                  matchingContext: {
                    schemaVersion: "quiz-matching-context.v1",
                    policyRef: old.entry!.matchingPolicyRef,
                    preference,
                  },
                },
                draft: {
                  ...old.draft!,
                  matchingContext: {
                    schemaVersion: "quiz-matching-context.v1",
                    policyRef: old.entry!.matchingPolicyRef,
                    preference,
                  },
                },
              }));
              afterFeedback(() =>
                enterQuestion(model.entry!.questions[0]!.ref.id, true),
              );
            }}
          />
        ) : screen === "result" || screen === "report" ? (
          <QianzaiContinuousReader
            navigation={navigation}
            initialReport={screen === "report"}
            reveal={(active) => (
              <QianzaiReveal
                key={revealCycle}
                model={fixture.completed}
                {...visual}
                {...(images ? { referenceComposite: images.reference } : {})}
                onEvent={() => {
                  throw Error("REFERENCE_NO_BUSINESS_IO");
                }}
                onRead={read}
                onReplay={showReveal}
                active={active}
                presentation={revealPhase}
                startedAt={startedAt}
              />
            )}
            report={(embedded) =>
              fixture.probe === "reader-contract" ? (
                // Explicit B-shell contract fixture, not A's report acceptance.
                <section
                  data-reader-contract-fixture
                  style={{ pointerEvents: "none" }}
                >
                  <header
                    data-qianzai-report-toolbar
                    style={{
                      height: 112,
                      position: "sticky",
                      top: 0,
                      zIndex: 5,
                      background: "#132838",
                      color: "#fff1d0",
                    }}
                  >
                    <button onClick={embedded.onReturn}>返回人物揭晓</button>
                    <span>连续阅读壳合同夹具</span>
                  </header>
                  <main
                    data-qianzai-report-start
                    style={{
                      marginTop: "calc(var(--qianzai-reveal-height) - 112px)",
                      backgroundImage: `url(${fixture.report.paper})`,
                      backgroundColor: "#fbf1db",
                      borderRadius: "26px 26px 0 0",
                      color: "#24384a",
                      padding: 24,
                    }}
                  >
                    {ACTS.concat(ACTS).map((act, i) => (
                      <section key={i} style={{ minHeight: 700 }}>
                        <h2
                          tabIndex={-1}
                          {...(i === 0
                            ? { "data-report-opening-title": true }
                            : {})}
                        >
                          第{i + 1}卷 · {act.title}
                        </h2>
                        <p>
                          此处仅验证共享原生滚动壳，不代替六卷报告或业务验收。
                        </p>
                      </section>
                    ))}
                  </main>
                </section>
              ) : (
                <QianzaiReportReader
                  document={qianzaiReferenceDocument}
                  heroUrl={fixture.report.hero}
                  paperUrl={fixture.report.paper}
                  onResult={embedded.onReturn}
                  {...{ embedded }}
                  actions={<QianzaiSharePanel referenceOnly />}
                />
              )
            }
          />
        ) : (
          <QianzaiQuestion
            model={model}
            {...visual}
            onRead={read}
            onEvent={(event) => {
              if (event.type !== "navigate" || !event.questionId)
                throw Error("REFERENCE_NO_BUSINESS_IO");
              enterQuestion(event.questionId);
            }}
            onChoose={change}
          />
        )}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<ReferenceScenes />);
