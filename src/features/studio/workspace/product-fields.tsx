"use client";

import type { TaxonomySummary } from "@/features/product/workspace/contracts";
import { TaxonomyPicker } from "./taxonomy-picker";
import styles from "./workspace.module.css";

// Local form state; public payloads and responses always use the A-owned contracts.
export type ProductFormFields = {
  slug: string;
  title: string;
  categories: TaxonomySummary[];
  tags: TaxonomySummary[];
};

export function ProductFields({
  value,
  onChange,
  disabled,
}: {
  value: ProductFormFields;
  onChange: (value: ProductFormFields) => void;
  disabled: boolean;
}) {
  return (
    <>
      <div className={styles.field}>
        <label htmlFor="product-title">显示标题</label>
        <input
          className={styles.input}
          id="product-title"
          value={value.title}
          required
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, title: event.target.value })
          }
        />
        <p className={styles.note}>1–120 个字符，作为纯文本显示。</p>
      </div>
      <div className={styles.field}>
        <label htmlFor="product-slug">工作区 slug</label>
        <input
          className={styles.input}
          id="product-slug"
          value={value.slug}
          required
          pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
          maxLength={80}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, slug: event.target.value })}
        />
        <p className={styles.note}>
          小写字母开头，可含数字与单个连字符分段，最多 80 字符。
        </p>
      </div>
      <TaxonomyPicker
        kind="category"
        selected={value.categories}
        onChange={(categories) => onChange({ ...value, categories })}
        disabled={disabled}
      />
      <TaxonomyPicker
        kind="tag"
        selected={value.tags}
        onChange={(tags) => onChange({ ...value, tags })}
        disabled={disabled}
      />
    </>
  );
}
