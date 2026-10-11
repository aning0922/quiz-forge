import type { PackIssue } from "./api";
import type { ContentReference, QuizPackContent } from "./content";
import { PACK_LIMITS } from "./limits";
import type { QuizPackManifest } from "./manifest";

type Path = (string | number)[];
const componentKey = (value: {
  id: string;
  version: string;
  propsSchemaVersion: string;
}) => `${value.id}@${value.version}:${value.propsSchemaVersion}`;
const mimeExtension = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

/** Checks declarations and exact references; never executes scores or witnesses. */
export function validateContentReferences(
  manifest: QuizPackManifest,
  content: QuizPackContent,
  targetProductId: string,
): PackIssue[] {
  const issues: PackIssue[] = [];
  const add = (code: string, path: Path, message: string) => {
    issues.push({ code, path, message });
  };
  const productId = content.product.productId;
  if (productId !== targetProductId || manifest.productId !== targetProductId)
    add(
      "TARGET_PRODUCT_MISMATCH",
      ["product", "productId"],
      "Both declarations must belong to the target Product.",
    );
  if (
    manifest.contentSchemaVersion !== content.schemaVersion ||
    componentKey({ ...manifest.engine, propsSchemaVersion: "1.0.0" }) !==
      componentKey({ ...content.engine, propsSchemaVersion: "1.0.0" }) ||
    content.rules.kind !== content.engine.id
  )
    add(
      "CONTENT_DECLARATION_MISMATCH",
      ["engine"],
      "Manifest, content and rule contracts must agree.",
    );
  const index = <T extends ContentReference>(
    items: readonly T[],
    path: Path,
    expectedVersion: string,
  ) => {
    const map = new Map<string, T>();
    items.forEach((item, i) => {
      if (map.has(item.id))
        add(
          "DUPLICATE_ID",
          [...path, i, "id"],
          "Definition IDs must be unique in their namespace.",
        );
      else map.set(item.id, item);
      if (item.productId !== productId)
        add(
          "FOREIGN_OWNER",
          [...path, i, "productId"],
          "Every definition must belong to this Product.",
        );
      if (item.version !== expectedVersion)
        add(
          "DEFINITION_VERSION_MISMATCH",
          [...path, i, "version"],
          "Definition must use its pinned domain version.",
        );
    });
    return map;
  };
  const dimensions = index(
    content.dimensions,
    ["dimensions"],
    content.contentVersion,
  );
  const questions = index(
    content.questions,
    ["questions"],
    content.contentVersion,
  );
  const results = index(content.results, ["results"], content.contentVersion);
  const reports = index(
    content.reportTemplates,
    ["reportTemplates"],
    content.reportVersion,
  );
  const resources = index(
    content.resources,
    ["resources"],
    content.resourceVersion,
  );
  const options = new Map<string, ContentReference>();
  const resolve = <T extends ContentReference>(
    ref: ContentReference,
    map: ReadonlyMap<string, T>,
    path: Path,
  ) => {
    const item = map.get(ref.id);
    if (!item)
      add(
        "MISSING_REFERENCE",
        path,
        "Reference must resolve in its declared namespace.",
      );
    else if (ref.productId !== item.productId || ref.version !== item.version)
      add(
        "REFERENCE_VERSION_OR_OWNER_MISMATCH",
        path,
        "Reference must match the exact Product and version.",
      );
    return item;
  };
  const completeDimensions = (
    items: readonly { dimensionRef: ContentReference }[],
    path: Path,
  ) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      resolve(item.dimensionRef, dimensions, [...path, i, "dimensionRef"]);
      if (seen.has(item.dimensionRef.id))
        add(
          "DUPLICATE_DIMENSION",
          [...path, i],
          "A dimension can occur only once in each vector.",
        );
      seen.add(item.dimensionRef.id);
    });
    if (
      seen.size !== dimensions.size ||
      [...dimensions.keys()].some((id) => !seen.has(id))
    )
      add(
        "INCOMPLETE_DIMENSION_VECTOR",
        path,
        "The vector must include every declared dimension exactly once.",
      );
  };
  content.questions.forEach((question, qi) => {
    index(
      question.options,
      ["questions", qi, "options"],
      content.contentVersion,
    );
    question.options.forEach((option, oi) => {
      if (options.has(option.id))
        add(
          "DUPLICATE_OPTION_ID",
          ["questions", qi, "options", oi, "id"],
          "Option IDs must be unique across questions.",
        );
      options.set(option.id, option);
      completeDimensions(option.contributions, [
        "questions",
        qi,
        "options",
        oi,
        "contributions",
      ]);
    });
  });
  completeDimensions(content.rules.normalization.bounds, [
    "rules",
    "normalization",
    "bounds",
  ]);
  content.rules.normalization.bounds.forEach((bound, i) => {
    const ranges = content.questions.map((question) =>
      question.options
        .map(
          (option) =>
            option.contributions.find(
              (item) => item.dimensionRef.id === bound.dimensionRef.id,
            )?.value,
        )
        .filter((value): value is number => value !== undefined),
    );
    const min = ranges.reduce(
      (sum, values) => sum + (values.length ? Math.min(...values) : 0),
      0,
    );
    const max = ranges.reduce(
      (sum, values) => sum + (values.length ? Math.max(...values) : 0),
      0,
    );
    if (bound.min >= bound.max || bound.min !== min || bound.max !== max)
      add(
        "INVALID_NORMALIZATION_BOUNDS",
        ["rules", "normalization", "bounds", i],
        "Normalization bounds must match the nonconstant attainable sum extrema.",
      );
  });
  const completeResults = (refs: readonly ContentReference[], path: Path) => {
    const seen = new Set<string>();
    refs.forEach((ref, i) => {
      resolve(ref, results, [...path, i]);
      if (seen.has(ref.id))
        add(
          "DUPLICATE_RESULT_REFERENCE",
          [...path, i],
          "Each result must occur once in this declaration.",
        );
      seen.add(ref.id);
    });
    if (
      seen.size !== results.size ||
      [...results.keys()].some((id) => !seen.has(id))
    )
      add(
        "INCOMPLETE_RESULT_COVERAGE",
        path,
        "Declaration must cover every result exactly once.",
      );
  };
  completeResults(content.rules.resultOrder, ["rules", "resultOrder"]);
  completeResults(
    content.rules.profiles.map((profile) => profile.resultRef),
    ["rules", "profiles"],
  );
  if (content.rules.kind === "archetype")
    content.rules.profiles.forEach((profile, i) =>
      completeDimensions(profile.targets, ["rules", "profiles", i, "targets"]),
    );
  else
    content.rules.profiles.forEach((profile, i) => {
      completeDimensions(profile.ranges, ["rules", "profiles", i, "ranges"]);
      profile.ranges.forEach((range, j) => {
        if (range.min > range.max)
          add(
            "INVALID_RESULT_RANGE",
            ["rules", "profiles", i, "ranges", j],
            "Result ranges must be ordered inclusive normalized bounds.",
          );
      });
    });
  const usedResources = new Set<string>();
  const useResource = (ref: ContentReference, path: Path) => {
    usedResources.add(ref.id);
    return resolve(ref, resources, path);
  };
  const usedReports = new Set<string>();
  content.results.forEach((result, ri) => {
    const portrait = useResource(result.portraitRef, [
      "results",
      ri,
      "portraitRef",
    ]);
    if (portrait && portrait.purpose !== "portrait")
      add(
        "RESOURCE_PURPOSE_MISMATCH",
        ["results", ri, "portraitRef"],
        "Result portraits require portrait resources.",
      );
    resolve(result.reportTemplateRef, reports, [
      "results",
      ri,
      "reportTemplateRef",
    ]);
    usedReports.add(result.reportTemplateRef.id);
    const answered = new Set<string>();
    result.witness.answers.forEach((answer, ai) => {
      const path: Path = ["results", ri, "witness", "answers", ai];
      const question = resolve(answer.questionRef, questions, [
        ...path,
        "questionRef",
      ]);
      resolve(answer.optionRef, options, [...path, "optionRef"]);
      if (
        question &&
        !question.options.some((option) => option.id === answer.optionRef.id)
      )
        add(
          "OPTION_QUESTION_MISMATCH",
          [...path, "optionRef"],
          "Witness option must belong to its referenced question.",
        );
      if (answered.has(answer.questionRef.id))
        add(
          "DUPLICATE_WITNESS_ANSWER",
          path,
          "Witness must answer each question once.",
        );
      answered.add(answer.questionRef.id);
    });
    if (
      answered.size !== questions.size ||
      [...questions.keys()].some((id) => !answered.has(id))
    )
      add(
        "INCOMPLETE_WITNESS",
        ["results", ri, "witness"],
        "Witness must contain one answer for every question.",
      );
  });
  const usedComponents = new Set<string>();
  const manifestComponents = new Map<string, string>();
  manifest.components.forEach((component, i) => {
    if (manifestComponents.has(component.id))
      add(
        "DUPLICATE_COMPONENT",
        ["components", i],
        "Manifest component IDs must be unique.",
      );
    manifestComponents.set(component.id, componentKey(component));
  });
  const useComponent = (
    component: QuizPackManifest["components"][number],
    path: Path,
  ) => {
    usedComponents.add(componentKey(component));
    if (component.version !== content.componentVersion)
      add(
        "COMPONENT_VERSION_MISMATCH",
        path,
        "Component must use the pinned component version.",
      );
    if (manifestComponents.get(component.id) !== componentKey(component))
      add(
        "COMPONENT_DECLARATION_MISMATCH",
        path,
        "Component must match a manifest contract exactly.",
      );
  };
  Object.entries(content.layouts).forEach(([state, layout]) => {
    useComponent(layout.component, ["layouts", state, "component"]);
    const seen = new Set<string>();
    layout.resourceRefs.forEach((ref, i) => {
      const resource = useResource(ref, ["layouts", state, "resourceRefs", i]);
      if (seen.has(ref.id))
        add(
          "DUPLICATE_RESOURCE_REFERENCE",
          ["layouts", state, "resourceRefs", i],
          "Layout resource references must be unique.",
        );
      seen.add(ref.id);
      if (state === "cover" && resource?.purpose === "portrait")
        add(
          "RESOURCE_PURPOSE_MISMATCH",
          ["layouts", state, "resourceRefs", i],
          "Cover must use a neutral cover or decoration resource.",
        );
    });
  });
  content.reportTemplates.forEach((report, i) => {
    useComponent(report.component, ["reportTemplates", i, "component"]);
    if (!usedReports.has(report.id))
      add(
        "UNUSED_REPORT_TEMPLATE",
        ["reportTemplates", i],
        "Each report template must be referenced by a result.",
      );
  });
  manifest.components.forEach((component, i) => {
    if (!usedComponents.has(componentKey(component)))
      add(
        "UNUSED_COMPONENT",
        ["components", i],
        "Manifest must list only used component contracts.",
      );
  });
  const files = new Map<string, QuizPackManifest["files"][number]>();
  manifest.files.forEach((file, i) => {
    if (files.has(file.path))
      add(
        "DUPLICATE_MANIFEST_PATH",
        ["files", i],
        "Manifest file paths must be unique.",
      );
    files.set(file.path, file);
    if (
      file.path === "content.json" &&
      (file.mediaType !== "application/json" ||
        file.bytes > PACK_LIMITS.contentBytes)
    )
      add(
        "CONTENT_FILE_DECLARATION",
        ["files", i],
        "Content file must have its JSON type and byte limit.",
      );
    if (
      file.path !== "content.json" &&
      (file.mediaType === "application/json" ||
        !file.path.endsWith(`.${mimeExtension[file.mediaType]}`))
    )
      add(
        "FILE_MEDIA_TYPE_MISMATCH",
        ["files", i],
        "Asset extension and declared media type must agree.",
      );
  });
  if (!files.has("content.json"))
    add(
      "MISSING_CONTENT_FILE",
      ["files"],
      "Manifest must declare content.json exactly once.",
    );
  const resourcePaths = new Set<string>();
  content.resources.forEach((resource, i) => {
    const path: Path = ["resources", i];
    if (
      resource.path !==
      `assets/${resource.id}.${mimeExtension[resource.mediaType]}`
    )
      add(
        "RESOURCE_PATH_MISMATCH",
        [...path, "path"],
        "Resource path must match its ID and format.",
      );
    if (resourcePaths.has(resource.path))
      add(
        "DUPLICATE_RESOURCE_PATH",
        [...path, "path"],
        "Resources must use distinct file paths.",
      );
    resourcePaths.add(resource.path);
    const file = files.get(resource.path);
    if (
      !file ||
      file.bytes !== resource.bytes ||
      file.sha256 !== resource.sha256 ||
      file.mediaType !== resource.mediaType
    )
      add(
        "RESOURCE_FILE_DECLARATION_MISMATCH",
        path,
        "Resource must match its manifest file declaration exactly.",
      );
    if (resource.width * resource.height > PACK_LIMITS.imagePixels)
      add("IMAGE_PIXEL_LIMIT", path, "Declared image exceeds the pixel limit.");
    if (!usedResources.has(resource.id))
      add("UNUSED_RESOURCE", path, "Each resource must have a declared use.");
  });
  manifest.files.forEach((file, i) => {
    if (file.path !== "content.json" && !resourcePaths.has(file.path))
      add(
        "UNDECLARED_RESOURCE_FILE",
        ["files", i],
        "Every asset file must be declared as a Product resource.",
      );
  });
  return issues;
}
