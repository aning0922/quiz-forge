import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ThemeBrief } from "../catalog";

export function ThemeStudy({ theme }: { theme: ThemeBrief }) {
  return (
    <Link
      href={`/themes/${theme.id}`}
      className={`theme-study study-${theme.id}`}
      aria-label={`查看${theme.name}设计方向`}
    >
      <div className="study-visual" aria-hidden="true">
        <span className="study-corner">{theme.number} / COMPOSITION STUDY</span>
        <span className="study-ornament">
          <i />
          <i />
          <i />
        </span>
        <span className="study-title">{theme.style}</span>
        <span className="study-caption">构图研究 · 角色立绘待制作</span>
      </div>
      <div className="study-copy">
        <div>
          <span className="eyebrow">{theme.englishName}</span>
          <h3>{theme.name}</h3>
        </div>
        <ArrowUpRight size={22} aria-hidden="true" />
      </div>
      <p className="study-description">{theme.composition}</p>
    </Link>
  );
}
