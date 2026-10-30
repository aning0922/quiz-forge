import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Entrance } from "@/components/entrance";
import { themes } from "@/features/theme/catalog";
import { ThemeStudy } from "@/features/theme/components/theme-study";

export default function Home() {
  return (
    <main id="main" className="page-shell">
      <Entrance>
        <section className="intro">
          <div className="intro-meta">
            <span className="eyebrow">The quiz creation studio</span>
            <span className="stage-label">
              <span />
              D0 · 工程已启程
            </span>
          </div>
          <h1>
            每一种性格，
            <br />
            都值得一个<span>自己的世界。</span>
          </h1>
          <div className="intro-bottom">
            <p>
              为趣味测评构建独立的内容与视觉语言。
              <br />
              从一次选择，到一份值得收藏的自我探索。
            </p>
            <Button asChild>
              <Link href="/themes">
                走进主题研究室
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </Entrance>
      <section className="theme-section" aria-labelledby="theme-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Three worlds, three identities</span>
            <h2 id="theme-heading">三个世界，同一个起点</h2>
          </div>
          <span className="section-note">视觉方向预研 / D1 待验收</span>
        </div>
        <div className="theme-grid">
          {themes.map((theme) => (
            <ThemeStudy key={theme.id} theme={theme} />
          ))}
        </div>
      </section>
      <aside className="scope-note">
        <span className="eyebrow">In the making</span>
        <p>
          这里展示的是构图方向与工程入口。正式插画、答题流程、结果报告和分享海报将按阶段制作与验收。
        </p>
      </aside>
    </main>
  );
}
