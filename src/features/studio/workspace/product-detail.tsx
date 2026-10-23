"use client";

import { useState } from "react";
import {
  productReplaceMetadataSchema,
  type ProductDto,
  type ProductMutation,
} from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { studioFetch, studioMessage } from "../client";
import { useWorkspaceRead } from "./use-request";
import { useWorkspaceMutation } from "./use-mutation";
import { ProductFields, type ProductFormFields } from "./product-fields";
import { ProductCard } from "./product-card";
import { StudioWorkflowNav } from "../presentation/workflow-nav";
import { StudioPageHeader } from "../presentation/page-header";
import { TechnicalDetails } from "../presentation/technical-details";
import { WorkspaceNav, ReadOnlyNotice } from "./primitives";
import { ReconcilePanel } from "./reconcile-panel";
import {
  InternalAuthorityProvider,
  useInternalAuthority,
} from "../internal-versions/authority";
import { StableInternalWorkspace } from "../internal-versions/pages";
import styles from "./workspace.module.css";

function formFields(product: ProductDto): ProductFormFields {
  return {
    slug: product.slug,
    title: product.title,
    categories: product.primaryCategory ? [product.primaryCategory] : [],
    tags: product.tags,
  };
}

function ProductEditor({
  initial,
  session,
}: {
  initial: ProductDto;
  session: StudioSessionDto;
}) {
  const authority = useInternalAuthority();
  const [product, setProduct] = useState(initial);
  const [fields, setFields] = useState(() => formFields(initial));
  const [validation, setValidation] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [latest, setLatest] = useState<ProductDto>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const mutation = useWorkspaceMutation<ProductMutation>(
    session.csrfToken,
    (error) => authority.observe(error),
  );
  const canWrite = session.operator.role === "operator" && !authority.isRevoked;
  const endpoint = `/api/studio/products/${encodeURIComponent(product.id)}`;

  async function save() {
    const parsed = productReplaceMetadataSchema.safeParse({
      expectedMetadataRevision: product.metadataRevision,
      slug: fields.slug,
      title: fields.title,
      primaryCategoryId: fields.categories[0]?.id ?? null,
      tagIds: fields.tags.map((tag) => tag.id),
    });
    if (!parsed.success) {
      setValidation("请检查 slug、标题与最多 8 个不重复标签。");
      return;
    }
    setValidation("");
    setLatest(undefined);
    const result = await mutation.submit(
      endpoint,
      "PATCH",
      parsed.data,
      "服务器已确认保存请求。",
    );
    if (result) {
      setProduct(result.product);
      setFields(formFields(result.product));
      setValidation(
        result.changed ? "元数据已保存。" : "内容相同，服务器未增加修订。",
      );
    }
  }
  async function lifecycle(action: "archive" | "restore") {
    setLatest(undefined);
    setValidation("");
    const result = await mutation.submit(
      `${endpoint}/${action}`,
      "POST",
      { expectedMetadataRevision: product.metadataRevision },
      action === "archive"
        ? "服务器已确认归档请求。"
        : "服务器已确认恢复请求。",
    );
    if (result) {
      setProduct(result.product);
      setConfirmArchive(false);
      setValidation(
        result.changed
          ? action === "archive"
            ? "工作区已归档，可随时恢复。"
            : "工作区已恢复，目录关联保持原样。"
          : "服务器已处于目标状态，没有增加修订。",
      );
    }
  }
  async function readLatest() {
    if (reading) return;
    setReading(true);
    setLatest(undefined);
    setReadError("");
    try {
      setLatest(await studioFetch<ProductDto>(endpoint, {}));
    } catch (error) {
      authority.observe(error);
      setReadError(studioMessage(error));
    } finally {
      setReading(false);
    }
  }
  function adoptLatest(keepInput: boolean) {
    if (!latest) return;
    setProduct(latest);
    if (!keepInput) setFields(formFields(latest));
    mutation.reconciled();
    setLatest(undefined);
    setConfirmArchive(false);
  }

  return (
    <section className={`${styles.panel} ${styles.productOverview}`}>
      <StudioPageHeader
        title={product.title}
        description={<p>商品概览 · 运营元数据与包内声明分别保留。</p>}
      />
      <dl className={styles.facts}>
        <div>
          <dt>稳定 ID（不可改）</dt>
          <dd>{product.id}</dd>
        </div>
        <div>
          <dt>元数据修订</dt>
          <dd>{product.metadataRevision}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{product.archivedAt ? "已归档 · 元数据只读" : "未归档"}</dd>
        </div>
      </dl>
      <dl className={`${styles.facts} ${styles.overviewFacts}`}>
        <div>
          <dt>主类目</dt>
          <dd>
            {product.primaryCategory
              ? `${product.primaryCategory.name} · ${product.primaryCategory.slug}${product.primaryCategory.archivedAt ? " · 已归档" : ""}`
              : "未分类"}
          </dd>
        </div>
        <div>
          <dt>标签</dt>
          <dd>
            {product.tags.length
              ? product.tags
                  .map(
                    (tag) => `${tag.name}${tag.archivedAt ? " · 已归档" : ""}`,
                  )
                  .join("、")
              : "无"}
          </dd>
        </div>
      </dl>
      <TechnicalDetails label="商品支持信息">
        <p>slug：{product.slug}</p>
        <p>创建时间：{product.createdAt}</p>
        <p>最近更新时间：{product.updatedAt}</p>
      </TechnicalDetails>
      {authority.isRevoked ? (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          当前页面的运营权限已失效。请重新登录并读取服务器状态后继续。
        </p>
      ) : !canWrite ? (
        <ReadOnlyNotice />
      ) : null}
      {canWrite && !product.archivedAt ? (
        <details className={styles.editor}>
          <summary>编辑商品信息</summary>
          <form
            aria-label="工作区元数据"
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className={styles.fieldGrid}>
              <ProductFields
                value={fields}
                onChange={setFields}
                disabled={mutation.state.phase === "submitting"}
              />
            </div>
            <button
              className={styles.button}
              type="submit"
              disabled={mutation.blocked}
            >
              {mutation.state.phase === "submitting"
                ? "正在提交…"
                : "保存元数据"}
            </button>
          </form>
        </details>
      ) : null}

      {canWrite && (
        <div className={styles.form}>
          {product.archivedAt ? (
            <>
              <p className={styles.note}>
                恢复不会连带恢复已归档的目录。原有关联仍可保留或移除。
              </p>
              <button
                className={styles.button}
                type="button"
                disabled={mutation.blocked}
                onClick={() => void lifecycle("restore")}
              >
                恢复工作区
              </button>
            </>
          ) : (
            <>
              <button
                className={`${styles.button} ${styles.secondary}`}
                type="button"
                disabled={mutation.blocked}
                onClick={() => setConfirmArchive(true)}
              >
                归档工作区
              </button>
              {confirmArchive && (
                <section className={styles.compare} aria-label="归档说明">
                  <p>
                    归档后元数据只读，已有目录关联保留，ID 与 slug
                    不释放。可以通过恢复重新编辑。
                  </p>
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={mutation.blocked}
                      onClick={() => void lifecycle("archive")}
                    >
                      确认归档工作区
                    </button>
                    <button
                      className={`${styles.button} ${styles.secondary}`}
                      type="button"
                      disabled={mutation.blocked}
                      onClick={() => setConfirmArchive(false)}
                    >
                      取消归档
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
      {validation && (
        <p className={styles.status} role="status">
          {validation}
        </p>
      )}
      {mutation.state.message && (
        <p
          className={`${styles.status} ${mutation.state.phase === "error" ? styles.error : ""}`}
          role="status"
        >
          {mutation.state.message}
        </p>
      )}
      <ReconcilePanel
        state={mutation.state}
        reading={reading}
        readError={readError}
        snapshot={latest ? <ProductCard product={latest} showIdentity /> : null}
        onRead={() => void readLatest()}
        onUseServer={() => adoptLatest(false)}
        onKeepInput={() => adoptLatest(true)}
      />
    </section>
  );
}

function ProductDetailContent({
  productId,
  session,
}: {
  productId: string;
  session: StudioSessionDto;
}) {
  const authority = useInternalAuthority(),
    read = useWorkspaceRead<ProductDto>(
      `/api/studio/products/${encodeURIComponent(productId)}`,
      (error) => authority.observe(error),
    );
  return (
    <div className={styles.workspace}>
      <WorkspaceNav />
      <StudioWorkflowNav productId={productId} current="product" />
      {read.loading && (
        <p className={styles.status} role="status">
          正在读取工作区…
        </p>
      )}
      {read.error && (
        <section className={`${styles.panel} ${styles.error}`} role="alert">
          <h1>工作区读取未完成</h1>
          <p>{read.error}</p>
          <button
            className={styles.button}
            type="button"
            onClick={read.refresh}
          >
            重新读取工作区
          </button>
        </section>
      )}
      {read.value && (
        <ProductEditor
          key={read.value.id}
          initial={read.value}
          session={session}
        />
      )}
      <StableInternalWorkspace
        key={productId}
        productId={productId}
        session={session}
      />
    </div>
  );
}

export function ProductDetail(
  props: Parameters<typeof ProductDetailContent>[0],
) {
  return (
    <InternalAuthorityProvider
      key={props.productId}
      productId={props.productId}
    >
      <ProductDetailContent {...props} />
    </InternalAuthorityProvider>
  );
}
