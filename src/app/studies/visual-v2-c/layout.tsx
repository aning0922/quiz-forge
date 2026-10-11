import styles from "@/features/theme/historical/visual-v2-c/candidate.module.css";

export const metadata = { title: "千载同心 · 藏馆探寻" };

export default function CandidateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={styles.system}>{children}</div>;
}
