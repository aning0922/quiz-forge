"use client";
import { TechnicalDetails } from "../presentation/technical-details";
import { useEffect, useState } from "react";
import type {
  DraftRevisionHistory,
  DraftRevisionHistoryQuery,
} from "@/features/product/draft-revisions/contracts";
import { DRAFT_REVISION_LIMITS } from "@/features/product/draft-revisions/contracts";
import { readRevisionHistory } from "./client";
import { joinRevisionHistory } from "./view-state";
import { RevisionLinks } from "./primitives";
import { revisionMessage } from "./message";
import styles from "../workspace/workspace.module.css";
import local from "./revisions.module.css";
type RequestState = {
  generation: number;
  query: DraftRevisionHistoryQuery;
  previous: readonly DraftRevisionHistory[];
};
export function RevisionHistoryPanel({
  productId,
  draftId,
  currentRevision,
}: {
  productId: string;
  draftId: string;
  currentRevision: number;
}) {
  const [request, setRequest] = useState<RequestState>({
    generation: 0,
    query: { pageSize: DRAFT_REVISION_LIMITS.historyDefaultPageSize },
    previous: [],
  });
  const [result, setResult] = useState<{
    generation: number;
    pages?: readonly DraftRevisionHistory[];
    error?: string;
  }>({ generation: -1 });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void readRevisionHistory(
      productId,
      draftId,
      request.query,
      controller.signal,
    ).then(
      (page) => {
        if (current) {
          try {
            setResult({
              generation: request.generation,
              pages: joinRevisionHistory(request.previous, page),
            });
          } catch (error) {
            setResult({
              generation: request.generation,
              error: revisionMessage(error),
            });
          }
        }
      },
      (error) => {
        if (current)
          setResult({
            generation: request.generation,
            error: revisionMessage(error),
          });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [productId, draftId, request]);
  const active = result.generation === request.generation,
    loading = !active,
    pages = active && result.pages ? result.pages : request.previous,
    last = pages.at(-1),
    first = pages[0],
    error = active ? result.error : undefined;
  function refresh() {
    setRequest((r) => ({
      generation: r.generation + 1,
      query: { pageSize: r.query.pageSize },
      previous: [],
    }));
  }
  return (
    <section className={styles.panel} aria-label="草稿历史修订">
      <h2>草稿历史修订</h2>
      <p className={styles.note}>
        历史按固定上界倒序读取，只列元数据。当前摘要刷新不会把新修订插进本次历史分页。
      </p>
      <p>
        当前摘要读到修订 {currentRevision}。
        {first && <>本次历史上界为修订 {first.anchorRevision}。</>}
      </p>
      <div className={styles.actions}>
        <button
          className={`${styles.button} ${styles.secondary}`}
          disabled={loading}
          onClick={refresh}
        >
          重新读取历史（新上界）
        </button>
        <label className={styles.field}>
          每页条数
          <select
            className={styles.select}
            value={request.query.pageSize}
            disabled={loading}
            onChange={(event) =>
              setRequest((r) => ({
                generation: r.generation + 1,
                query: { pageSize: Number(event.target.value) },
                previous: [],
              }))
            }
          >
            {[1, 20, 50].map((size) => (
              <option value={size} key={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && <p role="status">正在读取固定历史页…</p>}
      {error && (
        <>
          <p className={`${styles.status} ${styles.error}`} role="alert">
            {error}
          </p>
          <button
            className={`${styles.button} ${styles.secondary}`}
            onClick={() =>
              setRequest((r) => ({ ...r, generation: r.generation + 1 }))
            }
          >
            重试此历史页
          </button>
        </>
      )}
      <ol className={local.history}>
        {pages
          .flatMap((p) => p.items)
          .map((item) => (
            <li
              key={`${item.draftId}/${item.revision}`}
              data-history-revision={item.revision}
            >
              <h3>
                修订 {item.revision}
                {item.revision === currentRevision ? " · 当前摘要所指" : ""}
              </h3>
              <p>
                {item.contentKind === "authored" ? "作者内容" : "合成内容"} ·{" "}
                {item.contentSchemaVersion} · 包版本 {item.packVersion}
              </p>
              <TechnicalDetails label={`修订 ${item.revision} 来源与校验摘要`}>
                <p>
                  来源 {item.sourceImportId} / {item.sourceValidationId}
                </p>
                <p>内容 {item.canonicalContentSha256}</p>
                <p>素材集合 {item.assetSetSha256}</p>
              </TechnicalDetails>
              <p>创建于 {item.createdAt}</p>
              <RevisionLinks draft={item} />
            </li>
          ))}
      </ol>
      {!loading &&
        !error &&
        last &&
        (last.nextBeforeRevision === null ? (
          <p>已读到此上界内的最早修订。</p>
        ) : (
          <button
            className={styles.button}
            onClick={() =>
              setRequest((r) => ({
                generation: r.generation + 1,
                query: {
                  pageSize: last.pageSize,
                  anchorRevision: last.anchorRevision,
                  beforeRevision: last.nextBeforeRevision!,
                },
                previous: pages,
              }))
            }
          >
            读取更早修订
          </button>
        ))}
    </section>
  );
}
