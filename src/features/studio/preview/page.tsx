"use client";
import { TechnicalDetails } from "../presentation/technical-details";
import { StudioPageHeader } from "../presentation/page-header";
import { previewPagePath } from "@/features/product/preview/urls";
import { StudioWorkflowNav } from "../presentation/workflow-nav";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioSessionDto } from "../contracts";
import {
  type PreviewEntry,
  type PreviewReveal,
  type PreviewScope,
  type PreviewPosterExport,
} from "@/features/product/preview/contracts";
import { draftRevisionPath } from "../drafts/client";
import {
  fetchPreviewEntry,
  fetchPreviewScore,
  previewMessage,
  PreviewClientError,
} from "./client";
import { PreviewFlow, type Answers } from "./flow";
import { PreviewImage } from "./image";
import { PREVIEW_VIEW_REGISTRY } from "@/features/theme/preview/components";
import type { PreviewState } from "@/features/theme/preview/registry";
import { exportPreviewPoster } from "./export";
import styles from "./preview.module.css";

export function FixedRevisionPreviewPage({
  scope,
  session,
}: {
  scope: PreviewScope;
  session: StudioSessionDto;
}) {
  const [attempt, setAttempt] = useState(0),
    [read, setRead] = useState<{
      attempt: number;
      entry?: PreviewEntry;
      error?: string;
    }>({ attempt: 0 });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void fetchPreviewEntry(scope, controller.signal).then(
      (entry) => {
        if (current) setRead({ attempt, entry });
      },
      (error) => {
        if (current) setRead({ attempt, error: previewMessage(error) });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [scope, attempt]);
  const active = read.attempt === attempt;
  return (
    <div className={styles.preview}>
      <StudioPageHeader
        title="固定修订内部预览"
        description={
          <>
            固定目标：修订 {scope.revision}
            。此处用于检查内容与画面，不产生正式消费者报告。
          </>
        }
      />
      <StudioWorkflowNav
        productId={scope.productId}
        current="preview"
        previewHref={previewPagePath(scope)}
      />
      <nav className={styles.navigation} aria-label="固定修订导航">
        <Link
          href={draftRevisionPath(
            scope.productId,
            scope.draftId,
            scope.revision,
          )}
        >
          阅读固定修订原文
        </Link>
        <Link href="/studio">返回运营空间</Link>
      </nav>
      <div className={styles.binding}>
        <strong>内部预览 · 固定修订 {scope.revision}</strong>
        <TechnicalDetails label="预览目标标识">
          <p>
            {scope.productId} / {scope.draftId}
          </p>
        </TechnicalDetails>
        <p>
          临时答案与结果仅留在本页，刷新后重置。内容、素材与发布仍须人工批准。
        </p>
      </div>
      {active && read.entry ? (
        <PreviewExperience
          key={`${attempt}/${read.entry.binding.canonicalContentSha256}`}
          entry={read.entry}
          session={session}
        />
      ) : active && read.error ? (
        <section className={styles.failure} role="alert">
          <h1>此固定修订暂不可预览</h1>
          <p>{read.error}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>
            重新读取固定修订
          </button>
        </section>
      ) : (
        <p className={styles.loading} role="status">
          正在读取并核验固定修订预览…
        </p>
      )}
    </div>
  );
}
function PreviewExperience({
  entry,
  session,
}: {
  entry: PreviewEntry;
  session: StudioSessionDto;
}) {
  const [flow] = useState(() => new PreviewFlow(entry)),
    [screen, setScreen] = useState<PreviewState>("cover"),
    [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Answers>({}),
    [generation, setGeneration] = useState(0),
    [reveal, setReveal] = useState<PreviewReveal>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [png, setPng] = useState<{ url: string; generation: number }>(),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState<string>();
  const scoring = useRef<AbortController | undefined>(undefined),
    encoding = useRef<AbortController | undefined>(undefined),
    pngUrl = useRef<string | undefined>(undefined),
    mounted = useRef(true),
    surface = useRef<HTMLDivElement>(null);
  const revokePng = useCallback(() => {
    encoding.current?.abort();
    encoding.current = undefined;
    if (pngUrl.current) URL.revokeObjectURL(pngUrl.current);
    pngUrl.current = undefined;
    setPng(undefined);
    setExporting(false);
    setExportError(undefined);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flow.invalidate();
      scoring.current?.abort();
      encoding.current?.abort();
      if (pngUrl.current) URL.revokeObjectURL(pngUrl.current);
    };
  }, [flow]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      surface.current?.scrollIntoView({ block: "start", behavior: "instant" });
      surface.current
        ?.querySelector<HTMLElement>("[data-preview-heading]")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [screen, index]);
  const invalidate = useCallback(() => {
    flow.invalidate();
    setGeneration(flow.version);
    scoring.current?.abort();
    setBusy(false);
    setReveal(undefined);
    revokePng();
  }, [flow, revokePng]);
  const failure = useCallback(
    (error: unknown) => {
      if (
        error instanceof PreviewClientError &&
        [
          "UNAUTHENTICATED",
          "CAPABILITY_DENIED",
          "CSRF_REJECTED",
          "PREVIEW_BINDING_MISMATCH",
        ].includes(error.code)
      ) {
        invalidate();
        setScreen("question");
        setError(previewMessage(error));
      }
    },
    [invalidate],
  );
  const choose = (q: string, o: string) => {
    invalidate();
    flow.edit(q, o);
    setGeneration(flow.version);
    setAnswers(flow.currentAnswers);
    setError(undefined);
  };
  const score = async () => {
    scoring.current?.abort();
    revokePng();
    setReveal(undefined);
    setError(undefined);
    const controller = new AbortController();
    scoring.current = controller;
    const ticket = flow.begin(crypto.randomUUID());
    setGeneration(flow.version);
    setBusy(true);
    try {
      const value = await fetchPreviewScore(
        ticket.request,
        session.csrfToken,
        controller.signal,
      );
      if (mounted.current && flow.accepts(ticket, value)) {
        setReveal(value);
        setScreen("result");
        setBusy(false);
      }
    } catch (error) {
      if (mounted.current && flow.isCurrent(ticket.generation)) {
        setBusy(false);
        setError(previewMessage(error));
        failure(error);
      }
    }
  };
  const navigate = (next: PreviewState) => {
    if (busy) invalidate();
    revokePng();
    setScreen(next);
  };
  const generate = async () => {
    revokePng();
    if (!reveal || reveal.poster.kind !== "ready") return;
    const value: PreviewPosterExport = {
      binding: reveal.binding,
      requestId: reveal.requestId,
      answersHash: reveal.answersHash,
      logicHash: reveal.logicHash,
      selectedResultRef: reveal.selectedResultRef,
      reportTemplateRef: reveal.reportTemplateRef,
      poster: reveal.poster,
    };
    const version = flow.version,
      controller = new AbortController();
    encoding.current = controller;
    setExporting(true);
    const current = () =>
      mounted.current &&
      !controller.signal.aborted &&
      flow.isCurrent(version) &&
      encoding.current === controller;
    try {
      const blob = await exportPreviewPoster(value, controller.signal, current);
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      pngUrl.current = url;
      setPng({ url, generation: version });
      setExporting(false);
    } catch (error) {
      if (current()) {
        setExporting(false);
        setExportError(previewMessage(error));
        failure(error);
      }
    }
  };
  const q = entry.questions[index]!,
    frame = entry.visualPresentation.questionFrames.find(
      (f) =>
        f.questionRef.id === q.id &&
        f.questionRef.productId === q.productId &&
        f.questionRef.version === q.version,
    )!,
    section = entry.visualPresentation.sections.find(
      (s) => s.id === frame.sectionId,
    )!;
  const imageRef =
    screen === "cover"
      ? entry.visualPresentation.coverSceneRef
      : screen === "question"
        ? (frame.sceneOverrideRef ?? section.sceneRef)
        : undefined;
  const asset = imageRef
    ? entry.assets.find(
        (a) =>
          a.resourceRef.id === imageRef.id &&
          a.resourceRef.productId === imageRef.productId &&
          a.resourceRef.version === imageRef.version,
      )
    : ["result", "report", "poster"].includes(screen)
      ? reveal?.result.portrait
      : undefined;
  const media = asset ? (
    <PreviewImage
      key={`${screen}/${index}/${generation}/${asset.resourceRef.id}@${asset.resourceRef.version}`}
      binding={entry.binding}
      asset={asset}
      onFailure={failure}
    />
  ) : null;
  const shared = { entry, media };
  const Cover = PREVIEW_VIEW_REGISTRY.components["folio-cover"],
    Question = PREVIEW_VIEW_REGISTRY.components["folio-question"],
    Resume = PREVIEW_VIEW_REGISTRY.components["folio-resume"],
    Result = PREVIEW_VIEW_REGISTRY.components["cabinet-result"],
    Report = PREVIEW_VIEW_REGISTRY.components["folio-report"],
    Poster = PREVIEW_VIEW_REGISTRY.components["folio-poster"];
  return (
    <div ref={surface}>
      {error && (
        <p className={styles.failure} role="alert">
          {error}
        </p>
      )}
      {screen === "cover" && (
        <Cover {...shared} onStart={() => navigate("question")} />
      )}
      {screen === "question" && (
        <Question
          {...shared}
          index={index}
          answers={answers}
          busy={busy}
          onChoose={choose}
          onMove={(next) => {
            if (busy) invalidate();
            setIndex(next);
            setError(undefined);
          }}
          onPause={() => navigate("resume")}
          onScore={() => void score()}
        />
      )}
      {screen === "resume" && (
        <Resume
          {...shared}
          answers={answers}
          onContinue={() => navigate("question")}
          onQuestion={(i) => {
            setIndex(i);
            navigate("question");
          }}
        />
      )}
      {screen === "result" && reveal && (
        <Result
          {...shared}
          reveal={reveal}
          onQuestion={() => navigate("question")}
          onReport={() => navigate("report")}
          onResult={() => navigate("result")}
          onPoster={() => navigate("poster")}
        />
      )}
      {screen === "report" && reveal && (
        <Report
          {...shared}
          reveal={reveal}
          onQuestion={() => navigate("question")}
          onReport={() => navigate("report")}
          onResult={() => navigate("result")}
          onPoster={() => navigate("poster")}
        />
      )}
      {screen === "poster" && reveal && (
        <Poster
          {...shared}
          reveal={reveal}
          onQuestion={() => navigate("question")}
          onReport={() => navigate("report")}
          onResult={() => navigate("result")}
          onPoster={() => navigate("poster")}
        >
          <div className={styles.exportControls}>
            {reveal?.poster.kind === "ready" && (
              <button disabled={exporting} onClick={() => void generate()}>
                {exporting ? "正在核验字体并生成 PNG…" : "生成完整 PNG"}
              </button>
            )}
            {exportError && <p role="alert">{exportError}</p>}
            {png && png.generation === generation && (
              <>
                <p role="status">PNG 已完成编码，1080 × 1920。</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.png}
                  src={png.url}
                  alt="已生成的内部预览海报 PNG"
                />
                <a href={png.url} download="quizforge-internal-preview.png">
                  下载 PNG
                </a>
              </>
            )}
          </div>
        </Poster>
      )}
    </div>
  );
}
