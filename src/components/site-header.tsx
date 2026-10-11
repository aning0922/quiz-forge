import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="QuizForge 首页">
        <span className="brand-mark" aria-hidden="true">
          Q
        </span>
        QuizForge<span className="brand-stage">D0</span>
      </Link>
      <nav aria-label="主导航">
        <Link href="/themes">
          主题研究室 <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </nav>
    </header>
  );
}
