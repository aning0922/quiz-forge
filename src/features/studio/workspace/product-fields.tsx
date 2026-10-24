"use client";

import type {
  ProductDto,
  TaxonomySummary,
} from "@/features/product/workspace/contracts";
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
        <label htmlFor="product-title">测评名称</label>
        <input
          className={styles.input}
          id="product-title"
          aria-describedby="product-title-help"
          value={value.title}
          required
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, title: event.target.value })
          }
        />
        <p id="product-title-help" className={styles.note}>
          填写运营时容易识别的名称，例如“千载同心”，最多 120 个字符。
        </p>
      </div>
      <div className={styles.field}>
        <label htmlFor="product-slug">测评英文标识</label>
        <input
          className={styles.input}
          id="product-slug"
          aria-describedby="product-slug-help"
          placeholder="例如 qianzai-tongxin"
          value={value.slug}
          required
          pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
          maxLength={80}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, slug: event.target.value })}
        />
        <p id="product-slug-help" className={styles.note}>
          用于区分测评，例如
          qianzai-tongxin。可与测评编号相同；使用小写字母、数字和连字符，最多 80
          字符，不能与其他测评重复。
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

/** Names/labels refreshed on associations do not change the actual metadata IDs. */
export function productFieldsDirty(
  value: ProductFormFields,
  saved: ProductDto,
): boolean {
  return (
    value.title !== saved.title ||
    value.slug !== saved.slug ||
    (value.categories[0]?.id ?? null) !== (saved.primaryCategory?.id ?? null) ||
    value.categories.length > 1 ||
    value.tags.length !== saved.tags.length ||
    value.tags.some(
      (tag) => !saved.tags.some((original) => original.id === tag.id),
    )
  );
}
