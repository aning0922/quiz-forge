"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ValidationDto } from "@/features/quizpack/validation/contracts";
import type {
  AppendDraftBinding,
  AppendDraftApplication,
} from "@/features/product/draft-revisions/contracts";
import { DRAFT_REVISION_LIMITS } from "@/features/product/draft-revisions/contracts";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError } from "../client";
import { useDraftRead } from "../drafts/use-read";
import { draftEndpoint, checkDraftRead } from "../drafts/client";
import { inspectRevisionPreparation, freezeAppendBinding } from "./pending";
import { applyAppendRevision } from "./flow";
import { matchesAppendSelection } from "./view-state";
import { AppendBindingFacts, RevisionLinks } from "./primitives";
import { RevisionPendingPanel } from "./pending-panel";
import { revisionMessage } from "./message";
import styles from "../workspace/workspace.module.css";
import local from "./revisions.module.css";
const productSchema = z.object({
  id: z.string(),
  archivedAt: z.string().nullable(),
});
export function AppendRevisionPanel({
  validation,
  session,
  refreshing,
}: {
  validation: ValidationDto;
  session: StudioSessionDto;
  refreshing: boolean;
}) {
  const productId = validation.productId,
    current = useDraftRead(draftEndpoint(productId), (v) =>
      checkDraftRead(v, productId),
    ),
    product = useDraftRead(
      `/api/studio/products/${encodeURIComponent(productId)}`,
      (v) => {
        const p = productSchema.parse(v);
        if (p.id !== productId) throw Error("INVALID_PRODUCT");
        return p;
      },
    );
  const [confirmation, setConfirmation] = useState<AppendDraftBinding>(),
    [receipt, setReceipt] = useState<AppendDraftApplication>(),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [message, setMessage] = useState(""),
    [storageReady, setStorageReady] = useState(false),
    [pendingRefresh, setPendingRefresh] = useState(0);
  function availability() {
    try {
      inspectRevisionPreparation(sessionStorage, productId);
      setStorageReady(true);
    } catch {
      setStorageReady(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(availability, 0);
    return () => clearTimeout(timer);
    // Source page is keyed by the complete validation revision/candidate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  const base =
      current.value?.kind === "draft" ? current.value.draft : undefined,
    ready =
      validation.status === "ready" &&
      !validation.readOnly &&
      !validation.maintenanceRequired &&
      validation.candidateSha256 !== null;
  const unavailable =
      refreshing ||
      busy ||
      current.loading ||
      product.loading ||
      Boolean(current.error || product.error),
    operator = session.operator.role === "operator" && !denied,
    full = Boolean(
      base && base.revision >= DRAFT_REVISION_LIMITS.maximumRevision,
    );
  const canPrepare =
    operator &&
    !unavailable &&
    storageReady &&
    ready &&
    base &&
    !product.value?.archivedAt &&
    !full;
  const confirmed =
    confirmation &&
    base &&
    matchesAppendSelection(confirmation, validation, base) &&
    ready &&
    !product.value?.archivedAt;
  function prepare() {
    if (!canPrepare || !base) return;
    try {
      inspectRevisionPreparation(sessionStorage, productId);
      setConfirmation(
        freezeAppendBinding({
          productId,
          sourceImportId: validation.importId,
          sourceValidationId: validation.id,
          idempotencyKey: crypto.randomUUID(),
          expectedValidationStateRevision: validation.stateRevision,
          expectedCandidateSha256: validation.candidateSha256!,
          target: {
            kind: "append-revision",
            draftId: base.draftId,
            expectedRevision: base.revision,
            expectedCanonicalContentSha256: base.canonicalContentSha256,
            expectedAssetSetSha256: base.assetSetSha256,
          },
        }),
      );
      setMessage("");
    } catch (error) {
      setStorageReady(false);
      setMessage(revisionMessage(error));
    }
  }
  function changed(application?: AppendDraftApplication) {
    setConfirmation(undefined);
    if (application) setReceipt(application);
    availability();
    current.refresh();
    product.refresh();
  }
  async function append() {
    if (!canPrepare || !confirmed || !confirmation) return;
    const tuple = confirmation;
    setBusy(true);
    setMessage("");
    setConfirmation(undefined);
    try {
      const result = await applyAppendRevision(
        sessionStorage,
        tuple,
        session.csrfToken,
      );
      setReceipt(result.application);
      setMessage(
        `服务器已确认固定修订 ${result.application.revision}。当前摘要需单独刷新。`,
      );
      current.refresh();
    } catch (error) {
      if (
        error instanceof StudioClientError &&
        ["CAPABILITY_DENIED", "UNAUTHENTICATED", "CSRF_REJECTED"].includes(
          error.code,
        )
      )
        setDenied(true);
      setMessage(revisionMessage(error));
    } finally {
      availability();
      setPendingRefresh((n) => n + 1);
      setBusy(false);
    }
  }
  return (
    <>
      <section className={styles.panel} aria-label="追加草稿修订">
        <h2>追加草稿修订</h2>
        <p className={styles.note}>
          将此完整候选追加到同一草稿，创建新的不可变修订。旧正文、素材引用和回执保留；此操作不授予审核或发布资格。
        </p>
        <button
          className={`${styles.button} ${styles.secondary}`}
          disabled={busy || refreshing}
          onClick={() => {
            setConfirmation(undefined);
            availability();
            current.refresh();
            product.refresh();
          }}
        >
          重新读取追加基准
        </button>
        {(current.loading || product.loading) && (
          <p role="status">正在核对当前草稿和工作区状态…</p>
        )}
        {(current.error || product.error) && (
          <p className={`${styles.status} ${styles.error}`} role="alert">
            {current.error || product.error}
          </p>
        )}
        {base && (
          <div className={local.receipt}>
            <h3>本次读取的当前基准：修订 {base.revision}</h3>
            <p>草稿 {base.draftId}</p>
            <p>内容 {base.canonicalContentSha256}</p>
            <p>素材集合 {base.assetSetSha256}</p>
            <RevisionLinks draft={base} />
          </div>
        )}
        {current.value?.kind === "empty" && (
          <p>此工作区尚无草稿。请先使用首次草稿应用。</p>
        )}
        {session.operator.role === "read-only" && (
          <p>当前为只读身份，可核实原请求和阅读修订，不能追加或重放。</p>
        )}
        {denied && (
          <p>当前写入身份或验证已失效，写入口已关闭。原请求锚点仍保留。</p>
        )}
        {product.value?.archivedAt && (
          <p>工作区已归档，不能发起新追加。旧修订和原请求仍可核实。</p>
        )}
        {full && (
          <p>
            此草稿已达到 {DRAFT_REVISION_LIMITS.maximumRevision}{" "}
            个修订的容量上限。
          </p>
        )}
        {!storageReady && (
          <p>此工作区有原请求待核实，或锚点存储不可用。新准备保持关闭。</p>
        )}
        {!ready && (
          <p>
            当前来源尚不符合新的追加条件；原请求核实不要求重新满足这些资格。
          </p>
        )}
        {confirmation && !confirmed && (
          <p role="status">
            来源或基准已变化，之前的未发送确认已失效。请重新核对后准备。
          </p>
        )}
        {confirmed && confirmation ? (
          <section className={local.receipt} aria-label="确认追加不可变修订">
            <h3>确认追加到修订 {confirmation.target.expectedRevision}</h3>
            <AppendBindingFacts binding={confirmation} />
            <p>
              仅按以上固定来源与基准发送；若基准已变化，服务器将拒绝，不自动改用最新修订。
            </p>
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={!canPrepare}
                onClick={() => void append()}
              >
                确认追加不可变修订
              </button>
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={busy}
                onClick={() => setConfirmation(undefined)}
              >
                取消未发送确认
              </button>
            </div>
          </section>
        ) : (
          canPrepare && (
            <button className={styles.button} onClick={prepare}>
              准备追加到修订 {base.revision}
            </button>
          )
        )}
        {receipt && (
          <div className={local.receipt} aria-label="已确认的固定追加回执">
            <h3>已确认的固定追加回执：修订 {receipt.revision}</h3>
            <p>
              原 key {receipt.idempotencyKey}
              。此固定回执与上方当前摘要分别读取。
            </p>
            <RevisionLinks draft={receipt} />
          </div>
        )}
        {busy && <p role="status">正在提交固定追加请求…</p>}
        {message && (
          <p className={styles.status} role="status">
            {message}
          </p>
        )}
      </section>
      <RevisionPendingPanel
        key={`${productId}/${pendingRefresh}`}
        productId={productId}
        session={session}
        refreshing={refreshing || busy}
        writeBlocked={denied}
        onChanged={changed}
      />
    </>
  );
}
