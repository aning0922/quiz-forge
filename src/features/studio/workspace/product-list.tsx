"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  productCreateSchema,
  type Page,
  type ProductDto,
  type TaxonomySummary,
} from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError, studioFetch, studioMessage } from "../client";
import { useWorkspaceRead } from "./use-request";
import { useWorkspaceMutation } from "./use-mutation";
import { WorkspaceNav, Pagination, ReadOnlyNotice } from "./primitives";
import { FilterBar } from "./filter-bar";
import { TaxonomyPicker } from "./taxonomy-picker";
import { ProductFields, type ProductFormFields } from "./product-fields";
import styles from "./workspace.module.css";

export function ProductCard({ product }: { product: ProductDto }) {
  return (
    <article className={styles.card}>
      <h2>{product.title}</h2>
      <p>稳定 ID：{product.id}</p>
      <p>slug：{product.slug}</p>
      <p>
        主类目：
        {product.primaryCategory
          ? `${product.primaryCategory.name} · ${product.primaryCategory.slug}${product.primaryCategory.archivedAt ? " · 已归档" : ""}`
          : "未分类"}
      </p>
      <p>
        标签：
        {product.tags.length
          ? product.tags.map((tag) => (
              <span
                className={`${styles.badge} ${tag.archivedAt ? styles.archived : ""}`}
                key={tag.id}
              >
                {tag.name} · {tag.slug}
                {tag.archivedAt ? " · 已归档" : ""}
              </span>
            ))
          : "无"}
      </p>
      {product.archivedAt && (
        <p className={`${styles.badge} ${styles.archived}`}>工作区已归档</p>
      )}
      <Link
        className={styles.link}
        href={`/studio/products/${encodeURIComponent(product.id)}`}
      >
        查看工作区 {product.id}
      </Link>
    </article>
  );
}

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
      <h2>创建工作区</h2>
      <p className={styles.note}>
        稳定 ID 创建后不能修改。归档记录仍保留 ID 与
        slug。本阶段尚未接入草稿与导入。
      </p>
      <form
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
        <ProductFields
          value={fields}
          onChange={setFields}
          disabled={mutation.state.phase === "submitting"}
        />
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
              <ProductCard product={checked.product} />
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

export function ProductList({ session }: { session: StudioSessionDto }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState({
    q: "",
    status: "active",
    categoryId: "",
    tagId: "",
    unclassified: false,
  });
  const [categories, setCategories] = useState<TaxonomySummary[]>([]);
  const [tags, setTags] = useState<TaxonomySummary[]>([]);
  const [unclassified, setUnclassified] = useState(false);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    status: query.status,
    q: query.q,
    unclassified: String(query.unclassified),
  });
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.tagId) params.set("tagId", query.tagId);
  const read = useWorkspaceRead<Page<ProductDto>>(
    `/api/studio/products?${params}`,
  );
  const filtered = Boolean(
    query.q ||
    query.categoryId ||
    query.tagId ||
    query.unclassified ||
    query.status !== "active",
  );
  return (
    <div className={styles.workspace}>
      <WorkspaceNav />
      <section className={styles.panel}>
        <h1>测评工作区</h1>
        <p className={styles.note}>
          每个工作区是一个测评的稳定归属。这里管理运营标题、目录关联与归档。
        </p>
        {session.operator.role === "read-only" && <ReadOnlyNotice />}
        <FilterBar
          busy={read.loading}
          onFilter={(q, status) => {
            setQuery({
              q,
              status,
              categoryId: categories[0]?.id ?? "",
              tagId: tags[0]?.id ?? "",
              unclassified,
            });
            setPage(1);
          }}
        >
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={unclassified}
              onChange={(event) => {
                setUnclassified(event.target.checked);
                if (event.target.checked) setCategories([]);
              }}
            />
            仅未分类工作区
          </label>
          <TaxonomyPicker
            purpose="filter"
            kind="category"
            selected={categories}
            onChange={(items) => {
              setCategories(items);
              if (items.length) setUnclassified(false);
            }}
          />
          <TaxonomyPicker
            purpose="filter"
            kind="tag"
            selected={tags}
            onChange={(items) => setTags(items.slice(-1))}
          />
        </FilterBar>
        {read.loading && (
          <p className={styles.status} role="status">
            正在加载工作区…
          </p>
        )}
        {read.error && (
          <div className={`${styles.status} ${styles.error}`} role="alert">
            <p>{read.error}</p>
            <button
              className={styles.button}
              type="button"
              onClick={read.refresh}
            >
              重新读取工作区
            </button>
          </div>
        )}
        {read.value && (
          <>
            <p className={styles.note}>共 {read.value.total} 个工作区</p>
            {!read.value.items.length && (
              <p className={styles.status}>
                {filtered ? "当前筛选无结果" : "尚无工作区"}
              </p>
            )}
            <ul className={styles.cards}>
              {read.value.items.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              hasNext={read.value.hasNext}
              busy={read.loading}
              onPage={setPage}
            />
            <button
              className={`${styles.button} ${styles.secondary}`}
              type="button"
              onClick={read.refresh}
            >
              刷新列表
            </button>
          </>
        )}
      </section>
      {session.operator.role === "operator" && (
        <ProductCreateForm session={session} />
      )}
    </div>
  );
}
