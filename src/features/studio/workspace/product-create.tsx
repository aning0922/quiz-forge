"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStudioLeaveProtection } from "../navigation-boundary";
import Link from "next/link";
import {
  productCreateSchema,
  type ProductDto,
} from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError, studioFetch, studioMessage } from "../client";
import { useWorkspaceMutation } from "./use-mutation";
import { ProductFields, type ProductFormFields } from "./product-fields";
import { ProductCard } from "./product-card";
import { ReadOnlyNotice } from "./primitives";
import { StudioPageHeader } from "../presentation/page-header";
import { subscribeStudioAuthorityInvalidation } from "../authority-events";
import { TaxonomyPicker } from "./taxonomy-picker";
import styles from "./workspace.module.css";
import task from "./product-create-task.module.css";

export type ProductCreateState = {
  dirty: boolean;
  busy: boolean;
  pending: boolean;
  revoked: boolean;
};

export function ProductCreateForm({
  session,
  embedded = false,
  actionsHost,
  onStateChange,
}: {
  session: StudioSessionDto;
  embedded?: boolean;
  actionsHost?: HTMLElement | null;
  onStateChange?: (state: ProductCreateState) => void;
}) {
  const formId = useId();
  const [id, setId] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [fields, setFields] = useState<ProductFormFields>({
    slug: "",
    title: "",
    categories: [],
    tags: [],
  });
  const [validation, setValidation] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{
    product?: ProductDto;
    absent?: boolean;
    error?: string;
  }>();
  const denied = useRef(false);
  const [revoked, setRevoked] = useState(false);
  function revoke() {
    denied.current = true;
    setRevoked(true);
  }
  function observe(error: unknown) {
    if (
      error instanceof StudioClientError &&
      [
        "UNAUTHENTICATED",
        "CAPABILITY_DENIED",
        "CSRF_REJECTED",
        "ORIGIN_REJECTED",
      ].includes(error.code)
    )
      revoke();
  }
  useEffect(() => subscribeStudioAuthorityInvalidation(revoke), []);
  const mutation = useWorkspaceMutation<ProductDto>(session.csrfToken, observe);
  const dirty = Boolean(
    id ||
    fields.slug ||
    fields.title ||
    fields.categories.length ||
    fields.tags.length,
  );
  const busy = mutation.state.phase === "submitting" || checking;
  useLayoutEffect(() => {
    onStateChange?.({ dirty, busy, pending: mutation.blocked, revoked });
  }, [onStateChange, dirty, busy, mutation.blocked, revoked]);
  const { markSaved } = useStudioLeaveProtection({
    dirty,
    pending: mutation.blocked,
  });

  async function create() {
    if (denied.current || mutation.blocked || checking) return;
    const parsed = productCreateSchema.safeParse({
      id,
      slug: fields.slug,
      title: fields.title,
      primaryCategoryId: fields.categories[0]?.id ?? null,
      tagIds: fields.tags.map((tag) => tag.id),
    });
    if (!parsed.success) {
      setValidation(
        "请检查测评编号、英文标识和名称；每个测评最多选择 8 个不重复标签。",
      );
      return;
    }
    setValidation("");
    setChecked(undefined);
    setSubmittedId(parsed.data.id);
    const product = await mutation.submit(
      "/api/studio/products",
      "POST",
      parsed.data,
      "服务器已确认创建。",
    );
    if (product && !denied.current) {
      markSaved();
      window.location.replace(
        `/studio/products/${encodeURIComponent(product.id)}`,
      );
    }
  }
  async function verify() {
    if (checking || denied.current) return;
    setChecking(true);
    setChecked(undefined);
    try {
      const product = await studioFetch<ProductDto>(
        `/api/studio/products/${encodeURIComponent(submittedId)}`,
        {},
      );
      if (!denied.current) setChecked({ product });
    } catch (error) {
      observe(error);
      setChecked(
        error instanceof StudioClientError && error.code === "PRODUCT_NOT_FOUND"
          ? { absent: true }
          : { error: studioMessage(error) },
      );
    } finally {
      setChecking(false);
    }
  }
  const submit = (
    <button
      className={embedded ? task.primary : styles.button}
      disabled={mutation.blocked || checking || revoked}
      type="submit"
      form={formId}
    >
      {mutation.state.phase === "submitting" ? "正在创建…" : "创建测评"}
    </button>
  );
  const identity = (
    <div className={styles.field}>
      <label htmlFor={`${formId}-id`}>测评编号（需与内容包一致）</label>
      <input
        className={styles.input}
        id={`${formId}-id`}
        required
        aria-describedby={`${formId}-id-help`}
        placeholder="例如 qianzai-tongxin"
        pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
        maxLength={80}
        value={id}
        disabled={mutation.blocked || revoked}
        onChange={(event) => {
          const value = event.target.value;
          setId(value);
          if (embedded && !slugEdited)
            setFields((old) => ({ ...old, slug: value }));
        }}
      />
      <p id={`${formId}-id-help`} className={styles.note}>
        使用内容包中的编号，创建后不能修改。
      </p>
    </div>
  );
  return (
    <section className={embedded ? task.formBody : styles.panel}>
      {!embedded && (
        <>
          <h2>测评信息</h2>
          <p className={styles.note}>
            测评编号必须与准备导入的内容包一致，创建后不能修改。编号和英文标识不能与已有或已归档的测评重复。
          </p>
        </>
      )}
      {revoked && (
        <p className={task.notice} role="alert">
          当前页面已失去操作权限。原输入和待核实记录保留，请在新标签重新登录后核实；重新打开弹窗不会恢复旧权限。
        </p>
      )}
      <form
        id={formId}
        aria-label="新建测评"
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <fieldset
          className={task.fields}
          disabled={mutation.blocked || revoked || checking}
        >
          {embedded ? (
            <>
              <div className={styles.field}>
                <label htmlFor={`${formId}-title`}>测评名称 *</label>
                <input
                  className={styles.input}
                  id={`${formId}-title`}
                  required
                  maxLength={120}
                  autoFocus
                  placeholder="例如：月光经过的那条街"
                  value={fields.title}
                  onChange={(event) =>
                    setFields({ ...fields, title: event.target.value })
                  }
                />
              </div>
              <div className={task.pair}>
                <TaxonomyPicker
                  kind="category"
                  compact
                  selected={fields.categories}
                  onChange={(categories) =>
                    setFields({ ...fields, categories })
                  }
                  disabled={mutation.blocked || revoked}
                  onFailure={observe}
                />
                {identity}
              </div>
              <div className={styles.field}>
                <label htmlFor={`${formId}-slug`}>测评英文标识</label>
                <input
                  className={styles.input}
                  id={`${formId}-slug`}
                  required
                  pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                  maxLength={80}
                  value={fields.slug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setFields({ ...fields, slug: event.target.value });
                  }}
                />
                <p className={styles.note}>
                  默认与编号相同，可在创建前修改；需保持唯一。
                </p>
              </div>
              <details className={task.optional}>
                <summary>添加标签（可选）</summary>
                <TaxonomyPicker
                  kind="tag"
                  compact
                  selected={fields.tags}
                  onChange={(tags) => setFields({ ...fields, tags })}
                  disabled={mutation.blocked || revoked}
                  onFailure={observe}
                />
              </details>
            </>
          ) : (
            <>
              {identity}
              <div className={styles.fieldGrid}>
                <ProductFields
                  value={fields}
                  onChange={setFields}
                  disabled={mutation.blocked || revoked}
                  onReadFailure={observe}
                />
              </div>
            </>
          )}
        </fieldset>
        {!embedded && submit}
      </form>
      {embedded && actionsHost && createPortal(submit, actionsHost)}
      {validation && (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {validation}
        </p>
      )}
      {mutation.state.message && (
        <p className={styles.status} role="status">
          {mutation.state.message}
        </p>
      )}
      {mutation.state.phase === "unknown" && (
        <section className={styles.compare} aria-label="创建结果核实">
          <p>按此次提交的测评编号 {submittedId} 查询服务器，不会重发创建。</p>
          <button
            className={styles.button}
            type="button"
            disabled={checking || revoked}
            onClick={() => void verify()}
          >
            {checking ? "正在核实…" : "核实创建结果"}
          </button>
          {checked?.error && (
            <p role="alert" className={`${styles.status} ${styles.error}`}>
              {checked.error}
            </p>
          )}
          {checked?.product && (
            <>
              <p className={styles.note}>
                服务器当前值已确认，存在此编号。不能仅凭当前值证明原请求确定成功，请查看记录。
              </p>
              <ProductCard product={checked.product} showIdentity newTab />
            </>
          )}
          {checked?.absent && (
            <>
              <p className={styles.note}>
                服务器当前查询未找到此编号，仍不能据此保证原请求从未提交。请检查后手动决定是否再次创建。
              </p>
              <button
                className={`${styles.button} ${styles.secondary}`}
                type="button"
                disabled={revoked}
                onClick={mutation.reconciled}
              >
                核实后继续编辑创建表单
              </button>
            </>
          )}
        </section>
      )}
    </section>
  );
}

export function ProductCreatePage({ session }: { session: StudioSessionDto }) {
  return (
    <div className={styles.workspace}>
      <StudioPageHeader
        title="创建测评"
        description={
          <p>先填写测评信息，再导入内容包。创建后可继续编辑分类和标签。</p>
        }
        actions={
          <Link
            className={`${styles.link} ${styles.secondary}`}
            href="/studio/products"
          >
            返回测评列表
          </Link>
        }
      />
      {session.operator.role === "operator" ? (
        <ProductCreateForm session={session} />
      ) : (
        <section className={styles.panel}>
          <ReadOnlyNotice />
        </section>
      )}
    </div>
  );
}
