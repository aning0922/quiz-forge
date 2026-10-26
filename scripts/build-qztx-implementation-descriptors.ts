import { mkdir, writeFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, dirname } from "node:path";
import { collectQztxImplementationClosure } from "./qztx-implementation-closure";
import { consumerCanonicalText } from "../src/lib/consumer-contract/v1/integrity";
import {
  CONSUMER_PROTOCOLS_V2,
  STRUCTURED_FONT_V2,
} from "../src/lib/consumer-contract/v2/identities";
import { CONTENT_COMPONENTS_V3 } from "../src/lib/assessment-contract/presentation-v3";
import {
  CONSUMER_COMPONENT_MAPPING_V2,
  CONSUMER_RENDERER_V2,
} from "../src/features/theme/consumer-v2/component-map";
import { verifyInternalImplementationEntryV2 } from "../src/features/product/internal-versions/implementation-schema-v2";
import { verifyConsumerImplementationEntryV2 } from "../src/features/product/internal-play/implementation-schema-v2";

const hash = (value: unknown) =>
  createHash("sha256")
    .update(consumerCanonicalText(value, 262_144), "utf8")
    .digest("hex");
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out" || !args[1])
    throw Error("EXPLICIT_NEW_OUTPUT_DIRECTORY_REQUIRED");
  const cwd = process.cwd(),
    out = resolve(cwd, args[1]);
  if (!out.startsWith(resolve(cwd) + "/.cache/"))
    throw Error("PRIVATE_CANDIDATE_OUTPUT_REQUIRED");
  if ((await realpath(dirname(out))) !== dirname(out))
    throw Error("PRIVATE_OUTPUT_SYMLINK_REJECTED");
  const projection = {
    path: "src/features/theme/preview/v3-projection.ts",
    exports: ["projectContentEntryV3", "projectPreparedResultV3"],
    runtime: "server" as const,
  };
  const engineClosure = await collectQztxImplementationClosure(cwd, [
    {
      path: "src/features/product/internal-versions/implementations/engine-v2.ts",
      exports: ["bindEngineV2"],
      runtime: "server",
    },
  ]);
  const previewClosure = await collectQztxImplementationClosure(cwd, [
    projection,
    {
      path: "src/features/theme/consumer-v2/studio-structure-preview.tsx",
      exports: ["StudioStructurePreviewV2"],
      runtime: "browser",
    },
  ]);
  const consumerClosure = await collectQztxImplementationClosure(cwd, [
    projection,
    {
      path: "src/features/theme/consumer-v2/host.tsx",
      exports: ["ConsumerExperienceV2"],
      runtime: "browser",
    },
    {
      path: "src/lib/consumer-contract/v2/state.ts",
      exports: [
        "verifyConsumerSaveInputV2",
        "verifyConsumerStateV2",
        "consumerCompleteBindingV2Schema",
      ],
      runtime: "server",
    },
    {
      path: "src/features/report/persisted/view-contracts-v2.ts",
      exports: ["verifyPersistedReportViewV2"],
      runtime: "server",
    },
  ]);
  const presentation = {
    presentationMode: "structured-only",
    exports: { posterPng: false, fullReportPng: false },
    font: STRUCTURED_FONT_V2,
  };
  const engine = {
    schemaVersion: "quizforge.implementation-entry.v2",
    kind: "engine",
    id: "archetype-l1",
    version: "1.0.0",
    algorithm: { id: "archetype-l1", version: "1.0.0" },
    contentSchemaVersion: "quizpack-content.v3",
    closure: engineClosure,
    implementationSha256: hash(engineClosure),
  };
  const preview = {
    schemaVersion: "quizforge.implementation-entry.v2",
    kind: "renderer",
    id: "structured-composed-preview",
    version: "1.0.0",
    capability: "studio-internal-preview",
    contentSchemaVersion: "quizpack-content.v3",
    ...presentation,
    components: Object.fromEntries(
      Object.entries(CONTENT_COMPONENTS_V3).map(([state, id]) => [
        state,
        { id, version: "1.0.0", propsSchemaVersion: "1.0.0" },
      ]),
    ),
    closure: previewClosure,
    implementationSha256: hash(previewClosure),
  };
  const consumer = {
    schemaVersion: "quizforge.consumer-implementation-entry.v2",
    kind: "consumer-renderer",
    ...CONSUMER_RENDERER_V2,
    capability: "local-internal-consumer",
    contentSchemaVersion: "quizpack-content.v3",
    mapping: CONSUMER_COMPONENT_MAPPING_V2,
    mappingSha256: hash(CONSUMER_COMPONENT_MAPPING_V2),
    protocols: CONSUMER_PROTOCOLS_V2,
    ...presentation,
    closure: consumerClosure,
    implementationSha256: hash(consumerClosure),
  };
  const entries = [
    [
      "engine-archetype-l1-v1.json",
      await verifyInternalImplementationEntryV2({
        descriptor: engine,
        entrySha256: hash(engine),
      }),
    ],
    [
      "renderer-structured-composed-v1.json",
      await verifyInternalImplementationEntryV2({
        descriptor: preview,
        entrySha256: hash(preview),
      }),
    ],
    [
      "consumer-structured-composed-v1.json",
      await verifyConsumerImplementationEntryV2({
        descriptor: consumer,
        entrySha256: hash(consumer),
      }),
    ],
  ] as const;
  await mkdir(out, { mode: 0o700 });
  for (const [name, entry] of entries)
    await writeFile(resolve(out, name), JSON.stringify(entry, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  console.log(
    JSON.stringify({
      directory: relative(cwd, out),
      entries: entries.map(([name, e]) => ({
        name,
        entrySha256: e.entrySha256,
        sourceFiles: e.descriptor.closure.files.length,
      })),
      registered: false,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      code: "IMPLEMENTATION_CANDIDATE_BUILD_FAILED",
      reason: error instanceof Error ? error.message : "UNKNOWN",
    }),
  );
  process.exitCode = 1;
});
