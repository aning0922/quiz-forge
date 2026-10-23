"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import styles from "./workspace.module.css";

function ProductCreateForm({ session }: { session: StudioSessionDto }) {
  const router = useRouter();
  const [id, setId] = useState("");
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
  const mutation = useWorkspaceMutation<ProductDto>(session.csrfToken);

  async function create() {
    const parsed = productCreateSchema.safeParse({
      id,
      slug: fields.slug,
      title: fields.title,
      primaryCategoryId: fields.categories[0]?.id ?? null,
      tagIds: fields.tags.map((tag) => tag.id),
    });
    if (!parsed.success) {
      setValidation("请检查稳定 ID、slug、标题长度与最多 8 个不重复标签。");
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
    if (product) {
      router.push(`/studio/products/${encodeURIComponent(product.id)}`);
      router.refresh();
    }
  }
  async function verify() {
    if (checking) return;
    setChecking(true);
    setChecked(undefined);
    try {
      const product = await studioFetch<ProductDto>(
        `/api/studio/products/${encodeURIComponent(submittedId)}`,
        {},
      );
      setChecked({ product });
    } catch (error) {
      setChecked(
        error instanceof StudioClientError && error.code === "PRODUCT_NOT_FOUND"
          ? { absent: true }
          : { error: studioMessage(error) },
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <section className={styles.panel}>
      <h2>商品信息</h2>
      <p className={styles.note}>
        稳定 ID 创建后不能修改。归档记录仍保留 ID 与
        slug。创建后可进入工作区接收原包、验证归档并查看草稿与内测版本。
      </p>
      <form
        aria-label="新建工作区"
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className={styles.field}>
          <label htmlFor="product-id">稳定 ID</label>
          <input
            className={styles.input}
            id="product-id"
            required
            pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
            maxLength={80}
            value={id}
            disabled={mutation.blocked}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <div className={styles.fieldGrid}>
          <ProductFields
            value={fields}
            onChange={setFields}
            disabled={mutation.state.phase === "submitting"}
          />
        </div>
        <button
          className={styles.button}
          disabled={mutation.blocked}
          type="submit"
        >
          {mutation.state.phase === "submitting" ? "正在创建…" : "创建工作区"}
        </button>
      </form>
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
          <p>按此次提交的稳定 ID {submittedId} 查询服务器，不会重发创建。</p>
          <button
            className={styles.button}
            type="button"
            disabled={checking}
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
                服务器当前值已确认，存在此
                ID。不能仅凭当前值证明原请求确定成功，请查看记录。
              </p>
              <ProductCard product={checked.product} showIdentity />
            </>
          )}
          {checked?.absent && (
            <>
              <p className={styles.note}>
                服务器当前查询未找到此
                ID，仍不能据此保证原请求从未提交。请检查后手动决定是否再次创建。
              </p>
              <button
                className={`${styles.button} ${styles.secondary}`}
                type="button"
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
        title="创建商品"
        description={<p>先建立测评的稳定工作区，再导入内容并逐步审核。</p>}
        actions={
          <Link
            className={`${styles.link} ${styles.secondary}`}
            href="/studio/products"
          >
            返回商品列表
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
