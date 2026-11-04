"use client";
import { Sparkle } from "lucide-react";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import {
  qianzaiSnapshotDocument,
  type QianzaiReportBlock,
  type QianzaiReportDocument,
  type QianzaiReportPresentation,
} from "@/features/report/qianzai-tongxin/historical-v15/presentation";
import type { ConsumerViewPropsV2 } from "@/features/theme/consumer-v2/interfaces";
import type { QianzaiVisualProps } from "./art";
type QianzaiViewProps = ConsumerViewPropsV2 & QianzaiVisualProps;
import { qianzaiRolePresentation } from "@/features/report/qianzai-tongxin/historical-v15/role-presentation";
import { qianzaiCharacter, qianzaiImage } from "./art";
import { QianzaiSharePanel } from "./share-panel";
import { useQianzaiExport } from "./export-context";
import {
  qianzaiDimensionScale,
  QIANZAI_SCALE_HEADING,
  QIANZAI_SCALE_MIDPOINT_LABEL,
  QIANZAI_SCALE_PREFACE,
  QIANZAI_SCALE_DISPLAY_NOTICE,
  QIANZAI_SCALE_DETAIL_LABEL,
} from "@/features/report/qianzai-tongxin/historical-v15/dimension-scale";
import {
  QIANZAI_EDITORIAL_RECORD_LABEL,
  QIANZAI_EDITORIAL_FALLBACK_LABEL,
  QIANZAI_EDITORIAL_DEDICATION_LABEL,
  QIANZAI_EDITORIAL_SUMMARY_LABEL,
  QIANZAI_EDITORIAL_SUPPLEMENT_LABEL,
  type QianzaiChapterEditorial,
} from "@/features/report/qianzai-tongxin/historical-v15/editorial";
import styles from "./report-parity.module.css";
import { qianzaiInlineEmphasis } from "@/features/report/qianzai-tongxin/historical-v15/inline-emphasis";

const c = (...names: string[]) => names.map((n) => styles[n]).join(" ");
const labels = [
  "卷首 · 相逢",
  "贰 · 五维心象",
  "叁 · 同心之处",
  "肆 · 山河自照",
  "伍 · 人物",
  "陆 · 寄语留存",
];
const indices = [
  "壹 · 相逢",
  "贰 · 心象",
  "叁 · 同心",
  "肆 · 映照",
  "伍 · 人物",
  "陆 · 寄语",
];
const point = (i: number, r: number) =>
  [
    170 + Math.cos(-Math.PI / 2 + (i * Math.PI * 2) / 5) * r,
    167 + Math.sin(-Math.PI / 2 + (i * Math.PI * 2) / 5) * r,
  ] as const;

export function QianzaiDimensions({
  body,
  document: documentView,
}: {
  body?: ComposedReportBodyV1;
  document?: QianzaiReportDocument;
}) {
  const id = useId();
  const explanations = useRef(new Map<string, HTMLDetailsElement>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const dimensions = documentView?.dimensions ?? body?.dimensions ?? [];
  const insight = documentView?.dimensionInsight;
  const sourceBody =
    documentView?.mode === "snapshot" ? documentView.body : body;
  const dimensionCopy = documentView?.consumerEdition
    ? documentView.sections.find((section) => section.id === "dimensions")
        ?.blocks
    : undefined;
  const scales = dimensions.flatMap((d) => {
    const scale = qianzaiDimensionScale(
      d,
      sourceBody?.provenance.canonicalContentSha256,
    );
    return scale ? [scale] : [];
  });
  const openExplanation = (dimensionId: string) => {
    const detail = explanations.current.get(dimensionId);
    if (detail) detail.open = true;
  };
  return (
    <>
      <div className={c("rp-radar-card")}>
        <div className={c("rp-radar-super")}>
          <span>同心画像</span>
          <span>{documentView?.dimensionBadge ?? "本轮分值"}</span>
        </div>
        <svg
          className={c("rp-radar-svg")}
          viewBox="0 0 340 348"
          role="group"
          aria-label={dimensions.map((d) => `${d.label}${d.score}`).join("，")}
        >
          <defs>
            <linearGradient
              id={`${id}-fill`}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0" stopColor="#657e83" stopOpacity=".55" />
              <stop offset="1" stopColor="#e6b36a" stopOpacity=".34" />
            </linearGradient>
          </defs>
          <circle cx="170" cy="167" r="104" fill="rgba(250,239,214,.56)" />
          {[0.2, 0.4, 0.6, 0.8, 1].map((s) => (
            <polygon
              key={s}
              points={Array.from({ length: 5 }, (_, i) =>
                point(i, s * 103).join(","),
              ).join(" ")}
              className={c("rp-radar-ring")}
            />
          ))}
          {dimensions.map((d, i) => (
            <line
              key={d.dimensionRef.id}
              x1="170"
              y1="167"
              x2={point(i, 103)[0]}
              y2={point(i, 103)[1]}
              className={c("rp-radar-axis")}
            />
          ))}
          <polygon
            points={dimensions
              .map((d, i) => point(i, (d.score / 100) * 103).join(","))
              .join(" ")}
            fill={`url(#${id}-fill)`}
            stroke="#314d62"
            strokeWidth="2.15"
            strokeLinejoin="round"
          />
          {dimensions.map((d, i) => {
            const [x, y] = [
              [170, 26],
              [290, 112],
              [281, 298],
              [59, 298],
              [50, 112],
            ][i]!;
            const [px, py] = point(i, (d.score / 100) * 103);
            return (
              <g key={d.dimensionRef.id}>
                <circle
                  cx={px}
                  cy={py}
                  r="4.2"
                  className={c("rp-radar-dot")}
                  data-qianzai-radar-point={d.dimensionRef.id}
                />
                <g
                  className={c("radarNode")}
                  role="button"
                  tabIndex={
                    scales.some((s) => s.dimensionId === d.dimensionRef.id)
                      ? 0
                      : -1
                  }
                  aria-label={`${d.label} ${d.score}分，查看解释范围`}
                  aria-disabled={
                    !scales.some((s) => s.dimensionId === d.dimensionRef.id)
                  }
                  aria-expanded={expanded.has(d.dimensionRef.id)}
                  aria-controls={
                    scales.some((s) => s.dimensionId === d.dimensionRef.id)
                      ? `${id}-scale-${d.dimensionRef.id}`
                      : undefined
                  }
                  onClick={() => openExplanation(d.dimensionRef.id)}
                  onKeyDown={(e) => {
                    if (["Enter", " "].includes(e.key)) {
                      e.preventDefault();
                      openExplanation(d.dimensionRef.id);
                    }
                  }}
                >
                  <rect
                    x={x! - 38}
                    y={y! - 22}
                    width="76"
                    height="58"
                    className={c("radarHit")}
                  />
                  <text
                    x={x}
                    y={y}
                    textAnchor="middle"
                    className={c("rp-radar-label")}
                  >
                    {d.label}
                  </text>
                  <text
                    x={x}
                    y={y! + (i === 2 || i === 3 ? 24 : 23)}
                    textAnchor="middle"
                    className={c("rp-radar-value")}
                  >
                    {d.score}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
        <div className={c("rp-chart-rule")} />
        {scales.length > 0 && (
          <div
            className={c("dimensionScales")}
            aria-label={QIANZAI_SCALE_HEADING}
          >
            <div className={c("scalesHeading")}>
              <strong>{QIANZAI_SCALE_HEADING}</strong>
              <small>{QIANZAI_SCALE_MIDPOINT_LABEL}</small>
            </div>
            <p className={c("scalesPreface")}>{QIANZAI_SCALE_PREFACE}</p>
            <div className={c("scaleRows")}>
              {scales.map((scale) => (
                <details
                  key={scale.dimensionId}
                  id={`${id}-scale-${scale.dimensionId}`}
                  className={c("scaleEntry")}
                  data-qianzai-dimension-scale={scale.dimensionId}
                  ref={(node) => {
                    if (node) explanations.current.set(scale.dimensionId, node);
                    else explanations.current.delete(scale.dimensionId);
                  }}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setExpanded((previous) => {
                      if (previous.has(scale.dimensionId) === open)
                        return previous;
                      const next = new Set(previous);
                      if (open) next.add(scale.dimensionId);
                      else next.delete(scale.dimensionId);
                      return next;
                    });
                  }}
                >
                  <summary
                    aria-label={`${scale.label} ${scale.score} / 100，${scale.positionLabel}，查看解释范围`}
                  >
                    <div className={c("scaleTopline")}>
                      <strong>{scale.label}</strong>
                      <span className={c("scaleState")}>
                        <b>{scale.score}</b>
                        <span>{scale.positionLabel}</span>
                        <i aria-hidden="true" />
                      </span>
                    </div>
                    <div className={c("scaleEndpoints")} aria-hidden="true">
                      <span>{scale.left}</span>
                      <span>{scale.right}</span>
                    </div>
                    <div
                      className={c("scaleTrack")}
                      role="meter"
                      aria-label={`${scale.label}，左端${scale.left}，右端${scale.right}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={scale.score}
                      aria-valuetext={`${scale.score} / 100，${scale.positionLabel}`}
                    >
                      <span
                        className={c("scaleMidpoint")}
                        aria-hidden="true"
                        style={{ left: `${scale.geometry.midpointPercent}%` }}
                      />
                      <span
                        className={c("scaleBand")}
                        aria-hidden="true"
                        style={{
                          left: `${scale.geometry.bandStartPercent}%`,
                          width: `${scale.geometry.bandWidthPercent}%`,
                        }}
                      />
                      <span
                        className={c("scalePearl")}
                        aria-hidden="true"
                        style={{ left: `${scale.geometry.positionPercent}%` }}
                      />
                    </div>
                    <p className={c("scaleCaption")}>{scale.caption}</p>
                  </summary>
                  <div className={c("scaleExplanation")}>
                    <strong>{QIANZAI_SCALE_DETAIL_LABEL}</strong>
                    <p>
                      {dimensionCopy?.find((block) =>
                        block.title?.startsWith(`${scale.label} · `),
                      )?.text ?? scale.explanation}
                    </p>
                  </div>
                </details>
              ))}
            </div>
            <p className={c("scalesNotice")}>{QIANZAI_SCALE_DISPLAY_NOTICE}</p>
          </div>
        )}
        {scales.length === 0 &&
          insight &&
          documentView?.mode === "reference-only" && (
            <div className={c("rp-radar-insight")}>
              <div>
                <strong>{insight.title}</strong>
                <p>{insight.text}</p>
              </div>
            </div>
          )}
      </div>
      {documentView?.dimensionWarning && (
        <p className={c("rp-assessment-warning")}>
          {documentView.dimensionWarning}
        </p>
      )}
    </>
  );
}
function Evidence({
  block,
  editorial = false,
}: {
  block: QianzaiReportBlock;
  editorial?: boolean;
}) {
  const p = block.snapshot;
  if (!p) return null;
  return (
    <>
      {p.status !== "accepted" && (
        <p className={c("qualifier")}>
          {p.status === "facts-only"
            ? editorial
              ? "仅限本轮选择"
              : "本轮事实"
            : editorial
              ? "本轮暂不展开"
              : "证据不足时的说明"}{" "}
          · {p.kind === "literary" ? "文学类比" : "本轮情境"}
        </p>
      )}
      {(
        [
          ["本段依据的实际选择", p.evidence],
          ["同时阅读的反向证据", p.counterevidence],
        ] as const
      ).map(
        ([title, entries]) =>
          entries.length > 0 && (
            <details className={c("evidence")} data-report-evidence key={title}>
              <summary>
                {title} · {entries.length}
              </summary>
              <ul>
                {entries.map((e, i) => (
                  <li key={`${e.questionRef.id}:${i}`}>
                    <p>{e.prompt}</p>
                    <blockquote>{e.optionText}</blockquote>
                    <p>{e.scope}</p>
                  </li>
                ))}
              </ul>
            </details>
          ),
      )}
    </>
  );
}
function inlineReportText(text: string) {
  return qianzaiInlineEmphasis(text).map((part, index) =>
    part.strong ? <strong key={index}>{part.text}</strong> : part.text,
  );
}
function Block({
  block,
  editorial = false,
}: {
  block: QianzaiReportBlock;
  editorial?: boolean;
}) {
  return (
    <div
      className={c("runtimeParagraph")}
      data-kind={block.snapshot?.kind}
      data-status={block.snapshot?.status}
    >
      {block.editorial && (
        <p className={c("editorialLabel")}>{block.editorial.label}</p>
      )}
      {block.title && <h3>{block.title}</h3>}
      {block.editorial?.choiceSummary && (
        <p className={c("editorialSummary")}>
          <strong>{QIANZAI_EDITORIAL_SUMMARY_LABEL}：</strong>
          {block.editorial.choiceSummary}
        </p>
      )}
      <p>{inlineReportText(block.text)}</p>
      {block.citation && <span>{block.citation}</span>}
      <Evidence block={block} editorial={editorial} />
    </div>
  );
}
function EditorialBlocks({
  blocks,
  editorial,
}: {
  blocks: readonly QianzaiReportBlock[];
  editorial: QianzaiChapterEditorial;
}) {
  const ordinary = (block: QianzaiReportBlock, key: string | number) => (
    <div key={key} className={c("editorialRecord")}>
      {!block.editorial && block.snapshot?.status !== "accepted" && (
        <strong>
          {block.snapshot?.status === "fallback"
            ? QIANZAI_EDITORIAL_FALLBACK_LABEL
            : QIANZAI_EDITORIAL_RECORD_LABEL}
        </strong>
      )}
      <Block block={block} editorial />
    </div>
  );
  if (editorial.kind === "resonance")
    return (
      <div className={c("editorialSection")}>
        {blocks.map((block, i) =>
          block.editorial?.kind === "resonance" ? (
            <article
              key={i}
              className={c("rp-resonance-card", "editorialResonance")}
            >
              <div className={c("rp-res-number")} aria-hidden="true">
                {["壹", "贰", "叁"][
                  blocks
                    .slice(0, i)
                    .filter((b) => b.editorial?.kind === "resonance").length
                ] ?? i + 1}
              </div>
              <div className={c("rp-res-body")}>
                <Block block={block} editorial />
              </div>
            </article>
          ) : (
            ordinary(block, i)
          ),
        )}
      </div>
    );
  const feature = blocks.find(
    (b) =>
      b.editorial?.kind === "reflection" &&
      b.snapshot?.claimRef?.id === editorial.featureClaimId,
  );
  return (
    <div className={c("editorialSection")}>
      {feature && (
        <div className={c("rp-reflection-feature", "editorialFeature")}>
          {editorial.dedication && (
            <div className={c("editorialDedication")}>
              <span>{QIANZAI_EDITORIAL_DEDICATION_LABEL}</span>
              <blockquote>{editorial.dedication}</blockquote>
            </div>
          )}
          <Block block={feature} editorial />
        </div>
      )}
      {editorial.prompts && (
        <div className={c("rp-dual-note", "editorialPrompts")}>
          {editorial.prompts.map((p) => (
            <div key={p.title}>
              <strong>{p.title}</strong>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      )}
      {blocks
        .filter((b) => b !== feature)
        .map((block, i) =>
          block.editorial?.kind === "reflection" ? (
            <details className={c("editorialSupplement")} key={i}>
              <summary>
                {QIANZAI_EDITORIAL_SUPPLEMENT_LABEL} · {block.editorial.title}
              </summary>
              <Block block={block} editorial />
            </details>
          ) : (
            ordinary(block, i)
          ),
        )}
    </div>
  );
}
function Blocks({ blocks }: { blocks: readonly QianzaiReportBlock[] }) {
  const prompts = blocks.filter((b) => b.layout === "prompt");
  const timeline = blocks.filter((b) => b.layout === "timeline");
  const reflection = blocks.find((b) => b.layout === "reflection-quote");
  return (
    <>
      {blocks
        .filter((b) => b.layout !== "prompt")
        .map((b, i) => {
          if (b.layout === "verse")
            return (
              <div key={i} className={c("rp-verse")}>
                <span className={c("rp-quote-icon")}>“</span>
                <p>{inlineReportText(b.text)}</p>
                {b.citation && <small>{b.citation}</small>}
                <Evidence block={b} />
              </div>
            );
          if (b.layout === "lead")
            return (
              <div key={i}>
                <p className={c("rp-lead")}>{inlineReportText(b.text)}</p>
                <Evidence block={b} />
              </div>
            );
          if (b.layout === "card")
            return (
              <article key={i} className={c("rp-resonance-card")}>
                <div className={c("rp-res-number")}>
                  {["壹", "贰", "叁", "肆", "伍", "陆"][i] ?? i + 1}
                </div>
                <div className={c("rp-res-body")}>
                  <Block block={b} />
                </div>
              </article>
            );
          if (b.layout === "reflection-quote")
            return (
              <div key={i} className={c("rp-reflection-feature")}>
                <div className={c("rp-reflect-heading")}>
                  <span>月下自照</span>
                  <span>✧</span>
                </div>
                <blockquote>{inlineReportText(b.text)}</blockquote>
                <Evidence block={b} />
                {blocks
                  .filter(
                    (p) => b === reflection && p.layout === "reflection-body",
                  )
                  .map((p, j) => (
                    <div key={j}>
                      <p>{inlineReportText(p.text)}</p>
                      <Evidence block={p} />
                    </div>
                  ))}
              </div>
            );
          if (b.layout === "reflection-body" && reflection) return null;
          if (b.layout === "timeline") {
            if (b !== timeline[0]) return null;
            return (
              <div key={i} className={c("rp-timeline")}>
                {timeline.map((row, j) => (
                  <div key={j} className={c("rp-time-row")}>
                    <span>{row.title}</span>
                    <p>{inlineReportText(row.text)}</p>
                    <Evidence block={row} />
                  </div>
                ))}
              </div>
            );
          }
          if (b.layout === "source")
            return (
              <div key={i}>
                <p className={c("rp-source-note")}>
                  {b.text.split("\n").map((line, j) => (
                    <span key={j}>
                      {j > 0 && <br />}
                      {inlineReportText(line)}
                    </span>
                  ))}
                </p>
                <Evidence block={b} />
              </div>
            );
          if (b.layout === "final-verse")
            return (
              <div key={i} className={c("rp-final-verse")}>
                {b.text.split("\n").map((l, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {inlineReportText(l)}
                  </span>
                ))}
                <Evidence block={b} />
              </div>
            );
          return <Block key={i} block={b} />;
        })}
      {prompts.length > 0 && (
        <div className={c("rp-dual-note")}>
          {prompts.map((b, i) => (
            <div key={i}>
              <span>{b.title}</span>
              <p>{inlineReportText(b.text)}</p>
              <Evidence block={b} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Consumer edition reads only the final display fields. Audit snapshots,
 * statuses, qualifiers and raw evidence never enter this renderer. */
function ConsumerBlocks({ blocks }: { blocks: readonly QianzaiReportBlock[] }) {
  const timeline = blocks.filter((b) => b.layout === "timeline");
  return (
    <>
      {blocks.map((b, i) => {
        if (b.layout === "lead" && b.title)
          return (
            <div key={i} className={c("rp-history-banner")}>
              <strong>{b.title}</strong>
              <span>
                {b.text.split("\n").map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {line}
                  </span>
                ))}
              </span>
            </div>
          );
        if (b.layout === "timeline")
          return b === timeline[0] ? (
            <div key={i} className={c("rp-timeline")}>
              {timeline.map((row, j) => (
                <div key={j} className={c("rp-time-row")}>
                  <span>{row.title}</span>
                  <p>{inlineReportText(row.text)}</p>
                </div>
              ))}
            </div>
          ) : null;
        if (b.layout === "card")
          return (
            <article key={i} className={c("rp-resonance-card")}>
              <div className={c("rp-res-number")} aria-hidden="true">
                {["壹", "贰", "叁"][i] ?? i + 1}
              </div>
              <div className={c("rp-res-body")}>
                {b.title && <h3>{b.title}</h3>}
                {b.text.split(/\n\s*\n/u).map((paragraph, index) => (
                  <p key={index}>{inlineReportText(paragraph)}</p>
                ))}
              </div>
            </article>
          );
        if (b.layout === "prompt")
          return (
            <div key={i} className={c("rp-dual-note")}>
              <div>
                {b.title && <strong>{b.title}</strong>}
                <p>{inlineReportText(b.text)}</p>
              </div>
            </div>
          );
        if (b.layout === "source")
          return (
            <p key={i} className={c("rp-source-note")}>
              {b.text}
            </p>
          );
        if (b.layout === "final-verse")
          return (
            <div key={i} className={c("rp-final-verse")}>
              {inlineReportText(b.text)}
            </div>
          );
        return (
          <div key={i} className={c("runtimeParagraph")}>
            {b.title && <h3>{b.title}</h3>}
            <p className={b.layout === "lead" ? c("rp-lead") : undefined}>
              {inlineReportText(b.text)}
            </p>
            {b.citation && <small>{b.citation}</small>}
          </div>
        );
      })}
    </>
  );
}

export type QianzaiEmbeddedReport = Readonly<{
  scrollContainer: RefObject<HTMLDivElement | null>;
  onReturn(): void;
}>;

/** Presentational reader shared by the snapshot adapter and explicit reference-only
 * browser fixture. This component never writes or grants report authority. */
export function QianzaiReportReader({
  document: doc,
  heroUrl,
  paperUrl,
  onResult,
  onLogout,
  entry = 0,
  active = true,
  actions,
  embedded,
}: {
  document: QianzaiReportDocument;
  heroUrl?: string;
  paperUrl?: string;
  onResult: () => void;
  onLogout?: () => void;
  entry?: number;
  active?: boolean;
  actions?: ReactNode;
  embedded?: QianzaiEmbeddedReport;
}) {
  const container = useRef<HTMLDivElement>(null),
    reader = useRef<HTMLElement>(null),
    toc = useRef<HTMLDivElement>(null);
  const scrollContainer = embedded?.scrollContainer ?? container;
  const returnToResult = embedded?.onReturn ?? onResult;
  const [tocOpen, setTocOpen] = useState(false),
    [reading, setReading] = useState({
      percent: 0,
      chapter: labels[0]!,
      paper: false,
      entered: false,
    });
  const id = useId();
  const measure = useCallback((node: HTMLDivElement) => {
    const max = Math.max(0, node.scrollHeight - node.clientHeight),
      amount = Math.min(max, Math.max(0, node.scrollTop)),
      nav = reader.current?.querySelector<HTMLElement>(
        "[data-qianzai-report-toolbar]",
      ),
      opening = reader.current?.querySelector<HTMLElement>(
        '[data-report-chapter-id="encounter"]',
      ),
      toolbarHeight = nav?.offsetHeight ?? 0,
      start = opening
        ? Math.max(
            0,
            amount +
              opening.getBoundingClientRect().top -
              node.getBoundingClientRect().top -
              toolbarHeight,
          )
        : 0,
      readingLength = Math.max(0, max - start),
      readingAmount = Math.max(0, amount - start);
    const percent = readingLength
      ? Math.round((100 * readingAmount) / readingLength)
      : amount >= start
        ? 100
        : 0;
    reader.current?.style.setProperty(
      "--qianzai-report-toolbar-height",
      `${toolbarHeight}px`,
    );
    let chapter = labels[0]!;
    const threshold =
      (nav?.getBoundingClientRect().bottom ??
        node.getBoundingClientRect().top) + 18;
    reader.current
      ?.querySelectorAll<HTMLElement>("[data-report-chapter]")
      .forEach((s) => {
        if (s.getBoundingClientRect().top <= threshold)
          chapter = s.dataset.reportChapter!;
      });
    if (percent >= 100) chapter = labels[5]!;
    setReading((old) =>
      old.percent === percent &&
      old.chapter === chapter &&
      old.paper === amount >= start - 1 &&
      old.entered === (old.entered || amount >= start - 1)
        ? old
        : {
            percent,
            chapter,
            paper: amount >= start - 1,
            entered: old.entered || amount >= start - 1,
          },
    );
  }, []);
  useEffect(() => {
    const n = scrollContainer.current;
    if (!n) return;
    const update = () => measure(n);
    const observer = new ResizeObserver(update);
    observer.observe(n);
    if (reader.current) observer.observe(reader.current);
    n.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      n.removeEventListener("scroll", update);
    };
  }, [measure, scrollContainer]);
  useEffect(() => {
    if (active && !embedded && container.current) {
      container.current.scrollTop = 0;
      measure(container.current);
    }
  }, [entry, active, measure, embedded]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (e.target instanceof Node && !toc.current?.contains(e.target))
        setTocOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const jump = (sectionId: string) => {
    const n = scrollContainer.current,
      target = reader.current?.querySelector<HTMLElement>(
        `[data-report-chapter-id="${sectionId}"]`,
      );
    if (n && target)
      n.scrollTo({
        top: Math.max(
          0,
          n.scrollTop +
            target.getBoundingClientRect().top -
            n.getBoundingClientRect().top -
            ((reader.current?.querySelector<HTMLElement>(
              "[data-qianzai-report-toolbar]",
            )?.offsetHeight ?? 82) +
              16),
        ),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    setTocOpen(false);
  };
  const opening = doc.sections.find((s) => s.id === "encounter")!;
  return (
    <section
      ref={reader}
      className={c("reader", ...(embedded ? ["embedded"] : []))}
      data-qianzai-screen="report"
      data-qianzai-report-mode={doc.mode}
      data-qianzai-consumer-edition={doc.consumerEdition || undefined}
    >
      <div ref={container} className={c("reportScroll")}>
        <div>
          <header
            data-qianzai-report-toolbar
            className={c("rp-nav", ...(reading.paper ? ["paper-mode"] : []))}
          >
            {doc.mode === "reference-only" && (
              <div className={c("rp-status")}>
                <span>9:41</span>
                <span className={c("rp-signals")} aria-hidden="true">
                  <span className={c("rp-bars")}>▂▄▆</span>
                  <span className={c("rp-wifi")}>◕</span>
                  <span className={c("rp-battery")} />
                </span>
              </div>
            )}
            <div className={c("rp-nav-line")}>
              <button
                className={c("rp-iconbtn")}
                aria-label="返回人物揭晓"
                onClick={returnToResult}
              >
                ‹
              </button>
              <div className={c("rp-nav-title")}>
                <span>千载同心</span>
                <strong>人物深度报告</strong>
              </div>
              <div ref={toc}>
                <button
                  className={c("rp-menu-toggle")}
                  aria-expanded={tocOpen}
                  onClick={() => setTocOpen(!tocOpen)}
                >
                  卷目 <span>⌄</span>
                </button>
                <nav
                  className={c("rp-toc")}
                  hidden={!tocOpen}
                  aria-label="六卷目录"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setTocOpen(false);
                      toc.current?.querySelector("button")?.focus();
                    }
                  }}
                >
                  <div className={c("rp-toc-heading")}>
                    此卷共六章 <span>轻触可跳转</span>
                  </div>
                  {doc.sections.map((s, i) => (
                    <button key={s.id} onClick={() => jump(s.id)}>
                      {s.tocTitle ??
                        [
                          "壹 · 命定相逢",
                          "贰 · 五维心象",
                          "叁 · 同心之处",
                          "肆 · 山河自照",
                          "伍 · 人物",
                          "陆 · 寄语留存",
                        ][i]}
                      <span>
                        {["卷首", "图谱", "共鸣", "映照", "人物", "分享"][i]}
                      </span>
                    </button>
                  ))}
                  {onLogout && <button onClick={onLogout}>结束本次访问</button>}
                </nav>
              </div>
            </div>
            <div className={c("rp-read-state")}>
              <span>{reading.chapter}</span>
              <span className={c("rp-percent")}>{reading.percent}%</span>
            </div>
            <div
              className={c("rp-progress-track")}
              role="progressbar"
              aria-label="长卷阅读进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={reading.percent}
            >
              <div
                className={c("rp-progress-fill")}
                style={{ width: `${reading.percent}%` }}
              />
              <span className={c("rp-progress-glint")} />
            </div>
          </header>
          {!embedded && (
            <div
              className={c("rp-hero")}
              style={
                heroUrl
                  ? {
                      backgroundImage: `linear-gradient(to bottom,rgba(5,15,28,.23),transparent 43%,rgba(9,20,33,.28) 80%,rgba(9,20,32,.70)),url("${heroUrl}")`,
                    }
                  : undefined
              }
            >
              {!heroUrl && (
                <span className={c("artMissing")}>人物画作待接入</span>
              )}
              <div className={c("rp-hero-kicker")}>一卷山河 · 因你而展</div>
              <div className={c("rp-hero-caption")}>{doc.heroCaption}</div>
            </div>
          )}
          <main
            data-qianzai-report-start
            className={c("rp-paper")}
            style={
              paperUrl
                ? {
                    backgroundImage: `linear-gradient(180deg,rgba(255,252,243,.97),rgba(251,240,218,.96) 23%,rgba(248,235,208,.98) 100%),url("${paperUrl}")`,
                  }
                : undefined
            }
          >
            <section
              id={`${id}-encounter`}
              data-report-chapter-id="encounter"
              data-report-chapter={labels[0]}
              className={c("rp-section", "rp-opening")}
            >
              <div className={c("rp-ornament")}>
                <span>✧</span> 第一卷 · {doc.openingTitle} <span>✧</span>
              </div>
              <div className={c("rp-identity")}>
                <h1 data-report-opening-title tabIndex={-1}>
                  <span className={c("roleName")}>{doc.name}</span>
                  {doc.identity?.honorific && (
                    <>
                      <span className={c("roleHonorific")}>
                        · {doc.identity.honorific}
                      </span>
                    </>
                  )}
                </h1>
                {doc.identity?.seal && (
                  <span className={c("rp-seal")}>
                    {doc.identity.seal.map((l, i) => (
                      <span key={l}>
                        {i > 0 && <br />}
                        {l}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <p className={c("rp-identity-sub")}>{doc.subtitle}</p>
              {doc.identity?.tags && doc.identity.tags.length > 0 && (
                <div
                  className={c("rp-tags")}
                  aria-label={
                    doc.consumerEdition
                      ? "情境中的个人特点"
                      : "人物作品与角色关键词"
                  }
                >
                  {doc.identity.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              )}
              {doc.identity?.verse && (
                <div className={c("rp-verse")}>
                  <span className={c("rp-quote-icon")}>“</span>
                  <p>{doc.identity.verse.text}</p>
                  <small>{doc.identity.verse.source}</small>
                </div>
              )}
              {doc.consumerEdition ? (
                <ConsumerBlocks blocks={opening.blocks} />
              ) : (
                <Blocks blocks={opening.blocks} />
              )}
              {doc.openingNote && (
                <div className={c("rp-demo-note")}>{doc.openingNote}</div>
              )}
            </section>
            {doc.sections.slice(1).map((s, i) => {
              const closing = s.id === "closure";
              return (
                <section
                  key={s.id}
                  id={`${id}-${s.id}`}
                  data-volume={s.id}
                  data-report-chapter-id={s.id}
                  data-report-chapter={s.chapterLabel ?? labels[i + 1]}
                  className={c(
                    "rp-section",
                    ...(closing ? ["rp-closing-section"] : []),
                  )}
                >
                  {closing ? (
                    <div className={c("rp-section-index")}>
                      {indices[i + 1]}
                    </div>
                  ) : (
                    <div className={c("rp-section-head")}>
                      <div className={c("rp-section-index")}>
                        {indices[i + 1]}
                      </div>
                      <h2 tabIndex={-1}>
                        {s.id === "literature" && doc.history
                          ? doc.history.title
                          : s.title}
                      </h2>
                      {s.id === "literature" && doc.history?.intro ? (
                        <p>{doc.history.intro}</p>
                      ) : (
                        s.intro && <p>{s.intro}</p>
                      )}
                    </div>
                  )}
                  {s.id === "dimensions" && (
                    <QianzaiDimensions document={doc} />
                  )}
                  {s.id === "literature" &&
                    !doc.consumerEdition &&
                    doc.identity?.lifespan && (
                      <div className={c("rp-history-banner")}>
                        <strong>{doc.name}</strong>
                        <span>
                          {doc.identity.lifespan}
                          {doc.identity.courtesyName && (
                            <>
                              <br />
                              {doc.identity.courtesyName}
                            </>
                          )}
                        </span>
                      </div>
                    )}
                  {s.id === "literature" && doc.history && (
                    <>
                      <div className={c("rp-timeline")}>
                        {doc.history.timeline.map((row, j) => (
                          <div key={j} className={c("rp-time-row")}>
                            <span>{row.title}</span>
                            <p>{row.text}</p>
                          </div>
                        ))}
                      </div>
                      <p className={c("rp-source-note")}>
                        {doc.history.sourceNote}
                      </p>
                    </>
                  )}
                  {closing &&
                    !doc.consumerEdition &&
                    doc.resultPresentation && (
                      <div className={c("rp-final-verse")}>
                        {doc.resultPresentation.closure.lines.map((line, i) => (
                          <span key={line}>
                            {i > 0 && <br />}
                            {line}
                          </span>
                        ))}
                      </div>
                    )}
                  {doc.consumerEdition ? (
                    s.id !== "dimensions" && (
                      <ConsumerBlocks blocks={s.blocks} />
                    )
                  ) : closing && doc.mode === "reference-only" ? (
                    s.blocks.map((b, j) =>
                      b.layout === "body" ? (
                        <p key={j}>
                          {b.text.split("\n").map((line, k) => (
                            <span key={k}>
                              {k > 0 && <br />}
                              {line}
                            </span>
                          ))}
                        </p>
                      ) : (
                        <Blocks key={j} blocks={[b]} />
                      ),
                    )
                  ) : s.editorial ? (
                    <EditorialBlocks
                      blocks={s.blocks}
                      editorial={s.editorial}
                    />
                  ) : (
                    <Blocks blocks={s.blocks} />
                  )}
                  {s.note && <div className={c("rp-hint-line")}>{s.note}</div>}
                  {closing && (
                    <>
                      <div className={c("rp-final-stamp")}>
                        千载
                        <br />
                        同心
                      </div>
                      <div className={c("rp-endline")}>
                        <span>
                          <Sparkle size={16} aria-hidden="true" />
                        </span>{" "}
                        长卷已展至尽处{" "}
                        <span>
                          <Sparkle size={16} aria-hidden="true" />
                        </span>
                      </div>
                      <div className={c("rp-share-actions")}>
                        {actions ?? (
                          <QianzaiSharePanel
                            active={active}
                            prepareEnabled={!embedded || reading.entered}
                          />
                        )}
                        <button
                          className={c("rp-secondary")}
                          onClick={returnToResult}
                        >
                          回看人物揭晓
                        </button>
                      </div>
                      <button
                        className={c("rp-scrolltop-text")}
                        onClick={() => jump("encounter")}
                      >
                        ↑ 回到卷首
                      </button>
                      {doc.body && !doc.consumerEdition && (
                        <details className={c("record")}>
                          <summary>本轮匹配记录与说明</summary>
                          <p>
                            {doc.name} · 契合指数{" "}
                            {doc.body.matching.selected.narrativeIndex} / 100
                          </p>
                          {doc.body.matching.status === "single-candidate" ? (
                            <p>本轮偏好下仅有一位候选人物。</p>
                          ) : (
                            doc.body.matching.runnerUp && (
                              <p>
                                {doc.body.matching.status === "near-tie"
                                  ? "前两位接近。"
                                  : "本轮第二候选："}
                                {doc.body.matching.runnerUp.label} · 契合指数{" "}
                                {doc.body.matching.runnerUp.narrativeIndex} /
                                100
                              </p>
                            )
                          )}
                          <p>
                            {doc.body.matching.selected.kind ===
                            "literary-legendary"
                              ? `${doc.name}以文学／传说人物的艺术形象参与本轮匹配。`
                              : "人物为文学类比，不是历史人物心理测量。"}
                          </p>
                          <details>
                            <summary>
                              本轮全部选择 · {doc.body.answers.length} 题
                            </summary>
                            <ol>
                              {doc.body.answers.map((a) => (
                                <li key={a.questionRef.id}>
                                  <p>
                                    第 {a.act} 幕 · {a.prompt}
                                  </p>
                                  <blockquote>{a.optionText}</blockquote>
                                </li>
                              ))}
                            </ol>
                          </details>
                        </details>
                      )}
                      <p className={c("rp-legal")}>
                        {doc.legal.split("\n").map((l, j) => (
                          <span key={j}>
                            {j > 0 && <br />}
                            {l}
                          </span>
                        ))}
                      </p>
                    </>
                  )}
                </section>
              );
            })}
          </main>
        </div>
      </div>
    </section>
  );
}
export function QianzaiReport({
  model,
  onRead,
  onEvent,
  images,
  entry = 0,
  active = true,
  presentation,
  embedded,
}: QianzaiViewProps & {
  entry?: number;
  active?: boolean;
  presentation?: QianzaiReportPresentation;
  embedded?: QianzaiEmbeddedReport;
}) {
  const body = model.report?.view.display.body,
    character = qianzaiCharacter(model);
  const resultPresentation = useQianzaiExport().getResultPresentation();
  const hero = qianzaiImage(model, character?.report, images),
    paper = qianzaiImage(
      model,
      model.report?.view.display.slots.neutral.reportPaper,
      images,
    );
  if (!body) return null;
  return (
    <QianzaiReportReader
      document={qianzaiSnapshotDocument(
        body,
        presentation ?? qianzaiRolePresentation(body.matching.selected.ref),
        resultPresentation ?? undefined,
      )}
      {...(hero ? { heroUrl: hero.objectUrl } : {})}
      {...(paper ? { paperUrl: paper.objectUrl } : {})}
      onResult={() => onRead("result")}
      onLogout={() => onEvent({ type: "logout" })}
      entry={entry}
      active={active}
      {...(embedded ? { embedded } : {})}
    />
  );
}
