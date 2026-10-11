import Link from "next/link";
import { notFound } from "next/navigation";
import {
  atlasSamples,
  getAtlasSample,
  type AtlasSample,
} from "@/features/report/historical-atlas-fixture";
import { ResultAtlas } from "@/features/theme/historical/visual-v2/result-atlas";
import { StudyShell } from "@/features/theme/historical/visual-v2/shared";
import styles from "@/features/theme/historical/visual-v2/result-atlas.module.css";

export const metadata = { title: "性情图谱 · 边界研究" };
const sampleNames = {
  four: "4项 · 0 / 50 / 100",
  five: "5项 · 默认示意",
  seven: "7项 · 临界数值",
  long: "7项 · 超长文本",
};
export default async function AtlasStudy({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; sample?: string }>;
}) {
  const query = await searchParams;
  const direction = query.direction ?? "journey";
  const sample = query.sample ?? "five";
  if (
    (direction !== "journey" && direction !== "collection") ||
    !atlasSamples.includes(sample as AtlasSample)
  )
    notFound();
  return (
    <StudyShell direction={direction} view="atlas">
      <div className={styles.study}>
        <Link href="/studies/visual-v2" className={styles.studyBack}>
          ← 双方向研究入口
        </Link>
        <h1>性情图谱 · 边界研究</h1>
        <p>
          固定合成夹具，仅检查数值与排版，不对应任何人物匹配。这里的入口不出现在消费者报告内。
        </p>
        <nav aria-label="研究维度数量">
          {atlasSamples.map((id) => (
            <Link
              key={id}
              prefetch={false}
              aria-current={sample === id ? "page" : undefined}
              href={`?direction=${direction}&sample=${id}`}
            >
              {sampleNames[id]}
            </Link>
          ))}
        </nav>
        <nav aria-label="图谱主题">
          <Link prefetch={false} href={`?direction=journey&sample=${sample}`}>
            A · 入画寻己
          </Link>
          <Link
            prefetch={false}
            href={`?direction=collection&sample=${sample}`}
          >
            B · 风骨藏馆
          </Link>
        </nav>
        <ResultAtlas
          atlas={getAtlasSample(sample as AtlasSample)}
          direction={direction}
        />
      </div>
    </StudyShell>
  );
}
