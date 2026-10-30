import { notFound } from "next/navigation";
import {
  PlatformPage,
  PlatformWorkCover,
} from "@/features/platform-home/page-composition";
export default async function Page({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const { workId } = await params;
  if (workId === "qianzai-tongxin") return <PlatformWorkCover />;
  if (workId === "heart" || workId === "cat")
    return <PlatformPage view={workId} />;
  notFound();
}
