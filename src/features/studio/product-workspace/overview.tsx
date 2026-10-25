"use client";

import Link from "next/link";
import {
  FileText,
  Eye,
  ShieldCheck,
  Ticket,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import {
  productPresentation,
  type PresentationStatus,
} from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { TechnicalDetails } from "../presentation/technical-details";
import { directoryTime } from "../workspace/directory-time";
import { useProductWorkspaceContext } from "./context";
import { productWorkspaceTabs } from "./navigation";
import styles from "./workspace.module.css";

export function ProductOverview() {
  const context = useProductWorkspaceContext();
  if (!context) throw new Error("PRODUCT_WORKSPACE_REQUIRED");
  const { productId, read } = context;
  const value = read.value;
  if (!value)
    return (
      <div className={styles.pageHeading}>
        <h1>测评概览</h1>
        {read.loading ? (
          <p role="status">正在读取概览…</p>
        ) : (
          <p className={styles.error} role="alert">
            概览暂不可用；请重新读取摘要，或通过业务导航核对原记录。
          </p>
        )}
      </div>
    );
  const presentation = productPresentation(value);
  const tabs = productWorkspaceTabs(productId);
  const draft = value.content.draft;
  const previewStatus: PresentationStatus =
    draft.state === "present"
      ? { label: `可查看 r${draft.value.target.revision}`, tone: "info" }
      : {
          label: draft.state === "none" ? "暂无固定修订" : "修订待核实",
          tone: draft.state === "none" ? "neutral" : "warning",
        };
  const steps = [
    { label: "内容准备", icon: FileText, status: presentation.content },
    { label: "体验预览", icon: Eye, status: previewStatus },
    { label: "审核与版本", icon: ShieldCheck, status: presentation.review },
    { label: "内部测试", icon: Ticket, status: presentation.testing },
  ];
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const records: { label: string; detail: string; at: string; href: string }[] =
    [];
  if (draft.state === "present")
    records.push({
      label: `当前草稿 r${draft.value.target.revision}`,
      detail: "不可变内容修订",
      at: draft.value.createdAt,
      href: `${base}/drafts/${draft.value.target.draftId}/revisions/${draft.value.target.revision}`,
    });
  const review =
    value.review.current.state === "present"
      ? value.review.current
      : value.review.latestHistorical;
  if (review.state === "present")
    records.push({
      label: `审核依据 r${review.value.target.revision}`,
      detail: `${value.review.current.state === "present" ? "当前匹配" : "历史依据"} · ${review.value.approval.kind === "synthetic-test" ? "合成测试依据" : "作者内测基线"}`,
      at: review.value.recordedAt,
      href: `${base}/drafts/${review.value.target.draftId}/revisions/${review.value.target.revision}/internal-review`,
    });
  const version =
    value.versions.current.state === "present"
      ? value.versions.current
      : value.versions.historical;
  if (version.state === "present")
    records.push({
      label: `固定内容版 r${version.value.target.revision}`,
      detail:
        value.versions.current.state === "present"
          ? "当前修订匹配版本"
          : "历史版本，保留原目标",
      at: version.value.createdAt,
      href: `${base}/internal-versions/${version.value.id}`,
    });
  const testing =
    value.testing.current.state === "present"
      ? value.testing.current
      : value.testing.historical;
  if (testing.state === "present")
    records.push({
      label: `答题版本 r${testing.value.target.revision}`,
      detail:
        value.testing.current.state === "present"
          ? "关联当前固定内容版"
          : "历史内测，保留原父版本",
      at: testing.value.createdAt,
      href: `${base}/consumer-access`,
    });
  return (
    <div className={styles.overview}>
      <section className={styles.panel} aria-label="制作与下一步">
        <div className={styles.sectionHead}>
          <h1>制作与内测状态</h1>
        </div>
        <div className={styles.steps}>
          {steps.map((step) => (
            <div className={styles.step} key={step.label}>
              <span className={styles.stepIcon}>
                <step.icon size={19} aria-hidden="true" />
              </span>
              <strong>{step.label}</strong>
              <StatusBadge status={step.status} />
            </div>
          ))}
        </div>
        <div className={styles.nextAction}>
          <ArrowRight size={22} aria-hidden="true" />
          <div>
            <strong>建议下一步：{presentation.primary.label}</strong>
            <p>{presentation.primary.reason}</p>
          </div>
          <Link className={styles.primary} href={presentation.primary.href}>
            继续
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <p className={styles.caption}>
          预览入口不代表已人工体验；具体操作仍会重新核验权限与条件。
        </p>
      </section>
      <section className={styles.panel} aria-label="基本信息">
        <div className={styles.sectionHead}>
          <h2>基本信息</h2>
          <Link className={styles.secondary} href={tabs[5].href}>
            编辑
          </Link>
        </div>
        <dl className={styles.directoryFacts}>
          <dt>测评名称</dt>
          <dd>{value.directory.title}</dd>
          <dt>所属分类</dt>
          <dd>
            {value.directory.primaryCategory
              ? `${value.directory.primaryCategory.name}${value.directory.primaryCategory.archivedAt ? "（已归档）" : ""}`
              : "未分类"}
          </dd>
          <dt>标签</dt>
          <dd>
            {value.directory.tags.length
              ? value.directory.tags
                  .map(
                    (tag) => `${tag.name}${tag.archivedAt ? "（已归档）" : ""}`,
                  )
                  .join("、")
              : "暂无标签"}
          </dd>
          <dt>内容状态</dt>
          <dd>
            <StatusBadge status={presentation.content} />
          </dd>
          <dt>内测状态</dt>
          <dd>
            <StatusBadge status={presentation.testing} />
          </dd>
          <dt>目录更新</dt>
          <dd>
            <time dateTime={value.directory.updatedAt}>
              {directoryTime(value.directory.updatedAt)}
            </time>
          </dd>
        </dl>
      </section>
      <section className={styles.panel} aria-label="真实关联对象">
        <div className={styles.sectionHead}>
          <h2>关联对象</h2>
          <span className={styles.caption}>当前与历史分别保留</span>
        </div>
        {records.length ? (
          <ul className={styles.recordList}>
            {records.map((record) => (
              <li key={record.href}>
                <Link href={record.href}>
                  <div>
                    <strong>{record.label}</strong>
                    <p>
                      {record.detail} ·{" "}
                      <time dateTime={record.at}>
                        {directoryTime(record.at)}
                      </time>
                    </p>
                  </div>
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>
            尚无草稿、审核或版本关联记录。可先进入内容与素材处理。
          </p>
        )}
        <TechnicalDetails label="技术身份与摘要依据">
          <dl className={styles.technicalFacts}>
            <dt>测评编号</dt>
            <dd>{productId}</dd>
            <dt>英文标识</dt>
            <dd>{value.directory.slug}</dd>
            <dt>目录信息版本</dt>
            <dd>{value.directory.metadataRevision}</dd>
            {draft.state === "present" && (
              <>
                <dt>当前草稿编号</dt>
                <dd>{draft.value.target.draftId}</dd>
                <dt>来源接收 / 检查</dt>
                <dd>
                  {draft.value.sourceImportId} /{" "}
                  {draft.value.sourceValidationId}
                </dd>
                <dt>内容 SHA-256</dt>
                <dd>{draft.value.target.canonicalContentSha256}</dd>
                <dt>素材集 SHA-256</dt>
                <dd>{draft.value.target.assetSetSha256}</dd>
                <dt>Manifest SHA-256</dt>
                <dd>{draft.value.target.canonicalManifestSha256}</dd>
              </>
            )}
          </dl>
          <p>
            摘要观察时间：
            <time dateTime={value.asOf}>{directoryTime(value.asOf)}</time>
            。服务器摘要不能核实本标签页保留的未确认操作，请到原操作中处理。
          </p>
        </TechnicalDetails>
      </section>
      <section className={styles.panel} aria-label="快捷入口">
        <div className={styles.sectionHead}>
          <h2>快捷入口</h2>
        </div>
        <nav className={styles.quickLinks} aria-label="概览快捷入口">
          {[
            { tab: tabs[1], icon: FileText },
            { tab: tabs[2], icon: Eye },
            { tab: tabs[3], icon: ShieldCheck },
            { tab: tabs[4], icon: Ticket },
          ].map(({ tab, icon: Icon }) => (
            <Link key={tab.id} href={tab.href}>
              <Icon size={18} aria-hidden="true" />
              <span>{tab.label}</span>
              <ChevronRight size={17} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        {presentation.historicalNote && (
          <p className={styles.caption}>
            {presentation.historicalNote}。历史记录不替代当前修订依据。
          </p>
        )}
      </section>
    </div>
  );
}
