import { z } from "zod";
import {
  foundationIdSchema as id,
  foundationReferenceSchema as reference,
  foundationResourceSchema,
  foundationTextSchema as text,
  foundationVersionSchema as version,
} from "../theme/resource-contract";

const definition = { id, productId: id, version };
const dimensionValue = z.strictObject({
  dimensionRef: reference,
  value: z.number().int().min(-100).max(100),
});
const optionSchema = z.strictObject({
  ...definition,
  label: text,
  effects: z.array(dimensionValue).min(1).max(16),
});
const componentSchema = z.strictObject({
  ...definition,
  registryId: id,
  propsSchemaVersion: version,
});
const layoutSchema = z.strictObject({
  componentRef: reference,
  resourceRefs: z.array(reference).min(1).max(16),
});
const baselineSchema = z.strictObject({
  title: text,
  summary: text,
  strengths: z.array(text).min(1).max(8),
  tensions: z.array(text).min(1).max(8),
  reflection: text,
  disclaimer: text,
});

/** Finite structural contract, independent of the D0 QuizPack proposal and runtime. */
export const foundationBundleSchema = z.strictObject({
  schemaVersion: z.literal("foundation.v1"),
  kind: z.literal("synthetic"),
  product: z.strictObject({
    productId: id,
    slug: id,
    title: text,
    categoryId: id,
    tags: z.array(id).max(12),
  }),
  contentVersion: version,
  dimensions: z
    .array(z.strictObject({ ...definition, label: text }))
    .min(1)
    .max(16),
  questions: z
    .array(
      z.strictObject({
        ...definition,
        prompt: text,
        options: z.array(optionSchema).min(2).max(8),
      }),
    )
    .min(1)
    .max(100),
  rules: z.strictObject({
    kind: z.literal("archetype"),
    declarationOnly: z.literal(true),
    tieBreak: z.literal("result-order"),
    resultOrder: z.array(reference).length(3),
    profiles: z
      .array(
        z.strictObject({
          resultRef: reference,
          targets: z.array(dimensionValue).min(1).max(16),
        }),
      )
      .length(3),
  }),
  results: z
    .array(
      z.strictObject({
        ...definition,
        kind: z.literal("synthetic"),
        label: text,
        portraitRef: reference,
        reportTemplateRef: reference,
        baseline: baselineSchema,
        witness: z.strictObject({
          status: z.literal("declared-not-executed"),
          answers: z
            .array(
              z.strictObject({ questionRef: reference, optionRef: reference }),
            )
            .min(1)
            .max(100),
        }),
      }),
    )
    .length(3),
  reportTemplates: z
    .array(
      z.strictObject({
        ...definition,
        mode: z.literal("DETERMINISTIC"),
        componentRef: reference,
      }),
    )
    .min(1)
    .max(8),
  components: z.array(componentSchema).min(1).max(24),
  layouts: z.strictObject({
    cover: layoutSchema,
    question: layoutSchema,
    resume: layoutSchema,
    result: layoutSchema,
    report: layoutSchema,
    poster: layoutSchema,
  }),
  resources: z.array(foundationResourceSchema).min(1).max(64),
});

export type FoundationBundle = z.infer<typeof foundationBundleSchema>;
export interface FoundationIssue {
  code: string;
  path: (string | number)[];
  message: string;
}
export interface FoundationValidation {
  structurallyValid: boolean;
  referenceValid: boolean;
  publishable: false;
  issues: FoundationIssue[];
  unverified: string[];
}
const unverified = [
  "zip-container-and-extraction",
  "file-bytes-media-type-and-sha256",
  "scoring-and-witness-reachability",
  "component-registry-and-compatibility",
  "source-and-commercial-license-claims",
  "human-content-visual-and-resource-approval",
  "database-authorization-and-publication",
];

/** Structure only. Ownership, references and declarations require the validator. */
export function getFoundationJsonSchema() {
  return z.toJSONSchema(foundationBundleSchema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
  });
}

/** Does not execute rules, read assets, consult a registry, or authorize publication. */
export function validateFoundationBundle(
  input: unknown,
  targetProductId: string,
): FoundationValidation {
  const parsed = foundationBundleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      structurallyValid: false,
      referenceValid: false,
      publishable: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "invalid_structure",
        // Zod messages and unknown key names may contain input. Emit only known paths.
        path: issue.path.map((part) =>
          typeof part === "number" ? part : String(part),
        ),
        message:
          "Value does not satisfy the foundation.v1 structural contract.",
      })),
      unverified: [...unverified],
    };
  }
  const bundle = parsed.data;
  const issues: FoundationIssue[] = [];
  const add = (code: string, path: (string | number)[], message: string) => {
    issues.push({ code, path, message });
  };
  if (
    !id.safeParse(targetProductId).success ||
    bundle.product.productId !== targetProductId
  ) {
    add(
      "target_product_mismatch",
      ["product", "productId"],
      "Bundle must belong to the caller's target product.",
    );
  }
  const productId = bundle.product.productId;
  type Definition = z.infer<typeof reference>;
  const index = <T extends Definition>(
    items: T[],
    path: (string | number)[],
  ) => {
    const map = new Map<string, T>();
    items.forEach((item, i) => {
      if (map.has(item.id))
        add(
          "duplicate_id",
          [...path, i, "id"],
          "Definition IDs must be unique within their namespace.",
        );
      else map.set(item.id, item);
      if (item.productId !== productId)
        add(
          "foreign_owner",
          [...path, i, "productId"],
          "Definition must belong to this product.",
        );
      if (item.version !== bundle.contentVersion)
        add(
          "definition_version_mismatch",
          [...path, i, "version"],
          "Definition must use the pinned content version.",
        );
    });
    return map;
  };
  const dimensions = index(bundle.dimensions, ["dimensions"]);
  const questions = index(bundle.questions, ["questions"]);
  const results = index(bundle.results, ["results"]);
  const templates = index(bundle.reportTemplates, ["reportTemplates"]);
  const components = index(bundle.components, ["components"]);
  const options = new Map<string, Definition & { questionId: string }>();
  bundle.questions.forEach((question, qi) => {
    const localOptions = index(question.options, ["questions", qi, "options"]);
    localOptions.forEach((option) => {
      if (options.has(option.id))
        add(
          "duplicate_id",
          ["questions", qi, "options"],
          "Option IDs must be unique across questions.",
        );
      else options.set(option.id, { ...option, questionId: question.id });
    });
  });
  const resources = new Map<string, Definition & { purpose: string }>();
  const paths = new Set<string>();
  const mediaByExtension: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    woff2: "font/woff2",
  };
  bundle.resources.forEach((resource, i) => {
    if (resources.has(resource.id))
      add(
        "duplicate_id",
        ["resources", i, "id"],
        "Resource IDs must be unique.",
      );
    else
      resources.set(resource.id, {
        ...resource,
        productId: resource.owner.productId,
      });
    if (resource.owner.productId !== productId)
      add(
        "foreign_owner",
        ["resources", i, "owner", "productId"],
        "Resource must belong to this product.",
      );
    if (paths.has(resource.path))
      add(
        "duplicate_path",
        ["resources", i, "path"],
        "Resource paths must be unique.",
      );
    paths.add(resource.path);
    const extension = resource.path.split(".").at(-1) ?? "";
    if (
      mediaByExtension[extension] !== resource.mediaType ||
      (resource.purpose === "font") !== (resource.mediaType === "font/woff2")
    ) {
      add(
        "resource_type_mismatch",
        ["resources", i, "mediaType"],
        "Extension, media type and resource purpose must agree.",
      );
    }
  });
  const checkRef = <T extends Definition>(
    ref: Definition,
    map: Map<string, T>,
    path: (string | number)[],
  ) => {
    const target = map.get(ref.id);
    if (
      ref.productId !== productId ||
      (target && target.productId !== ref.productId)
    )
      add(
        "foreign_reference",
        path,
        "Reference must stay within this product.",
      );
    if (!target)
      add("unknown_reference", path, "Reference has no declared target.");
    else if (ref.version !== target.version)
      add(
        "reference_version_mismatch",
        path,
        "Reference must pin the target's declared version.",
      );
    return target;
  };
  const checkDimensions = (
    values: z.infer<typeof dimensionValue>[],
    path: (string | number)[],
  ) => {
    const seen = new Set<string>();
    values.forEach((value, i) => {
      checkRef(value.dimensionRef, dimensions, [...path, i, "dimensionRef"]);
      if (seen.has(value.dimensionRef.id))
        add(
          "duplicate_reference",
          [...path, i],
          "Dimension references must be unique.",
        );
      seen.add(value.dimensionRef.id);
    });
  };
  bundle.questions.forEach((question, qi) =>
    question.options.forEach((option, oi) =>
      checkDimensions(option.effects, [
        "questions",
        qi,
        "options",
        oi,
        "effects",
      ]),
    ),
  );
  const checkResultSet = (refs: Definition[], path: (string | number)[]) => {
    const seen = new Set<string>();
    refs.forEach((ref, i) => {
      checkRef(ref, results, [...path, i]);
      if (seen.has(ref.id))
        add(
          "duplicate_reference",
          [...path, i],
          "Each result must occur exactly once.",
        );
      seen.add(ref.id);
    });
    if (bundle.results.some((result) => !seen.has(result.id)))
      add("missing_result", path, "Every declared result must be included.");
  };
  checkResultSet(bundle.rules.resultOrder, ["rules", "resultOrder"]);
  checkResultSet(
    bundle.rules.profiles.map((profile) => profile.resultRef),
    ["rules", "profiles"],
  );
  bundle.rules.profiles.forEach((profile, i) =>
    checkDimensions(profile.targets, ["rules", "profiles", i, "targets"]),
  );
  bundle.results.forEach((result, ri) => {
    const portrait = checkRef(result.portraitRef, resources, [
      "results",
      ri,
      "portraitRef",
    ]);
    if (portrait && portrait.purpose !== "portrait")
      add(
        "resource_purpose_mismatch",
        ["results", ri, "portraitRef"],
        "Result portrait must reference a portrait resource.",
      );
    checkRef(result.reportTemplateRef, templates, [
      "results",
      ri,
      "reportTemplateRef",
    ]);
    const answered = new Set<string>();
    result.witness.answers.forEach((answer, ai) => {
      const path = ["results", ri, "witness", "answers", ai];
      checkRef(answer.questionRef, questions, [...path, "questionRef"]);
      const option = checkRef(answer.optionRef, options, [
        ...path,
        "optionRef",
      ]);
      if (option && option.questionId !== answer.questionRef.id)
        add(
          "wrong_question_option",
          [...path, "optionRef"],
          "Witness option must belong to its question.",
        );
      if (answered.has(answer.questionRef.id))
        add(
          "duplicate_answer",
          path,
          "Witness must answer each question once.",
        );
      answered.add(answer.questionRef.id);
    });
    if (bundle.questions.some((question) => !answered.has(question.id)))
      add(
        "missing_answer",
        ["results", ri, "witness", "answers"],
        "Witness must answer every declared question.",
      );
  });
  bundle.reportTemplates.forEach((template, i) =>
    checkRef(template.componentRef, components, [
      "reportTemplates",
      i,
      "componentRef",
    ]),
  );
  Object.entries(bundle.layouts).forEach(([state, layout]) => {
    checkRef(layout.componentRef, components, [
      "layouts",
      state,
      "componentRef",
    ]);
    const seen = new Set<string>();
    layout.resourceRefs.forEach((ref, i) => {
      checkRef(ref, resources, ["layouts", state, "resourceRefs", i]);
      if (seen.has(ref.id))
        add(
          "duplicate_reference",
          ["layouts", state, "resourceRefs", i],
          "Layout resource references must be unique.",
        );
      seen.add(ref.id);
    });
  });
  if (new Set(bundle.product.tags).size !== bundle.product.tags.length)
    add("duplicate_id", ["product", "tags"], "Tags must be unique.");
  return {
    structurallyValid: true,
    referenceValid: issues.length === 0,
    publishable: false,
    issues,
    unverified: [...unverified],
  };
}
