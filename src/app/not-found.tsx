import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="page-shell page-intro">
      <span className="eyebrow">404 / 未找到</span>
      <h1>这个世界还未开启</h1>
      <p>请返回主题研究室，查看当前的三个设计方向。</p>
      <Button asChild>
        <Link href="/themes">返回主题研究室</Link>
      </Button>
    </main>
  );
}
