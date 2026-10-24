"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ImportDto } from "@/features/quizpack/import/contracts";
import type { ValidationDto } from "@/features/quizpack/validation/contracts";
import type { DraftApplicationDto } from "@/features/product/drafts/contracts";
import type { AppendDraftApplication } from "@/features/product/draft-revisions/contracts";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError } from "../client";
import { useContentAuthority } from "./content-authority";
import { useInternalAuthority } from "../internal-versions/authority";
import { ContentAuthorityContext } from "./content-authority";
import { CreateReceive } from "../imports/create-receive";
import { ReceiveControls } from "../imports/receive-controls";
import type { ImportSettingsDto } from "@/features/quizpack/import/contracts";
import { checkImport, checkSettings } from "../imports/client";
import { useImportRead } from "../imports/use-read";
import { ValidationPanel } from "../validations/panel";
import { ApplyDraftPanel } from "../drafts/apply-panel";
import { AppendRevisionPanel } from "../draft-revisions/append-panel";
import { checkDraftRead, draftEndpoint } from "../drafts/client";
import { useDraftRead } from "../drafts/use-read";
import {
  invalidateCurrentStudioAuthority,
  subscribeStudioAuthorityInvalidation,
} from "../authority-events";
import { useStudioLeaveProtection } from "../navigation-boundary";
import {
  useContentTaskState,
  type ContentTaskState,
  type ContentStateObserver,
} from "./content-task-state";
import styles from "./content-workbench.module.css";

export type ContentApplication = DraftApplicationDto | AppendDraftApplication;
export type ContentTaskProps = {
  productId: string;
  /** Captured at the start of a run, never rebound from a summary refresh. */
  initialImportId?: string | undefined;
  session: StudioSessionDto;
  onChanged: () => void;
  onCompleted?: ((application: ContentApplication) => void) | undefined;
  onState?: ContentStateObserver | undefined;
  onPreview?: ((target: RevisionTarget) => void) | undefined;
};
const idle: ContentTaskState = { busy: false, pending: false, retained: false };

/** Mount once per Product. Surface visibility must never key or conditionally remove this owner. */
export function ContentTask(props: ContentTaskProps) {
  const authority = useInternalAuthority();
  const [run, setRun] = useState(0);
  useEffect(
    () =>
      subscribeStudioAuthorityInvalidation(() =>
        authority.observe(new StudioClientError("UNAUTHENTICATED")),
      ),
    [authority],
  );
  const scope = useMemo(
    () => ({
      canWrite: () => !authority.isRevoked,
      observe: (error: unknown) => {
        const wasRevoked = authority.isRevoked;
        authority.observe(error);
        if (!wasRevoked && authority.isRevoked)
          invalidateCurrentStudioAuthority();
      },
    }),
    [authority],
  );
  return (
    <ContentAuthorityContext.Provider value={scope}>
      <ContentRun
        key={run}
        {...props}
        initialImportId={run === 0 ? props.initialImportId : undefined}
        onNext={() => setRun((n) => n + 1)}
      />
    </ContentAuthorityContext.Provider>
  );
}

function ContentRun({
  productId,
  initialImportId,
  session,
  onChanged,
  onCompleted,
  onState,
  onPreview,
  onNext,
}: ContentTaskProps & { onNext: () => void }) {
  const settings = useImportRead(
    `/api/studio/products/${encodeURIComponent(productId)}/imports/settings`,
    checkSettings,
  );
  const draft = useDraftRead(draftEndpoint(productId), (value) =>
    checkDraftRead(value, productId),
  );
  const [sourceId] = useState(initialImportId);
  const [step, setStep] = useState(0);
  const [received, setReceived] = useState<ImportDto>();
  const [validation, setValidation] = useState<ValidationDto>();
  const [mode, setMode] = useState<"first" | "append">();
  const [application, setApplication] = useState<ContentApplication>();
  const [receiveState, setReceiveState] = useState(idle);
  const [validationState, setValidationState] = useState(idle);
  const [draftState, setDraftState] = useState(idle);
  const authority = useContentAuthority();
  const revoked = !authority.canWrite();
  const retainedSession = revoked
    ? {
        ...session,
        operator: { ...session.operator, role: "read-only" as const },
      }
    : session;
  const states = [receiveState, validationState, draftState];
  const busy = states.some((state) => state.busy);
  const pending = states.some((state) => state.pending);
  const message = states.find((state) => state.message)?.message;
  useContentTaskState(onState, {
    busy,
    pending,
    retained:
      pending ||
      (!application && (!!sourceId || states.some((state) => state.retained))),
    message,
  });
  useStudioLeaveProtection({
    dirty: !!received && !application,
    pending: busy || pending,
    message:
      "内容任务仍保留原文件或原操作。请先完成核实；隐藏浮层不会丢失任务，刷新文档不能保留 File。",
  });
  const completed = useCallback(
    (next: ContentApplication) => {
      setApplication(next);
      onCompleted?.(next);
      onChanged();
    },
    [onCompleted, onChanged],
  );
  const cleanReceived =
    received?.status === "received" && received.storageCondition === "clean";
  return (
    <div className={styles.task}>
      <p className={styles.intro}>
        每一步都需明确确认。接收文件、检查就绪和形成草稿是三个独立结果。
      </p>
      <ol className={styles.steps} aria-label="内容处理进度">
        {["接收文件", "检查内容与素材", "形成草稿修订"].map((label, index) => (
          <li key={label}>
            <button
              type="button"
              aria-current={step === index ? "step" : undefined}
              disabled={
                busy ||
                (index === 1 && !received) ||
                (index === 2 && !validation)
              }
              onClick={() => setStep(index)}
            >
              <span aria-hidden="true">{index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      {revoked && (
        <p className={styles.warning} role="status">
          当前写入身份已失效。原文件与原操作仍保留，可查询核实；重新登录不会恢复此页旧权限。
        </p>
      )}
      {settings.loading && <p role="status">正在读取内容接收配置…</p>}
      {settings.error && (
        <div className={styles.warning} role="alert">
          <p>未取得接收配置，尚未开始写入。</p>
          <button className={styles.secondary} onClick={settings.refresh}>
            重新读取配置
          </button>
        </div>
      )}
      <div hidden={step !== 0}>
        {sourceId && settings.value && (
          <ExistingReceive
            productId={productId}
            importId={sourceId}
            settings={settings.value}
            session={retainedSession}
            onConfirmed={setReceived}
            onState={setReceiveState}
          />
        )}
        {settings.value && !sourceId && (
          <CreateReceive
            productId={productId}
            session={retainedSession}
            settings={settings.value}
            embedded
            onChanged={onChanged}
            onConfirmed={setReceived}
            onState={setReceiveState}
          />
        )}
        {cleanReceived && (
          <button
            className={styles.primary}
            disabled={busy || pending}
            onClick={() => setStep(1)}
          >
            文件已接收，继续检查内容与素材
          </button>
        )}
      </div>
      <div hidden={step !== 1}>
        {received && settings.value && (
          <ValidationPanel
            value={received}
            settings={settings.value}
            archived={false}
            session={retainedSession}
            embedded
            onState={setValidationState}
            onSelect={(next) => {
              if (!validation) {
                setValidation(next);
                setStep(2);
              }
            }}
          />
        )}
        {validation && (
          <p className={styles.notice}>
            本次草稿来源已固定到所选检查，后续记录不会替换它。
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => setStep(2)}
            >
              继续原草稿任务
            </button>
          </p>
        )}
      </div>
      <div hidden={step !== 2}>
        {validation && (
          <>
            <h2>确认形成草稿修订</h2>
            <p>
              仅使用刚才明确选择的就绪检查；不会自动提交，不会修改已有历史修订。
            </p>
            {!mode && (
              <>
                {draft.loading && <p role="status">正在核对是否已有草稿…</p>}
                {draft.error && (
                  <p className={styles.warning} role="alert">
                    当前草稿未能核实。
                    <button
                      className={styles.secondary}
                      onClick={draft.refresh}
                    >
                      重新核对
                    </button>
                  </p>
                )}
                {draft.value && !draft.loading && !draft.error && (
                  <button
                    className={styles.primary}
                    disabled={
                      busy ||
                      pending ||
                      revoked ||
                      session.operator.role !== "operator"
                    }
                    onClick={() =>
                      setMode(
                        draft.value?.kind === "draft" ? "append" : "first",
                      )
                    }
                  >
                    {draft.value.kind === "draft"
                      ? "准备追加到已有草稿"
                      : "准备建立第一版草稿"}
                  </button>
                )}
              </>
            )}
            {mode === "first" && (
              <ApplyDraftPanel
                validation={validation}
                session={retainedSession}
                refreshing={false}
                embedded
                onConfirmed={completed}
                onState={setDraftState}
              />
            )}
            {mode === "append" && (
              <AppendRevisionPanel
                productId={productId}
                validation={validation}
                session={retainedSession}
                refreshing={false}
                embedded
                onConfirmed={completed}
                onState={setDraftState}
              />
            )}
          </>
        )}
        {application && (
          <section className={styles.success} aria-label="本次已确认修订">
            <h2>已形成固定修订 r{application.revision}</h2>
            <p>
              服务器已确认本次处理结果。审核、内测封存和对外发布资格仍各自独立。
            </p>
            <div className={styles.actions}>
              {onPreview && (
                <button
                  className={styles.primary}
                  disabled={busy}
                  onClick={() =>
                    onPreview({
                      draftId: application.draftId,
                      revision: application.revision,
                      canonicalContentSha256:
                        application.canonicalContentSha256,
                      assetSetSha256: application.assetSetSha256,
                      canonicalManifestSha256:
                        application.canonicalManifestSha256,
                    })
                  }
                >
                  预览此固定修订
                </button>
              )}
              <button
                className={styles.secondary}
                disabled={busy || pending}
                onClick={onNext}
              >
                开始下一次内容更新
              </button>
            </div>
          </section>
        )}
      </div>
      <p className={styles.footnote}>
        可以暂时隐藏此任务再继续。原文件仅在当前文档内存中保留；刷新或关闭文档后需重新选择同一文件并核对原声明，不能据此认定原请求失败。
      </p>
    </div>
  );
}

/** An explicit existing-source choice GETs its original identity; it never creates another intent. */
function ExistingReceive({
  productId,
  importId,
  settings,
  session,
  onConfirmed,
  onState,
}: {
  productId: string;
  importId: string;
  settings: ImportSettingsDto;
  session: StudioSessionDto;
  onConfirmed: (value: ImportDto) => void;
  onState: ContentStateObserver;
}) {
  const read = useImportRead(
    `/api/studio/products/${encodeURIComponent(productId)}/imports/${encodeURIComponent(importId)}`,
    (value) => checkImport(value, { productId, importId }),
  );
  useEffect(() => {
    if (read.value) onConfirmed(read.value);
  }, [read.value, onConfirmed]);
  return (
    <>
      <h2>继续原内容来源</h2>
      {read.loading && <p role="status">正在读取所选接收记录…</p>}
      {read.error && (
        <p className={styles.warning} role="alert">
          原接收记录未能核实。
          <button className={styles.secondary} onClick={read.refresh}>
            重新读取原记录
          </button>
        </p>
      )}
      {read.value && (
        <ReceiveControls
          initial={read.value}
          productId={productId}
          settings={settings}
          session={session}
          archived={false}
          embedded
          onUpdate={onConfirmed}
          onState={onState}
        />
      )}
      {read.value && read.value.status !== "received" && (
        <p className={styles.warning}>
          当前文档未持有原文件。若需重新选择同字节文件上传，请
          <a
            href={`/studio/products/${encodeURIComponent(productId)}/imports/${encodeURIComponent(importId)}`}
            target="_blank"
            rel="noopener"
          >
            打开原接收记录
          </a>
          核实原声明；此处不创建新的接收意图。
        </p>
      )}
    </>
  );
}
