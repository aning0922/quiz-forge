import Link from "next/link";
import styles from "@/features/theme/historical/visual-v2-c/candidate.module.css";

export const metadata = { title: "Visual V2-C · 统一候选研究" };
export default function ResearchPage() {
  return (
    <main id="main" className={styles.research} data-v2c="research">
      <p>VISUAL V2-C / 研究演示 · 待作者确认</p>
      <h1>藏馆探寻，风骨映月。</h1>
      <p>
        一条从封面、四厅十二问、确认到人物揭晓、完整人物志与收藏海报的统一候选。固定李白、88
        / 82 / 64 / 46 / 38 与题签均为合成/编辑展示，不从答案计算。
      </p>
      <nav aria-label="候选预览">
        <Link href="/studies/visual-v2-c" prefetch={false}>
          从封面开始完整体验
        </Link>
        {["question", "reveal", "report", "poster"].map((view, index) => (
          <Link
            key={view}
            href={`/studies/visual-v2-c/${view}`}
            prefetch={false}
          >
            {["四厅答题", "合成人物揭晓", "完整人物志", "收藏海报"][index]}
          </Link>
        ))}
      </nav>
      <h2>本轮收敛的三个连接点</h2>
      <p>
        封面与第一厅使用同一青玉门庭；四厅依次叙述起念选择、表达留白、同行变化、投入告别，章节不映射人格分数。星穹确认后才载入人物，报告用同一主画的脸肩缩略与简明摘要，随后进入五维图谱，完整内容留在本路径。
      </p>
      <h2>保留的研究对照</h2>
      <nav aria-label="历史研究">
        <Link href="/studies/visual-v2-questions/research" prefetch={false}>
          旧藏馆探寻
        </Link>
        <Link href="/studies/visual-v2-b/celestial/reveal" prefetch={false}>
          V2-B 风骨映月
        </Link>
        <Link href="/studies/visual-v2-b/landscape/reveal" prefetch={false}>
          山河入怀 · 独立可选主题
        </Link>
        <Link href="/studies/visual-v2/collection/report" prefetch={false}>
          V2-A.1 旧完整报告
        </Link>
        <Link href="/studies/visual-v2/atlas" prefetch={false}>
          4–7维与分数边界研究
        </Link>
      </nav>
      <h2>素材与实现边界</h2>
      <p>
        复用已生成的四厅与 celestial
        人物概念，只制作分辨率衍生版本，不新增角色设定。美术商用审批仍为
        pending。字体为本地 Noto Serif SC
        子集，正文使用系统字体。海报为视觉预览，未开发导出。
      </p>
      <p>
        旧十二题控制器与题库不变，新候选使用独立本机草稿。没有正式评分、身份匹配、数据库、Key、订单、支付或
        AI 报告服务；直接研究地址可访问示例，绝不代表授权或完成权威。
      </p>
    </main>
  );
}
