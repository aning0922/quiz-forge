"use client";
import { useOwnedStudioSession } from "../accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";

import { useEffect, useState } from "react";
import { useStudioLeaveProtection } from "../navigation-boundary";
import { useProductWorkspaceContext } from "../product-workspace/context";
import {
  productReplaceMetadataSchema,
  type ProductDto,
  type ProductMutation,
} from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { studioFetch, studioMessage } from "../client";
import { useWorkspaceRead } from "./use-request";
import { useWorkspaceMutation } from "./use-mutation";
import {
  ProductFields,
  productFieldsDirty,
  type ProductFormFields,
} from "./product-fields";
import { ProductCard } from "./product-card";
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
import settings from "./product-settings.module.css";
import {
  RetainedTaskActions,
  RetainedTaskSurface,
  useOptionalWorkspaceSurfaces,
} from "../product-workspace/task-surfaces";

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
  session: initialSession,
  embedded = false,
}: {
  initial: ProductDto;
  session: StudioSessionDto;
  embedded?: boolean;
}) {
  const session = useOwnedStudioSession(initialSession);
  const authority = useInternalAuthority();
  const workspace = useProductWorkspaceContext();
  const [product, setProduct] = useState(initial);
  const [fields, setFields] = useState(() => formFields(initial));
  const [validation, setValidation] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiveMode, setArchiveMode] = useState<"archive" | "restore">(
    "archive",
  );
  const [lifecycleResult, setLifecycleResult] = useState<
    "idle" | "pending" | "complete"
  >("idle");
  const [latest, setLatest] = useState<ProductDto>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const mutation = useWorkspaceMutation<ProductMutation>(
    session.csrfToken,
    (error) => authority.observe(error),
  );
  useStudioLeaveProtection({
    dirty: productFieldsDirty(fields, product),
    pending: mutation.blocked,
  });
  const canWrite =
    roleHasCapability(session.operator.role, "workspace:write") &&
    !authority.isRevoked;
  const surfaces = useOptionalWorkspaceSurfaces();
  const reportTask = surfaces?.report;
  const dirty = productFieldsDirty(fields, product);
  const busy = mutation.state.phase === "submitting" || reading;
  const pending =
    mutation.state.phase === "unknown" || mutation.state.phase === "conflict";
  useEffect(() => {
    if (!embedded || !reportTask) return;
    reportTask("settings", {
      busy,
      pending,
      retained: dirty,
      message: pending
        ? "设置操作需要核实原结果，输入已保留。"
        : dirty
          ? "基本资料有未保存输入，收起后可继续。"
          : undefined,
    });
    reportTask("archive", { busy, pending: false, retained: false });
  }, [embedded, reportTask, busy, pending, dirty]);
  useEffect(
    () => () => {
      if (!embedded || !reportTask) return;
      reportTask("settings", { busy: false, pending: false, retained: false });
      reportTask("archive", { busy: false, pending: false, retained: false });
    },
    [embedded, reportTask],
  );
  const formId = `product-settings-form-${product.id}`;
  const Secondary = embedded ? "details" : "aside";
  const endpoint = `/api/studio/products/${encodeURIComponent(product.id)}`;

  async function save() {
    if (authority.isRevoked) return;
    const parsed = productReplaceMetadataSchema.safeParse({
      expectedMetadataRevision: product.metadataRevision,
      slug: fields.slug,
      title: fields.title,
      primaryCategoryId: fields.categories[0]?.id ?? null,
      tagIds: fields.tags.map((tag) => tag.id),
    });
    if (!parsed.success) {
      setValidation("请检查测评名称、英文标识与最多 8 个不重复标签。");
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
        result.changed
          ? "测评信息已保存。"
          : "内容没有变化，信息版本保持不变。",
      );
      if (workspace?.productId === product.id) workspace.read.refresh();
    }
  }
  async function lifecycle(action: "archive" | "restore") {
    if (!roleHasCapability(session.operator.role, "workspace:archive")) return;
    if (authority.isRevoked) return;
    setLifecycleResult("pending");
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
      setLifecycleResult("complete");
      setConfirmArchive(false);
      setValidation(
        result.changed
          ? action === "archive"
            ? "测评已归档，可随时恢复。"
            : "测评已恢复，分类和标签保持原样。"
          : "当前已是目标状态，没有重复修改。",
      );
      if (workspace?.productId === product.id) workspace.read.refresh();
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
    <section
      className={`${settings.settings} ${embedded ? settings.embedded : ""}`}
    >
      {!embedded && (
        <StudioPageHeader
          title="基本设置"
          description={
            <p>
              编辑测评目录中的名称、分类与标签。这里的设置不会改写包内内容。
            </p>
          }
        />
      )}
      {authority.isRevoked ? (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          当前页面的运营权限已失效。请重新登录并读取服务器状态后继续。
        </p>
      ) : !canWrite ? (
        <ReadOnlyNotice />
      ) : null}
      {(mutation.state.phase === "unknown" ||
        mutation.state.phase === "conflict") && (
        <p className={styles.note}>
          核对测评编号：{product.id} · 本页信息版本：{product.metadataRevision}
        </p>
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
        snapshot={
          latest ? (
            embedded ? (
              <p>
                服务器当前名称：{latest.title} · 信息修订{" "}
                {latest.metadataRevision}
              </p>
            ) : (
              <ProductCard product={latest} showIdentity />
            )
          ) : null
        }
        onRead={() => void readLatest()}
        onUseServer={() => adoptLatest(false)}
        onKeepInput={() => adoptLatest(true)}
      />
      <div className={settings.columns}>
        <div className={settings.main}>
          {roleHasCapability(session.operator.role, "workspace:write") &&
          !product.archivedAt ? (
            <section className={settings.formPanel}>
              <h2>测评信息</h2>
              <form
                id={formId}
                aria-label="测评信息"
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div
                  className={`${styles.fieldGrid} ${embedded ? settings.singleFields : ""}`}
                >
                  <ProductFields
                    compact={embedded}
                    onReadFailure={
                      embedded ? (error) => authority.observe(error) : undefined
                    }
                    value={fields}
                    onChange={setFields}
                    disabled={
                      authority.isRevoked ||
                      mutation.state.phase === "submitting"
                    }
                  />
                </div>
                {!embedded && (
                  <button
                    className={styles.button}
                    type="submit"
                    disabled={authority.isRevoked || mutation.blocked}
                  >
                    {mutation.state.phase === "submitting"
                      ? "正在提交…"
                      : "保存测评信息"}
                  </button>
                )}
              </form>
              {embedded && (
                <RetainedTaskActions id="settings">
                  <button
                    className={settings.primary}
                    type="submit"
                    form={formId}
                    disabled={authority.isRevoked || mutation.blocked}
                  >
                    {mutation.state.phase === "submitting"
                      ? "正在保存…"
                      : "保存测评信息"}
                  </button>
                </RetainedTaskActions>
              )}
            </section>
          ) : null}
          {(!roleHasCapability(session.operator.role, "workspace:write") ||
            product.archivedAt) && (
            <section className={settings.formPanel}>
              <h2>测评信息</h2>
              <p>名称：{product.title}</p>
              <p>英文标识：{product.slug}</p>
              <dl className={`${styles.facts} ${styles.overviewFacts}`}>
                <div>
                  <dt>状态</dt>
                  <dd>{product.archivedAt ? "已归档 · 信息只读" : "未归档"}</dd>
                </div>
                <div>
                  <dt>分类</dt>
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
                            (tag) =>
                              `${tag.name}${tag.archivedAt ? " · 已归档" : ""}`,
                          )
                          .join("、")
                      : "无"}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
        <Secondary className={settings.side} aria-label="低频与技术设置">
          {embedded && <summary>标识、状态与归档</summary>}
          <section className={settings.identityPanel}>
            <h2>目录状态与技术身份</h2>
            <p>{product.archivedAt ? "已归档 · 信息只读" : "未归档"}</p>
            <p className={styles.note}>
              测评编号与已有记录保持关联；设置不会改写题目、评分或历史报告。
            </p>
            <TechnicalDetails label="测评支持信息">
              <p>测评编号（创建后不可改）：{product.id}</p>
              <p>英文标识：{product.slug}</p>
              <p>信息版本：{product.metadataRevision}</p>
              <p>创建时间：{product.createdAt}</p>
              <p>最近更新时间：{product.updatedAt}</p>
            </TechnicalDetails>
          </section>
          {canWrite &&
            roleHasCapability(session.operator.role, "workspace:archive") && (
              <section className={settings.lifecycle} aria-label="其他操作">
                <h2>归档与恢复</h2>
                {product.archivedAt ? (
                  <>
                    <p className={styles.note}>
                      恢复测评后可以继续编辑。已归档的分类和标签不会自动恢复，原有关联仍可保留或移除。
                    </p>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={mutation.blocked}
                      onClick={() => {
                        if (!embedded) {
                          void lifecycle("restore");
                          return;
                        }
                        setArchiveMode("restore");
                        setLifecycleResult("idle");
                        surfaces?.open("archive");
                      }}
                    >
                      恢复测评
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={`${styles.button} ${styles.secondary}`}
                      type="button"
                      disabled={mutation.blocked}
                      onClick={() => {
                        setConfirmArchive(true);
                        if (embedded) {
                          setArchiveMode("archive");
                          setLifecycleResult("idle");
                          surfaces?.open("archive");
                        }
                      }}
                    >
                      归档测评
                    </button>
                    {confirmArchive && !embedded && (
                      <section className={styles.compare} aria-label="归档说明">
                        <p>
                          归档后测评信息只读，原有分类和标签保留；编号与英文标识不释放。之后可以恢复测评再编辑。
                        </p>
                        <div className={styles.actions}>
                          <button
                            className={styles.button}
                            type="button"
                            disabled={mutation.blocked}
                            onClick={() => void lifecycle("archive")}
                          >
                            确认归档测评
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
              </section>
            )}
        </Secondary>
      </div>
      {embedded && (
        <RetainedTaskSurface id="archive">
          <div className={settings.archiveTask}>
            <h3>
              {archiveMode === "archive" ? "归档这款测评" : "恢复这款测评"}
            </h3>
            <p className={settings.target}>{product.title}</p>
            <p>
              {archiveMode === "archive"
                ? "归档后目录资料只读，已有内容、内测版本和报告保留。之后仍可恢复。"
                : "恢复后可以继续编辑目录资料；原有内容和分类关联保留。"}
            </p>
            {lifecycleResult !== "idle" && mutation.state.message && (
              <p role="status">{mutation.state.message}</p>
            )}
            {lifecycleResult !== "idle" && validation && (
              <p role="status">{validation}</p>
            )}
            <ReconcilePanel
              state={mutation.state}
              reading={reading}
              readError={readError}
              snapshot={
                latest ? (
                  <p>
                    服务器状态：{latest.archivedAt ? "已归档" : "未归档"} ·
                    信息修订 {latest.metadataRevision}
                  </p>
                ) : null
              }
              onRead={() => void readLatest()}
              onUseServer={() => adoptLatest(false)}
              onKeepInput={() => adoptLatest(true)}
            />
            <RetainedTaskActions id="archive">
              {lifecycleResult === "complete" ? (
                <button
                  className={settings.primary}
                  onClick={() => surfaces?.open("settings")}
                >
                  返回基本设置
                </button>
              ) : (
                <button
                  className={settings.primary}
                  disabled={authority.isRevoked || mutation.blocked}
                  onClick={() => void lifecycle(archiveMode)}
                >
                  {busy
                    ? "正在提交…"
                    : archiveMode === "archive"
                      ? "确认归档测评"
                      : "确认恢复测评"}
                </button>
              )}
            </RetainedTaskActions>
          </div>
        </RetainedTaskSurface>
      )}
    </section>
  );
}

function ProductDetailContent({
  productId,
  session: initialSession,
  embedded = false,
}: {
  productId: string;
  session: StudioSessionDto;
  embedded?: boolean;
}) {
  const session = useOwnedStudioSession(initialSession);
  const authority = useInternalAuthority(),
    read = useWorkspaceRead<ProductDto>(
      `/api/studio/products/${encodeURIComponent(productId)}`,
      (error) => authority.observe(error),
    );
  return (
    <div className={styles.workspace}>
      {!embedded && (
        <>
          <WorkspaceNav />
        </>
      )}
      {read.loading && (
        <p className={styles.status} role="status">
          正在读取测评…
        </p>
      )}
      {read.error && (
        <section className={`${styles.panel} ${styles.error}`} role="alert">
          <h1>测评信息暂未读取</h1>
          <p>{read.error}</p>
          <button
            className={styles.button}
            type="button"
            onClick={read.refresh}
          >
            重新读取测评
          </button>
        </section>
      )}
      {read.value && (
        <ProductEditor
          key={read.value.id}
          initial={read.value}
          session={session}
          embedded={embedded}
        />
      )}
      {!embedded && (
        <StableInternalWorkspace
          key={productId}
          productId={productId}
          session={session}
          showEntry={false}
        />
      )}
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
