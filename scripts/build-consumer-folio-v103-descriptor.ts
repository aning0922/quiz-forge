/** New executable identity; all prior folio descriptors remain immutable. */
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { collectQztxImplementationClosure } from "./qztx-implementation-closure";
import prior from "../src/features/product/internal-play/implementation-data/consumer-folio-cabinet-v1-2.json";
import { consumerCanonicalText } from "../src/lib/consumer-contract/v1/integrity";
import {
  verifyConsumerImplementationEntry,
  consumerImplementationEntrySchema,
} from "../src/features/product/internal-play/implementation-schema";

const [output] = process.argv.slice(2);
if (
  !output ||
  process.argv.length !== 3 ||
  !resolve(output).startsWith(resolve(".cache") + "/")
)
  throw Error("EXPLICIT_PRIVATE_OUTPUT_REQUIRED");
const descriptor = consumerImplementationEntrySchema.parse(
  structuredClone(prior),
).descriptor;
descriptor.version = "1.0.3";
const font = descriptor.font;
descriptor.closure = await collectQztxImplementationClosure(
  process.cwd(),
  descriptor.closure.entrypoints,
  [font.file, font.coverage, font.licenseFile].map((p) => "public" + p),
);
const hash = (value: unknown) =>
  createHash("sha256")
    .update(consumerCanonicalText(value, 262144))
    .digest("hex");
descriptor.implementationSha256 = hash(descriptor.closure);
const entry = await verifyConsumerImplementationEntry({
  descriptor,
  entrySha256: hash(descriptor),
});
await writeFile(output, JSON.stringify(entry, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    entrySha256: entry.entrySha256,
    version: descriptor.version,
    files: descriptor.closure.files.length,
    registered: false,
  }),
);
