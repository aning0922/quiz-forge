import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/site-header";
import { site } from "@/config/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "QuizForge · 主题研究室", template: "%s · QuizForge" },
  description: site.description,
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a href="#main" className="skip-link">
          跳转到主要内容
        </a>
        <SiteHeader />
        {children}
        <footer className="site-footer">
          <span>QuizForge / 2026</span>
          <span>D0 工程预览 · 临时演示数据 · 非已发布商品</span>
        </footer>
      </body>
    </html>
  );
}
