import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTheme, themes, pageStates } from "@/features/theme/catalog";
import { ThemeStudy } from "@/features/theme/components/theme-study";

const stateLabels = {
  cover: "封面首页",
  question: "答题中",
  resume: "暂存恢复",
  result: "结果展示",
  poster: "分享海报",
} as const;
export function generateStaticParams() {
  return themes.map((theme) => ({ themeId: theme.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ themeId: string }>;
}): Promise<Metadata> {
  const theme = getTheme((await params).themeId);
  return { title: theme?.name ?? "主题未找到" };
}

export default async function ThemePage({
  params,
}: {
  params: Promise<{ themeId: string }>;
}) {
  const theme = getTheme((await params).themeId);
  if (!theme) notFound();
  return (
    <main id="main" className="page-shell">
      <Link className="back-link" href="/themes">
        <ArrowLeft size={16} aria-hidden="true" />
        所有主题
      </Link>
      <section className="page-intro">
        <span className="eyebrow">
          {theme.englishName} / Direction {theme.number}
        </span>
        <h1>{theme.name}</h1>
        <p>{theme.premise}</p>
        <p className="preview-warning">
          D0 设计简报 · 角色立绘待制作 · 五种页面状态尚未实现
        </p>
        {theme.id === "sins" && <p>仅供娱乐与自我探索，不作为心理诊断。</p>}
      </section>
      <div className="brief-grid">
        <ThemeStudy theme={theme} />
        <section className="brief-spec" aria-label="主题设计规格">
          <h2>视觉语言</h2>
          <p>{theme.composition}</p>
          <ul className="palette">
            {theme.palette.map((color) => (
              <li key={color.name}>
                <span
                  style={{ backgroundColor: color.color }}
                  aria-hidden="true"
                />
                {color.name}
                <code>{color.color}</code>
              </li>
            ))}
          </ul>
          <h2>字体与结果页方向</h2>
          <p>{theme.fonts}</p>
          <p>{theme.resultDirection}</p>
          <p className="asset-status">
            素材包 {theme.assetPackId} / 全部待补齐
          </p>
        </section>
      </div>
      <section className="states-section">
        <span className="eyebrow">D1 acceptance targets</span>
        <h2>五种状态，逐一验收</h2>
        <ol>
          {pageStates.map((state, index) => (
            <li key={state}>
              <span className="state-number">0{index + 1}</span>
              <div>
                <h3>{stateLabels[state]}</h3>
                <p>{theme.states[state]}</p>
              </div>
              <span className="state-status">待制作</span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
