import { readQianzaiTestAudio } from "@/features/theme/qianzai-tongxin/music-store";
import { QIANZAI_MUSIC } from "@/features/theme/qianzai-tongxin/music-manifest";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return readQianzaiTestAudio(request, {
    trackId: QIANZAI_MUSIC.id,
    version: QIANZAI_MUSIC.version,
  });
}

export const HEAD = GET;
