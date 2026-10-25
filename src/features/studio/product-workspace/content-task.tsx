"use client";
import { useOwnedStudioSession } from "../accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
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
import {
  assertNoContentPending,
  isRejectedContentSource,
  matchesContentCompletion,
} from "./content-task-guards";
import { RetainedTaskActions } from "./task-surfaces";
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
  onInspectSource?: ((importId: string) => void) | undefined;
  onInspectRevision?: ((target: RevisionTarget) => void) | undefined;
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
  session: initialSession,
  onChanged,
  onCompleted,
  onState,
  onPreview,
  onInspectSource,
  onInspectRevision,
  onNext,
}: ContentTaskProps & { onNext: () => void }) {
  const session = useOwnedStudioSession(initialSession);
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
  const [rejectedValidation, setRejectedValidation] = useState<ValidationDto>();
  const [recoveryMessage, setRecoveryMessage] = useState("");
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
      onChanged();
      if (!matchesContentCompletion(productId, validation, next)) {
        setRecoveryMessage(
          "已核实其他来源或声明的历史处理结果，结果保留在原恢复区域。本次所选来源尚未完成，不能据此开始下一次更新。",
        );
        return;
      }
      setRecoveryMessage("");
      setApplication(next);
      onCompleted?.(next);
    },
    [productId, validation, onCompleted, onChanged],
  );
  const confirmedRejection =
    !validation &&
    !application &&
    isRejectedContentSource(received, rejectedValidation);
  function endRejectedTask() {
    if (!confirmedRejection || busy || pending) return;
    try {
      assertNoContentPending(sessionStorage, productId);
      onNext();
    } catch {
      setRecoveryMessage(
        "原操作仍待核实，或本地记录无法读取。任务已保留，不能结束或重新选择来源。",
      );
    }
  }
  const stageActions = (index: number) =>
    function renderStageActions(actions: ReactNode) {
      return (
        <RetainedTaskActions
          id="content"
          visible={
            step === index &&
            !application &&
            !(confirmedRejection && !busy && !pending)
          }
        >
          {actions}
        </RetainedTaskActions>
      );
    };
  const acceptReception = useCallback((next: ImportDto) => {
    setReceived(next);
    if (next.status === "received" && next.storageCondition === "clean")
      setStep((previous) => (previous === 0 ? 1 : previous));
  }, []);
  const cleanReceived =
    received?.status === "received" && received.storageCondition === "clean";
  return (
    <div className={styles.task}>
      <ol className={styles.steps} aria-label="内容处理进度">
        {["选择与接收", "结构和素材检查", "确认形成草稿"].map(
          (label, index) => (
            <li key={label}>
              <button
                type="button"
                aria-current={step === index ? "step" : undefined}
                data-complete={
                  index === 0
                    ? cleanReceived
                    : index === 1
                      ? !!validation
                      : !!application
                }
                disabled={
                  busy ||
                  (index === 1 && !received) ||
                  (index === 2 && !validation)
                }
                onClick={() => setStep(index)}
              >
                <span aria-hidden="true">
                  {(
                    index === 0
                      ? cleanReceived
                      : index === 1
                        ? !!validation
                        : !!application
                  ) ? (
                    <Check size={15} />
                  ) : (
                    index + 1
                  )}
                </span>
                {label}
              </button>
            </li>
          ),
        )}
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
            onConfirmed={acceptReception}
            onState={setReceiveState}
            renderActions={stageActions(0)}
            onInspectSource={onInspectSource}
          />
        )}
        {settings.value && !sourceId && (
          <CreateReceive
            productId={productId}
            session={retainedSession}
            settings={settings.value}
            embedded
            onChanged={onChanged}
            onConfirmed={acceptReception}
            onState={setReceiveState}
            renderActions={stageActions(0)}
            onInspectSource={onInspectSource}
          />
        )}
        {cleanReceived && (
          <RetainedTaskActions
            id="content"
            visible={step === 0 && !application}
          >
            <button
              className={styles.primary}
              disabled={busy || pending}
              onClick={() => setStep(1)}
            >
              继续检查步骤
            </button>
          </RetainedTaskActions>
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
            onRejected={setRejectedValidation}
            renderActions={stageActions(1)}
            onInspectSource={onInspectSource}
            onSelect={(next) => {
              if (validation) {
                setStep(2);
                return;
              }
              if (!validation) {
                setValidation(next);
                if (draft.value && !draft.loading && !draft.error)
                  setMode(draft.value.kind === "draft" ? "append" : "first");
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
                      !roleHasCapability(session.operator.role, "import:create")
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
            <div hidden={!!application}>
              {mode === "first" && (
                <ApplyDraftPanel
                  validation={validation}
                  session={retainedSession}
                  refreshing={false}
                  embedded
                  onConfirmed={completed}
                  onState={setDraftState}
                  renderActions={stageActions(2)}
                  onInspectSource={onInspectSource}
                  onInspectRevision={onInspectRevision}
                  onPreview={onPreview}
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
                  renderActions={stageActions(2)}
                  onInspectSource={onInspectSource}
                  onInspectRevision={onInspectRevision}
                  onPreview={onPreview}
                />
              )}
            </div>
          </>
        )}
        {application && (
          <section className={styles.success} aria-label="本次已确认修订">
            <h2>已形成固定修订 r{application.revision}</h2>
            <p>
              服务器已确认本次处理结果。审核、内测封存和对外发布资格仍各自独立。
            </p>
            <RetainedTaskActions id="content" visible={step === 2}>
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
            </RetainedTaskActions>
          </section>
        )}
      </div>
      {recoveryMessage && (
        <p className={styles.warning} role="status">
          {recoveryMessage}
        </p>
      )}
      {confirmedRejection && (
        <section className={styles.notice} aria-label="已确认拒绝的内容任务">
          <h2>本次内容已确认被拒绝</h2>
          <p>
            此拒绝结果与原记录会继续保留。结束当前任务后可以选择新的内容；不会重提原请求或删除待核实记录。
          </p>
          <RetainedTaskActions id="content" visible={!busy && !pending}>
            {" "}
            <button
              className={styles.primary}
              disabled={busy || pending}
              onClick={endRejectedTask}
            >
              结束已确认拒绝的任务，重新选择内容
            </button>
          </RetainedTaskActions>
        </section>
      )}
    </div>
  );
}

/** An explicit existing-source choice GETs its original identity; it never creates another intent. */
function ExistingReceive({
  productId,
  importId,
  settings,
  session: initialSession,
  onConfirmed,
  onState,
  renderActions,
  onInspectSource,
}: {
  productId: string;
  importId: string;
  settings: ImportSettingsDto;
  session: StudioSessionDto;
  onConfirmed: (value: ImportDto) => void;
  onState: ContentStateObserver;
  renderActions?: ((actions: ReactNode) => ReactNode) | undefined;
  onInspectSource?: ((importId: string) => void) | undefined;
}) {
  const session = useOwnedStudioSession(initialSession);
  const read = useImportRead(
    `/api/studio/products/${encodeURIComponent(productId)}/imports/${encodeURIComponent(importId)}`,
    (value) => checkImport(value, { productId, importId }),
  );
  useEffect(() => {
    if (read.value) onConfirmed(read.value);
  }, [read.value, onConfirmed]);
  return (
    <>
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
          renderActions={renderActions}
          onInspectSource={onInspectSource}
        />
      )}
    </>
  );
}
