import { mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { collectQztxImplementationClosure } from "./qztx-implementation-closure";
import { consumerCanonicalText } from "../src/lib/consumer-contract/v1/integrity";
import { verifyInternalImplementationEntryV2 } from "../src/features/product/internal-versions/implementation-schema-v2";
import { verifyConsumerImplementationEntryV2 } from "../src/features/product/internal-play/implementation-schema-v2";
import {
  CONSUMER_PROTOCOLS_V2,
  STRUCTURED_FONT_V2,
} from "../src/lib/consumer-contract/v2/identities";
import { CONTENT_COMPONENTS_V3 } from "../src/lib/assessment-contract/presentation-v3";
import {
  CONSUMER_COMPONENT_MAPPING_V2,
  CONSUMER_RENDERER_V2,
} from "../src/features/theme/consumer-v2/component-map";
import {
  QIANZAI_COMPONENT_MAPPING,
  QIANZAI_CONSUMER_RENDERER,
  QIANZAI_PREVIEW_RENDERER,
  QIANZAI_PRESENTATION,
} from "../src/features/theme/qianzai-tongxin/component-map";
import { QIANZAI_RUNTIME_INPUTS } from "../src/features/theme/qianzai-tongxin/runtime-inputs";

const hash = (v: unknown) =>
  createHash("sha256").update(consumerCanonicalText(v, 262144)).digest("hex");
type Entry = { path: string; exports: string[]; runtime: "browser" | "server" };
const entry = (
  path: string,
  names: string[],
  runtime: Entry["runtime"],
): Entry => ({ path, exports: names, runtime });
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out")
    throw Error("EXPLICIT_NEW_OUTPUT_REQUIRED");
  const out = resolve(args[1]!);
  if (
    !out.startsWith(resolve(process.cwd(), ".cache") + "/") ||
    (await realpath(dirname(out))) !== dirname(out)
  )
    throw Error("PRIVATE_OUTPUT_REQUIRED");
  const font = QIANZAI_RUNTIME_INPUTS.font;
  if (!font || font.id !== "qianzai-tongxin-serif" || font.version !== "1.1.0")
    throw Error("PINNED_QIANZAI_FONT_REQUIRED");
  const fonts = [font.file, font.coverage, font.licenseFile].map(
    (f) => "public" + f,
  );
  const projection = entry(
    "src/features/theme/preview/v3-projection.ts",
    ["projectContentEntryV3", "projectPreparedResultV3"],
    "server",
  );
  const authoredProjection = entry(
    "src/features/theme/qianzai-tongxin/projection.ts",
    ["projectQianzaiEntry", "projectQianzaiResult"],
    "server",
  );
  const session = entry(
    "src/features/theme/consumer-v2/experience.tsx",
    ["ConsumerSessionRuntimeV2"],
    "browser",
  );
  const owner = entry(
    "src/features/theme/consumer-v2/controller.ts",
    ["ConsumerControllerV2"],
    "browser",
  );
  const protocols = [
    entry(
      "src/lib/consumer-contract/v2/state.ts",
      [
        "verifyConsumerSaveInputV2",
        "verifyConsumerStateV2",
        "consumerCompleteBindingV2Schema",
      ],
      "server",
    ),
    entry(
      "src/features/report/persisted/view-contracts-v2.ts",
      ["verifyPersistedReportViewV2"],
      "server",
    ),
  ];
  const collect = (entries: Entry[], files: string[] = []) =>
    collectQztxImplementationClosure(process.cwd(), entries, files);
  const engineClosure = await collect([
    entry(
      "src/features/product/internal-versions/implementations/engine-v2.ts",
      ["bindEngineV2"],
      "server",
    ),
  ]);
  const structuredPreviewClosure = await collect([
    projection,
    entry(
      "src/features/theme/consumer-v2/studio-structure-preview.tsx",
      ["StudioStructurePreviewV2"],
      "browser",
    ),
  ]);
  const structuredConsumerClosure = await collect([
    projection,
    session,
    owner,
    entry(
      "src/features/theme/consumer-v2/host.tsx",
      ["ConsumerExperienceV2"],
      "browser",
    ),
    ...protocols,
  ]);
  const qianzaiPreviewClosure = await collect(
    [
      authoredProjection,
      entry(
        "src/features/theme/qianzai-tongxin/fixed-preview.tsx",
        ["QianzaiFixedPreview"],
        "browser",
      ),
    ],
    fonts,
  );
  const qianzaiConsumerClosure = await collect(
    [
      authoredProjection,
      session,
      owner,
      entry(
        "src/features/theme/qianzai-tongxin/runtime.tsx",
        ["QianzaiTongxinRuntime"],
        "browser",
      ),
      ...protocols,
    ],
    fonts,
  );
  const structured = {
    presentationMode: "structured-only",
    exports: { posterPng: false, fullReportPng: false },
    font: STRUCTURED_FONT_V2,
  };
  const components = Object.fromEntries(
    Object.entries(CONTENT_COMPONENTS_V3).map(([k, id]) => [
      k,
      { id, version: "1.0.0", propsSchemaVersion: "1.0.0" },
    ]),
  );
  const internal = async (descriptor: unknown) =>
    verifyInternalImplementationEntryV2({
      descriptor,
      entrySha256: hash(descriptor),
    });
  const preview = (
    id: string,
    version: string,
    presentation: object,
    closure: unknown,
  ) =>
    internal({
      schemaVersion: "quizforge.implementation-entry.v2",
      kind: "renderer",
      id,
      version,
      capability: "studio-internal-preview",
      contentSchemaVersion: "quizpack-content.v3",
      components,
      ...presentation,
      closure,
      implementationSha256: hash(closure),
    });
  const consumer = async (
    id: string,
    version: string,
    mapping: unknown,
    presentation: object,
    closure: unknown,
  ) => {
    const descriptor = {
      schemaVersion: "quizforge.consumer-implementation-entry.v2",
      kind: "consumer-renderer",
      id,
      version,
      capability: "local-internal-consumer",
      contentSchemaVersion: "quizpack-content.v3",
      mapping,
      mappingSha256: hash(mapping),
      protocols: CONSUMER_PROTOCOLS_V2,
      ...presentation,
      closure,
      implementationSha256: hash(closure),
    };
    return verifyConsumerImplementationEntryV2({
      descriptor,
      entrySha256: hash(descriptor),
    });
  };
  const bindings = {
    engine: await internal({
      schemaVersion: "quizforge.implementation-entry.v2",
      kind: "engine",
      id: "archetype-l1",
      version: "1.0.0",
      algorithm: { id: "archetype-l1", version: "1.0.0" },
      contentSchemaVersion: "quizpack-content.v3",
      closure: engineClosure,
      implementationSha256: hash(engineClosure),
    }),
    structuredPreview: await preview(
      "structured-composed-preview",
      "1.0.0",
      structured,
      structuredPreviewClosure,
    ),
    structuredConsumer: await consumer(
      CONSUMER_RENDERER_V2.id,
      CONSUMER_RENDERER_V2.version,
      CONSUMER_COMPONENT_MAPPING_V2,
      structured,
      structuredConsumerClosure,
    ),
    qianzaiPreview: await preview(
      QIANZAI_PREVIEW_RENDERER.id,
      QIANZAI_PREVIEW_RENDERER.version,
      { ...QIANZAI_PRESENTATION, font },
      qianzaiPreviewClosure,
    ),
    qianzaiConsumer: await consumer(
      QIANZAI_CONSUMER_RENDERER.id,
      QIANZAI_CONSUMER_RENDERER.version,
      QIANZAI_COMPONENT_MAPPING,
      { ...QIANZAI_PRESENTATION, font },
      qianzaiConsumerClosure,
    ),
  };
  await mkdir(out, { mode: 0o700 });
  await writeFile(
    resolve(out, "d3-runtime-bindings.json"),
    JSON.stringify(bindings, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(
    JSON.stringify({
      registered: false,
      entries: Object.fromEntries(
        Object.entries(bindings).map(([k, v]) => [
          k,
          {
            entrySha256: v.entrySha256,
            files: v.descriptor.closure.files.length,
          },
        ]),
      ),
    }) + "\n",
  );
}
main().catch((e) => {
  process.stderr.write(
    (e instanceof Error ? e.message : "D3_DESCRIPTOR_FAILED") + "\n",
  );
  process.exitCode = 1;
});
