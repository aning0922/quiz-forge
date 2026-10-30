import { PlatformPage } from "@/features/platform-home/page-composition";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const { preview } = await searchParams;
  const view = preview === "heart" || preview === "cat" ? preview : "catalog";
  return <PlatformPage view={view} />;
}
