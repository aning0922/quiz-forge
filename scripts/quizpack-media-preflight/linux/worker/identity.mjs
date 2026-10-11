import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
process.stdout.write(
  JSON.stringify({
    node: process.versions.node,
    sharp: sharp.versions.sharp,
    vips: sharp.versions.vips,
    workerSha256: createHash("sha256")
      .update(readFileSync("/worker/media-worker.mjs"))
      .digest("hex"),
  }),
);
