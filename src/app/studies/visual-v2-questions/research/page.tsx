import Image from "next/image";
import Link from "next/link";
import { galleryRooms } from "@/features/theme/historical/visual-v2-questions/rooms";
import styles from "@/features/theme/historical/visual-v2-questions/questions.module.css";

export const metadata = { title: "藏馆探寻 · 答题节奏研究" };

export default function QuestionResearchPage() {
  return (
    <main id="main" className={styles.research}>
      <Link href="/studies/visual-v2-b" prefetch={false}>
        ← 结果美术研究
      </Link>
      <p>VISUAL V2 · 答题体验补充研究</p>
      <h1>
        循灯入馆，
        <br />
        十二问见心。
      </h1>
      <p>
        沿着青玉、暖金、雨蓝与靛夜，走过四间不同展厅。每次选择点亮一枚行记，四张问笺保持同样的操作方式；返回改选时，行记也准确更新。
      </p>
      <p>
        这是独立视觉原型，复用原12题与暂存机制，使用独立本机书签。点亮只表示作答进度，不是人物线索计算或人格评分。最后进入已标注的固定合成揭晓。四张展厅美术为实际生成的原创AI概念，商用与作者审核pending。
      </p>
      <nav>
        <Link href="/studies/visual-v2-questions" prefetch={false}>
          开始藏馆探寻
        </Link>
        <Link href="/studies/visual-v2/collection/question" prefetch={false}>
          对照旧版答题
        </Link>
      </nav>
      <div className={styles.roomGrid}>
        {galleryRooms.map((room, index) => (
          <section key={room.name}>
            <Image
              src={`/assets/themes/historical/visual-v2-questions/room-${index + 1}.webp`}
              alt={room.alt}
              width={1672}
              height={941}
              unoptimized
            />
            <h2>
              {String(index + 1).padStart(2, "0")} · {room.name}
            </h2>
            <p>
              第{index * 3 + 1}–{index * 3 + 3}问 · {room.chapter}
            </p>
          </section>
        ))}
      </div>
      <p>
        390px等常规手机使用双列问笺；320px统一为单列，保证长选项可读。无自动跳题、随机换景或阻塞章节过场；减少动态效果时直接切换场景。
      </p>
    </main>
  );
}
