import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
  sha256Schema,
  engineDeclarationSchema,
} from "@/lib/assessment-contract/primitives";
import { fixedDisplayComponentsSchema } from "./identity-contracts";
const id = assessmentIdSchema.refine((v) => !/[\r\n]/.test(v)),
  version = assessmentVersionSchema.refine((v) => !/[\r\n]/.test(v)),
  sha = sha256Schema.length(64);
const filePath = z
  .string()
  .min(1)
  .max(260)
  .regex(/^[a-zA-Z0-9_./-]+(?![\s\S])/)
  .refine(
    (p) =>
      !p.startsWith("/") && !p.split("/").includes("..") && !p.includes("//"),
  );
const fileFact = z.strictObject({
  path: filePath,
  bytes: z.number().int().min(1).max(8388608),
  sha256: sha,
});
const name = z
  .string()
  .min(1)
  .max(120)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?![\s\S])/);
const lockKey = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9@._/()+,=-]+(?![\s\S])/);
const closure = z
  .strictObject({
    entrypoints: z
      .strictObject({
        path: filePath,
        exports: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[A-Za-z_$][A-Za-z0-9_$]*(?![\s\S])/)
          .array()
          .min(1)
          .max(12),
        runtime: z.enum(["server", "browser"]),
      })
      .array()
      .min(1)
      .max(16),
    files: fileFact.array().min(1).max(512),
    buildInputs: fileFact.array().min(1).max(8),
    dependencies: z.strictObject({
      roots: z
        .strictObject({
          name,
          version,
          lockSnapshot: lockKey,
          section: z.enum(["dependencies", "devDependencies"]),
          importerSha256: sha,
        })
        .array()
        .min(1)
        .max(32),
      lockRecords: z
        .strictObject({
          section: z.enum(["packages", "snapshots"]),
          key: lockKey,
          bytes: z.number().int().min(1).max(65536),
          sha256: sha,
        })
        .array()
        .min(1)
        .max(512),
      settingsSha256: sha,
      builtins: z
        .string()
        .regex(/^node:[a-z_/-]+(?![\s\S])/)
        .array()
        .max(16),
    }),
    runtimePolicy: z.strictObject({
      node: z.string().min(1).max(100),
      packageManager: z.string().min(1).max(64),
      browser: z.literal("standards-dom-canvas-webcrypto").nullable(),
      jsxImport: z.literal("react/jsx-runtime").nullable(),
      serverCondition: z.literal("react-server"),
    }),
  })
  .superRefine((v, ctx) => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    if (
      !unique(v.files.map((x) => x.path)) ||
      !unique(v.buildInputs.map((x) => x.path)) ||
      !unique(v.dependencies.roots.map((x) => x.name)) ||
      !unique(v.dependencies.lockRecords.map((x) => x.section + ":" + x.key)) ||
      !unique(v.dependencies.builtins) ||
      v.entrypoints.some(
        (e) => !v.files.some((f) => f.path === e.path) || !unique(e.exports),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Implementation closure contains duplicate or missing facts.",
      });
  });
const fontPath = z
  .string()
  .min(1)
  .max(260)
  .regex(/^\/assets\/fonts\/[a-zA-Z0-9_./-]+(?![\s\S])/)
  .refine((p) => !p.split("/").includes("..") && !p.includes("//"));
const common = {
  schemaVersion: z.literal("quizforge.implementation-entry.v1"),
  id,
  version,
  closure,
  implementationSha256: sha,
};
export const rendererImplementationDescriptorSchema = z.strictObject({
  ...common,
  kind: z.literal("renderer"),
  capability: z.literal("studio-internal-preview"),
  contentSchemaVersion: z.literal("quizpack-content.v2"),
  components: fixedDisplayComponentsSchema,
  font: z.strictObject({
    id,
    version,
    family: z.string().min(1).max(100),
    weight: z.literal(600),
    file: fontPath,
    fileSha256: sha,
    bytes: z.number().int().positive().max(8388608),
    coverage: fontPath,
    coverageSha256: sha,
    licenseFile: fontPath,
    licenseSha256: sha,
  }),
});
export const engineImplementationDescriptorSchema = z
  .strictObject({
    ...common,
    kind: z.literal("engine"),
    id: engineDeclarationSchema.shape.id,
    version: engineDeclarationSchema.shape.version,
    algorithm: engineDeclarationSchema,
  })
  .refine((v) => v.id === v.algorithm.id && v.version === v.algorithm.version);
export const rendererImplementationEntrySchema = z.strictObject({
  descriptor: rendererImplementationDescriptorSchema,
  entrySha256: sha,
});
export const engineImplementationEntrySchema = z.strictObject({
  descriptor: engineImplementationDescriptorSchema,
  entrySha256: sha,
});
export type RendererImplementationEntry = z.infer<
  typeof rendererImplementationEntrySchema
>;
export type EngineImplementationEntry = z.infer<
  typeof engineImplementationEntrySchema
>;
export type ImplementationEntry =
  RendererImplementationEntry | EngineImplementationEntry;
