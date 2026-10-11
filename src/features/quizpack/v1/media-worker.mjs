// Trusted local worker. It receives bytes on stdin, never a package file path.
import sharp from "sharp";

const [maxBytes, maxDimension, maxPixels] = process.argv.slice(2).map(Number);
const reject = (code) => {
  process.stdout.write(JSON.stringify({ ok: false, code }));
};
sharp.cache(false);
sharp.concurrency(1);
const chunks = [];
let total = 0;
try {
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("limit");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, total);
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: maxPixels,
    sequentialRead: true,
    animated: true,
  });
  const metadata = await image.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format)) {
    reject("MEDIA_FORMAT_MISMATCH");
  } else if ((metadata.pages ?? 1) !== 1 || (metadata.delay?.length ?? 0) > 1) {
    reject("MEDIA_ANIMATED");
  } else if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > maxDimension ||
    metadata.height > maxDimension ||
    metadata.width * metadata.height > maxPixels
  ) {
    reject("MEDIA_LIMIT");
  } else {
    // Forces complete original-size pixel decode. Metadata or a thumbnail is insufficient.
    const { info, data } = await image
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      info.width !== metadata.width ||
      info.height !== metadata.height ||
      data.length !== info.width * info.height * info.channels
    ) {
      reject("MEDIA_DECODE_FAILED");
    } else {
      process.stdout.write(
        JSON.stringify({
          ok: true,
          mediaType: `image/${metadata.format}`,
          width: info.width,
          height: info.height,
          frames: 1,
          mediaDecoded: true,
        }),
      );
    }
  }
} catch {
  reject("MEDIA_DECODE_FAILED");
}
