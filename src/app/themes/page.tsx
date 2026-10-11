import type { Metadata } from "next";
import { themes } from "@/features/theme/catalog";
import { ThemeStudy } from "@/features/theme/components/theme-study";

export const metadata: Metadata = { title: "主题研究室" };

export default function ThemesPage() {
  return (
    <main id="main" className="page-shell">
      <section className="page-intro">
        <span className="eyebrow">Visual identity lab / D0</span>
        <h1>主题研究室</h1>
        <p>不同的构图、材质与叙事节奏，塑造不同的测评世界。</p>
        <p className="preview-warning">
          当前为视觉方向研究，所有角色插画待制作，尚未通过 D1 视觉验收。
        </p>
      </section>
      <div className="theme-grid">
        {themes.map((theme) => (
          <ThemeStudy key={theme.id} theme={theme} />
        ))}
      </div>
      <aside className="scope-note">
        <p>
          七宗罪趣味人格为娱乐性格测评，不作为心理诊断。三套主题均不包含真实测评数据。
        </p>
      </aside>
    </main>
  );
}
