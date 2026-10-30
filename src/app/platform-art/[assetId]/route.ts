import { findPlatformArt } from "@/features/platform-home/art-manifest";
import { readPlatformArt } from "@/features/platform-home/art-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const art = findPlatformArt(assetId);
  if (!art)
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  const bytes = await readPlatformArt(
    art,
    process.env.QUIZFORGE_PLATFORM_ART_DIR,
  );
  if (!bytes)
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  return new Response(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: art.mediaType }),
    {
      headers: {
        "content-type": art.mediaType,
        "content-length": String(art.bytes),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    },
  );
}
