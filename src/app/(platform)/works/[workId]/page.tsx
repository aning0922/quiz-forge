import { notFound } from "next/navigation";
import { PlatformWorkCover } from "@/features/platform-home/page-composition";
export default async function Page({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  if ((await params).workId !== "qianzai-tongxin") notFound();
  return <PlatformWorkCover />;
}
