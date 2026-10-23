"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  taxonomyCreateSchema,
  taxonomyRenameSchema,
  type Page,
  type TaxonomyDto,
  type TaxonomyKind,
  type TaxonomyMutation,
} from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { studioFetch, studioMessage } from "../client";
import { useWorkspaceRead } from "./use-request";
import { useWorkspaceMutation, type MutationState } from "./use-mutation";
import { taxonomyPath } from "./taxonomy-picker";
import { WorkspaceNav, ReadOnlyNotice, Pagination } from "./primitives";
import { FilterBar } from "./filter-bar";
import { ReconcilePanel } from "./reconcile-panel";
import styles from "./workspace.module.css";

function summary(item: TaxonomyDto) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>名称与英文标识</dt>
        <dd>
          {item.name} · {item.slug}
        </dd>
      </div>
      <div>
        <dt>信息版本与状态</dt>
        <dd>
          {item.revision} · {item.archivedAt ? "已归档" : "未归档"}
        </dd>
      </div>
      <div>
        <dt>关联测评（含归档）</dt>
        <dd>{item.assignedProductCount}</dd>
      </div>
    </dl>
  );
}

type RowProtection = "dirty" | "submitting" | "reconcile" | null;
function rowProtection(
  name: string,
  savedName: string,
  phase: MutationState["phase"],
): RowProtection {
  if (phase === "submitting") return "submitting";
  if (phase === "unknown" || phase === "conflict") return "reconcile";
  return name !== savedName ? "dirty" : null;
}

function TaxonomyRow({
  initial,
  kind,
  session,
  onProtectionChange,
}: {
  initial: TaxonomyDto;
  kind: TaxonomyKind;
  session: StudioSessionDto;
  onProtectionChange: (id: string, protection: RowProtection) => void;
}) {
  const [item, setItem] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [validation, setValidation] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [latest, setLatest] = useState<TaxonomyDto>();
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const mutation = useWorkspaceMutation<TaxonomyMutation>(session.csrfToken);
  const endpoint = `${taxonomyPath(kind)}/${item.id}`;
  const label = kind === "category" ? "分类" : "标签";
  const protection = rowProtection(name, item.name, mutation.state.phase);
  useEffect(() => {
    onProtectionChange(item.id, protection);
  }, [item.id, protection, onProtectionChange]);
  useEffect(
    () => () => onProtectionChange(item.id, null),
    [item.id, onProtectionChange],
  );
  async function rename() {
    if (mutation.blocked) return;
    const parsed = taxonomyRenameSchema.safeParse({
      expectedRevision: item.revision,
      name,
    });
    if (!parsed.success) {
      setValidation(
        "名称须为 1–40 个 Unicode 字符，不含控制字符、换行或尖括号。",
      );
      return;
    }
    setValidation("");
    setLatest(undefined);
    onProtectionChange(item.id, "submitting");
    const result = await mutation.submit(
      endpoint,
      "PATCH",
      parsed.data,
      "服务器已确认名称保存请求。",
    );
    if (result) {
      onProtectionChange(item.id, null);
      setItem(result.item);
      setName(result.item.name);
      setValidation(
        result.changed
          ? "名称已保存，英文标识保持不变。"
          : "名称相同，服务器未增加修订。",
      );
    }
  }
  async function lifecycle(action: "archive" | "restore") {
    if (mutation.blocked) return;
    onProtectionChange(item.id, "submitting");
    setLatest(undefined);
    setValidation("");
    const result = await mutation.submit(
      `${endpoint}/${action}`,
      "POST",
      { expectedRevision: item.revision },
      action === "archive"
        ? "服务器已确认归档请求。"
        : "服务器已确认恢复请求。",
    );
    if (result) {
      onProtectionChange(
        item.id,
        rowProtection(name, result.item.name, "idle"),
      );
      setItem(result.item);
      setConfirm(false);
      setValidation(
        result.changed
          ? action === "archive"
            ? "目录已归档，可恢复。"
            : "目录已恢复。"
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
      const params = new URLSearchParams({
        slug: item.slug,
        status: "all",
        pageSize: "1",
      });
      const page = await studioFetch<Page<TaxonomyDto>>(
        `${taxonomyPath(kind)}?${params}`,
        {},
      );
      const found = page.items.find((value) => value.id === item.id);
      if (found) setLatest(found);
      else
        setReadError("当前服务器查询未找到此目录，请刷新会话或由维护者检查。");
    } catch (error) {
      setReadError(studioMessage(error));
    } finally {
      setReading(false);
    }
  }
  function reconcile(keep: boolean) {
    if (!latest) return;
    onProtectionChange(
      item.id,
      rowProtection(keep ? name : latest.name, latest.name, "idle"),
    );
    setItem(latest);
    if (!keep) setName(latest.name);
    setLatest(undefined);
    setConfirm(false);
    mutation.reconciled();
  }
  return (
    <article className={styles.card} aria-label={`${label} ${item.slug}`}>
      <h3>{item.name}</h3>
      {summary(item)}
      {session.operator.role === "operator" && (
        <>
          {!item.archivedAt && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <div className={styles.field}>
                <label htmlFor={`name-${item.id}`}>
                  显示名称 · {item.slug}
                </label>
                <input
                  className={styles.input}
                  id={`name-${item.id}`}
                  required
                  value={name}
                  disabled={mutation.state.phase === "submitting"}
                  onChange={(event) => {
                    onProtectionChange(
                      item.id,
                      rowProtection(
                        event.target.value,
                        item.name,
                        mutation.state.phase,
                      ),
                    );
                    setName(event.target.value);
                  }}
                />
              </div>
              <button
                className={styles.button}
                type="submit"
                disabled={mutation.blocked}
              >
                保存名称
              </button>
            </form>
          )}
          <div className={styles.form}>
            {item.archivedAt ? (
              <button
                className={styles.button}
                type="button"
                disabled={mutation.blocked}
                onClick={() => void lifecycle("restore")}
              >
                恢复{label}
              </button>
            ) : (
              <button
                className={`${styles.button} ${styles.secondary}`}
                type="button"
                disabled={mutation.blocked}
                onClick={() => setConfirm(true)}
              >
                归档{label}
              </button>
            )}
            {confirm && (
              <section className={styles.compare} aria-label="目录归档说明">
                <p>
                  当前关联 {item.assignedProductCount}{" "}
                  个测评（含归档）。归档后旧关联仍可保留或移除，不能新增分配；恢复后可再次分配。此数量只用于说明，不决定写权限。
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    type="button"
                    disabled={mutation.blocked}
                    onClick={() => void lifecycle("archive")}
                  >
                    确认归档{label}
                  </button>
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    type="button"
                    disabled={mutation.blocked}
                    onClick={() => setConfirm(false)}
                  >
                    取消归档
                  </button>
                </div>
              </section>
            )}
          </div>
        </>
      )}
      {validation && (
        <p className={styles.status} role="status">
          {validation}
        </p>
      )}
      {mutation.state.message && (
        <p className={styles.status} role="status">
          {mutation.state.message}
        </p>
      )}
      <ReconcilePanel
        state={mutation.state}
        reading={reading}
        readError={readError}
        snapshot={latest ? summary(latest) : null}
        onRead={() => void readLatest()}
        onUseServer={() => reconcile(false)}
        onKeepInput={() => reconcile(true)}
      />
    </article>
  );
}

function TaxonomyCreateForm({
  kind,
  session,
  onCreated,
  onProtectionChange,
}: {
  kind: TaxonomyKind;
  session: StudioSessionDto;
  onCreated: () => void;
  onProtectionChange: (protectedState: boolean) => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [validation, setValidation] = useState("");
  const [submittedSlug, setSubmittedSlug] = useState("");
  const [reading, setReading] = useState(false);
  const [checked, setChecked] = useState<{
    item?: TaxonomyDto;
    absent?: boolean;
    error?: string;
  }>();
  const mutation = useWorkspaceMutation<TaxonomyDto>(session.csrfToken);
  useEffect(() => {
    onProtectionChange(mutation.blocked);
  }, [mutation.blocked, onProtectionChange]);
  useEffect(() => () => onProtectionChange(false), [onProtectionChange]);
  const label = kind === "category" ? "分类" : "标签";
  async function create() {
    if (mutation.blocked) return;
    const parsed = taxonomyCreateSchema.safeParse({ slug, name });
    if (!parsed.success) {
      setValidation("请检查名称（1–40 字符）和英文标识（最多 80 字符）。");
      return;
    }
    setValidation("");
    setChecked(undefined);
    setSubmittedSlug(parsed.data.slug);
    onProtectionChange(true);
    const result = await mutation.submit(
      taxonomyPath(kind),
      "POST",
      parsed.data,
      "服务器已确认创建目录。",
    );
    if (result) {
      onProtectionChange(false);
      setSlug("");
      setName("");
      onCreated();
    }
  }
  async function verify() {
    if (reading) return;
    setReading(true);
    setChecked(undefined);
    try {
      const params = new URLSearchParams({
        slug: submittedSlug,
        status: "all",
        pageSize: "1",
      });
      const result = await studioFetch<Page<TaxonomyDto>>(
        `${taxonomyPath(kind)}?${params}`,
        {},
      );
      const found = result.items.find((item) => item.slug === submittedSlug);
      setChecked(found ? { item: found } : { absent: true });
    } catch (error) {
      setChecked({ error: studioMessage(error) });
    } finally {
      setReading(false);
    }
  }
  return (
    <section className={styles.panel}>
      <h2>创建{label}</h2>
      <p className={styles.note}>
        英文标识创建后固定，归档不释放，例如
        historical。名称允许重复，选择时可用英文标识区分。
      </p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className={styles.field}>
          <label htmlFor="taxonomy-create-name">名称</label>
          <input
            className={styles.input}
            id="taxonomy-create-name"
            required
            value={name}
            disabled={mutation.state.phase === "submitting"}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="taxonomy-create-slug">英文标识</label>
          <input
            className={styles.input}
            id="taxonomy-create-slug"
            required
            maxLength={80}
            pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
            value={slug}
            disabled={mutation.blocked}
            onChange={(event) => setSlug(event.target.value)}
          />
        </div>
        <button
          className={styles.button}
          type="submit"
          disabled={mutation.blocked}
        >
          {mutation.state.phase === "submitting" ? "正在创建…" : `创建${label}`}
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
        <section className={styles.compare} aria-label="目录创建核实">
          <p>按英文标识 {submittedSlug} 精确读取全部归档状态，不会重发创建。</p>
          <button
            className={styles.button}
            type="button"
            disabled={reading}
            onClick={() => void verify()}
          >
            {reading ? "正在核实…" : "核实目录创建结果"}
          </button>
          {checked?.error && (
            <p className={`${styles.status} ${styles.error}`} role="alert">
              {checked.error}
            </p>
          )}
          {checked?.item && (
            <>
              <p className={styles.note}>
                服务器当前值已确认，存在此英文标识。这不能证明原请求确定成功，请核对记录。
              </p>
              {summary(checked.item)}
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  mutation.reconciled();
                  setSlug("");
                  setName("");
                  setChecked(undefined);
                  onCreated();
                }}
              >
                查看目录列表并清空创建表单
              </button>
            </>
          )}
          {checked?.absent && (
            <>
              <p className={styles.note}>
                精确查询当前未找到此英文标识，不能保证原请求从未提交。请检查后手动决定下一次提交。
              </p>
              <button
                className={styles.button}
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

function TaxonomyList({
  kind,
  session,
  onProtectionChange,
}: {
  kind: TaxonomyKind;
  session: StudioSessionDto;
  onProtectionChange: (protectedState: boolean) => void;
}) {
  const protectedRows = useRef(new Map<string, Exclude<RowProtection, null>>());
  const creationProtected = useRef(false);
  const [guards, setGuards] = useState({ rows: false, submitting: false });
  const [refreshNotice, setRefreshNotice] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const updateRowProtection = useCallback(
    (id: string, protection: RowProtection) => {
      if (protection) protectedRows.current.set(id, protection);
      else protectedRows.current.delete(id);
      const rows = protectedRows.current.size > 0;
      const submitting = [...protectedRows.current.values()].includes(
        "submitting",
      );
      setGuards((previous) =>
        previous.rows === rows && previous.submitting === submitting
          ? previous
          : { rows, submitting },
      );
      onProtectionChange(rows || creationProtected.current);
    },
    [onProtectionChange],
  );
  const updateCreationProtection = useCallback(
    (protectedState: boolean) => {
      creationProtected.current = protectedState;
      onProtectionChange(protectedRows.current.size > 0 || protectedState);
    },
    [onProtectionChange],
  );
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState({ q: "", status: "active" });
  const params = new URLSearchParams({
    ...filter,
    page: String(page),
    pageSize: "20",
  });
  const read = useWorkspaceRead<Page<TaxonomyDto>>(
    `${taxonomyPath(kind)}?${params}`,
  );
  const label = kind === "category" ? "分类" : "标签";
  function replaceList(change: () => void) {
    if (protectedRows.current.size) {
      setRefreshNotice(
        "当前列表有未保存或待核实内容，已保留列表。请先处理这些内容，或明确放弃后刷新。",
      );
      return;
    }
    setRefreshNotice("");
    setConfirmDiscard(false);
    change();
  }
  function created() {
    if (protectedRows.current.size) {
      setRefreshNotice(
        "新目录已提交。当前列表有未保存或待核实内容，暂不刷新；处理完毕后可刷新查看新目录。",
      );
    } else replaceList(read.refresh);
  }
  function discardAndRefresh() {
    if ([...protectedRows.current.values()].includes("submitting")) return;
    protectedRows.current.clear();
    setGuards({ rows: false, submitting: false });
    onProtectionChange(creationProtected.current);
    setConfirmDiscard(false);
    setRefreshNotice("");
    read.refresh();
  }
  return (
    <>
      <section className={styles.panel}>
        <h2>{label}目录</h2>
        <FilterBar
          busy={read.loading}
          onFilter={(q, status) => {
            replaceList(() => {
              setFilter({ q, status });
              setPage(1);
            });
          }}
        />
        {refreshNotice && (
          <p className={styles.status} role="status">
            {refreshNotice}
          </p>
        )}
        {guards.rows && (
          <section className={styles.compare} aria-label="目录输入保护">
            <p>
              未保存输入和待核实状态已保留。列表筛选、翻页和目录类型切换暂不替换当前行。
            </p>
            <button
              className={`${styles.button} ${styles.secondary}`}
              type="button"
              disabled={guards.submitting}
              onClick={() => setConfirmDiscard(true)}
            >
              放弃当前行草稿并刷新目录
            </button>
            {confirmDiscard && (
              <>
                <p>
                  确认将丢弃当前列表的未保存输入和待核实状态，并重新读取服务器？结果未知的请求不会重发；刷新也不能证明原请求确定成功。
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    type="button"
                    disabled={guards.submitting}
                    onClick={discardAndRefresh}
                  >
                    确认放弃并刷新目录
                  </button>
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    type="button"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    继续保留输入
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {read.loading && (
          <p className={styles.status} role="status">
            正在加载目录…
          </p>
        )}
        {read.error && (
          <div className={`${styles.status} ${styles.error}`} role="alert">
            <p>{read.error}</p>
            <button
              className={styles.button}
              type="button"
              onClick={() => replaceList(read.refresh)}
            >
              重新读取目录
            </button>
          </div>
        )}
        {read.value && (
          <>
            <p className={styles.note}>
              共 {read.value.total} 个{label}
            </p>
            {!read.value.items.length && (
              <p className={styles.status}>
                {filter.q || filter.status !== "active"
                  ? "当前筛选无结果"
                  : `尚无${label}`}
              </p>
            )}
            <ul className={styles.cards}>
              {read.value.items.map((item) => (
                <li key={item.id}>
                  <TaxonomyRow
                    initial={item}
                    kind={kind}
                    session={session}
                    onProtectionChange={updateRowProtection}
                  />
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              hasNext={read.value.hasNext}
              busy={read.loading}
              onPage={(next) => replaceList(() => setPage(next))}
            />
            <button
              className={`${styles.button} ${styles.secondary}`}
              type="button"
              onClick={() => replaceList(read.refresh)}
            >
              刷新目录
            </button>
          </>
        )}
      </section>
      {session.operator.role === "operator" && (
        <TaxonomyCreateForm
          kind={kind}
          session={session}
          onCreated={created}
          onProtectionChange={updateCreationProtection}
        />
      )}
    </>
  );
}

export function TaxonomyWorkspace({ session }: { session: StudioSessionDto }) {
  const [kind, setKind] = useState<TaxonomyKind>("category");
  const [protectedState, setProtectedState] = useState(false);
  return (
    <div className={styles.workspace}>
      <WorkspaceNav />
      <section className={styles.panel}>
        <h1>分类与标签</h1>
        <p className={styles.note}>
          每个测评可选一个分类和最多 8
          个标签。分类或标签归档后可以恢复，原有关联不会被删除。
        </p>
        {session.operator.role === "read-only" && <ReadOnlyNotice />}
        <div
          className={`${styles.actions} ${styles.taxonomyTabs}`}
          aria-label="目录类型"
        >
          <button
            className={styles.button}
            type="button"
            aria-pressed={kind === "category"}
            disabled={protectedState && kind !== "category"}
            onClick={() => setKind("category")}
          >
            管理分类
          </button>
          <button
            className={styles.button}
            type="button"
            aria-pressed={kind === "tag"}
            disabled={protectedState && kind !== "tag"}
            onClick={() => setKind("tag")}
          >
            管理标签
          </button>
        </div>
      </section>
      <TaxonomyList
        key={kind}
        kind={kind}
        session={session}
        onProtectionChange={setProtectedState}
      />
    </div>
  );
}
