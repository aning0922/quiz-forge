import { SiteHeader } from "@/components/site-header";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
      <footer className="site-footer">
        <span>QuizForge / 2026</span>
        <span>D0 工程预览 · 临时演示数据 · 非已发布商品</span>
      </footer>
    </>
  );
}
