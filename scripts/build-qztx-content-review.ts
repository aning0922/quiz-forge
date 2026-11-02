/** Usage: TSX_TSCONFIG_PATH=./tsconfig.json node --conditions=react-server --import tsx
 * scripts/build-qztx-content-review.ts --source /absolute/fixed-fixture --out .cache/new-review
 * [--demo-origin http://127.0.0.1:63220]. No server, registration or database writes. */
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildQianzaiContentReview,
  loadReviewContent,
  renderQianzaiContentReview,
  reviewDemoOrigin,
} from "../tests/browser/qianzai-content-review";
async function main() {
  const args = process.argv.slice(2),
    values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key ||
      !["--source", "--out", "--demo-origin"].includes(key) ||
      !value ||
      values.has(key)
    )
      throw Error("CONTENT_REVIEW_ARGUMENTS_INVALID");
    values.set(key, value);
  }
  const source = values.get("--source"),
    requested = values.get("--out");
  if (!source || !requested)
    throw Error("CONTENT_REVIEW_SOURCE_AND_NEW_OUTPUT_REQUIRED");
  const origin = reviewDemoOrigin(
    values.get("--demo-origin") ?? "http://127.0.0.1:63220",
  );
  const cwd = await realpath(process.cwd()),
    out = path.resolve(requested);
  if (!out.startsWith(cwd + "/.cache/") || path.dirname(out) === cwd)
    throw Error("CONTENT_REVIEW_CACHE_OUTPUT_REQUIRED");
  const content = await loadReviewContent(source);
  await mkdir(path.join(cwd, ".cache"), { recursive: true, mode: 0o700 });
  // Require an existing non-symlink parent and a fresh output directory.
  if ((await realpath(path.dirname(out))) !== path.dirname(out))
    throw Error("CONTENT_REVIEW_OUTPUT_SYMLINK_REJECTED");
  const review = await buildQianzaiContentReview(content);
  const json = JSON.stringify(review, null, 2) + "\n",
    html = renderQianzaiContentReview(review, origin);
  await mkdir(out, { mode: 0o700 });
  await writeFile(path.join(out, "review.json"), json, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(path.join(out, "index.html"), html, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      out,
      sourceSha256: review.sourceSha256,
      samples: review.samples.length,
      scored: review.search.totalScoredInputs,
      htmlSha256: createHash("sha256").update(html).digest("hex"),
      jsonSha256: createHash("sha256").update(json).digest("hex"),
      scope: review.scope,
      demoOrigin: origin,
      browserVerified: false,
      authorAccepted: false,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "CONTENT_REVIEW_FAILED",
  );
  process.exitCode = 1;
});
