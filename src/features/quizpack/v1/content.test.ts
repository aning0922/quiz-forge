import { beforeAll, describe, expect, it } from "vitest";
import {
  checkCompatibility,
  DEFAULT_COMPATIBILITY_POLICY,
} from "./compatibility";
import { getQuizPackContentJsonSchema, parseQuizPackContent } from "./content";
import {
  createSyntheticFixture,
  type SyntheticFixture,
} from "./fixtures/synthetic";
import {
  getQuizPackManifestJsonSchema,
  parseQuizPackManifest,
} from "./manifest";
import { validateContentReferences } from "./references";

let fixture: SyntheticFixture;
beforeAll(async () => {
  fixture = await createSyntheticFixture();
});
const copy = () => structuredClone(fixture);
const codes = (value: SyntheticFixture) =>
  validateContentReferences(
    value.manifest,
    value.content,
    value.content.product.productId,
  ).map((issue) => issue.code);

describe("P1 strict content and manifest", () => {
  it.each(["dimensions", "archetype"] as const)(
    "accepts independent %s fixture declarations",
    async (engine) => {
      const value = await createSyntheticFixture(engine);
      expect(parseQuizPackContent(value.content).ok).toBe(true);
      expect(parseQuizPackManifest(value.manifest).ok).toBe(true);
      expect(codes(value)).toEqual([]);
      expect(
        checkCompatibility(value.manifest, DEFAULT_COMPATIBILITY_POLICY),
      ).toEqual([]);
      expect(
        value.content.resources.every(
          (resource) => resource.approval === "pending",
        ),
      ).toBe(true);
    },
  );
  it("exports strict JSON schemas without executable or open props", () => {
    expect(getQuizPackContentJsonSchema().additionalProperties).toBe(false);
    expect(getQuizPackManifestJsonSchema().additionalProperties).toBe(false);
  });
  it.each([
    (value: SyntheticFixture) => ({ ...value.content, executable: "code" }),
    (value: SyntheticFixture) => ({
      ...value.content,
      schemaVersion: "foundation.v1",
    }),
    (value: SyntheticFixture) => {
      value.content.reportTemplates[0]!.mode = "AI_ENHANCED" as never;
      return value.content;
    },
    (value: SyntheticFixture) => {
      delete (
        value.content.reportTemplates[0]!.baseline as Partial<
          (typeof value.content.reportTemplates)[0]["baseline"]
        >
      ).summary;
      return value.content;
    },
    (value: SyntheticFixture) => {
      value.content.layouts.cover.props = {
        ...value.content.layouts.cover.props,
        html: "markup",
      } as never;
      return value.content;
    },
    (value: SyntheticFixture) => {
      value.content.product.title = "<script>alert(1)</script>";
      return value.content;
    },
    (value: SyntheticFixture) => {
      value.content.product.title = "https://remote.invalid/asset";
      return value.content;
    },
    (value: SyntheticFixture) => {
      value.content.resources[0]!.path = "assets/font.woff2";
      return value.content;
    },
    (value: SyntheticFixture) => {
      value.content.resources[0]!.license.commercialUse = false as never;
      return value.content;
    },
    (value: SyntheticFixture) => {
      value.content.questions[0]!.options[0]!.contributions[0]!.value = 1.5;
      return value.content;
    },
    (value: SyntheticFixture) => {
      value.content.rules = {
        ...value.content.rules,
        expression: "eval(1)",
      } as never;
      return value.content;
    },
  ])("rejects unsupported or unsafe content case %#", (mutate) => {
    expect(parseQuizPackContent(mutate(copy())).ok).toBe(false);
  });
  it.each([
    "assets/../image.png",
    "assets/Image.png",
    "assets/image.jpeg",
    "assets/image%2e.png",
    "assets/image.svg",
    "manifest.json",
  ])("rejects manifest path %s", (path) => {
    const value = copy();
    value.manifest.files[1]!.path = path;
    expect(parseQuizPackManifest(value.manifest).ok).toBe(false);
  });
  it("never echoes attacker text in issues", () => {
    const value = copy();
    value.content.product.title = "<SECRET-MARKER>";
    const parsed = parseQuizPackContent(value.content);
    expect(JSON.stringify(parsed)).not.toContain("SECRET-MARKER");
  });
});

describe("exact Product, version, namespace and closed declarations", () => {
  it.each([
    [
      "TARGET_PRODUCT_MISMATCH",
      (v: SyntheticFixture) => {
        v.manifest.productId = "foreign";
      },
    ],
    [
      "CONTENT_DECLARATION_MISMATCH",
      (v: SyntheticFixture) => {
        v.manifest.engine.id = "dimensions";
      },
    ],
    [
      "FOREIGN_OWNER",
      (v: SyntheticFixture) => {
        v.content.resources[0]!.productId = "foreign";
      },
    ],
    [
      "DEFINITION_VERSION_MISMATCH",
      (v: SyntheticFixture) => {
        v.content.dimensions[0]!.version = "2.0.0";
      },
    ],
    [
      "REFERENCE_VERSION_OR_OWNER_MISMATCH",
      (v: SyntheticFixture) => {
        v.content.results[0]!.portraitRef.version = "2.0.0";
      },
    ],
    [
      "DUPLICATE_ID",
      (v: SyntheticFixture) => {
        v.content.results.push(v.content.results[0]!);
      },
    ],
    [
      "DUPLICATE_OPTION_ID",
      (v: SyntheticFixture) => {
        v.content.questions[1]!.options[0]!.id =
          v.content.questions[0]!.options[0]!.id;
      },
    ],
    [
      "INCOMPLETE_DIMENSION_VECTOR",
      (v: SyntheticFixture) => {
        v.content.questions[0]!.options[0]!.contributions.pop();
      },
    ],
    [
      "DUPLICATE_DIMENSION",
      (v: SyntheticFixture) => {
        v.content.questions[0]!.options[0]!.contributions.push(
          v.content.questions[0]!.options[0]!.contributions[0]!,
        );
      },
    ],
    [
      "INVALID_NORMALIZATION_BOUNDS",
      (v: SyntheticFixture) => {
        v.content.rules.normalization.bounds[0]!.max = 3;
      },
    ],
    [
      "INCOMPLETE_RESULT_COVERAGE",
      (v: SyntheticFixture) => {
        v.content.rules.profiles.pop();
      },
    ],
    [
      "DUPLICATE_RESULT_REFERENCE",
      (v: SyntheticFixture) => {
        v.content.rules.resultOrder[1] = v.content.rules.resultOrder[0]!;
      },
    ],
    [
      "INCOMPLETE_WITNESS",
      (v: SyntheticFixture) => {
        v.content.results[0]!.witness.answers.pop();
      },
    ],
    [
      "DUPLICATE_WITNESS_ANSWER",
      (v: SyntheticFixture) => {
        v.content.results[0]!.witness.answers.push(
          v.content.results[0]!.witness.answers[0]!,
        );
      },
    ],
    [
      "OPTION_QUESTION_MISMATCH",
      (v: SyntheticFixture) => {
        v.content.results[0]!.witness.answers[0]!.optionRef =
          v.content.questions[1]!.options[0]!;
      },
    ],
    [
      "RESOURCE_PURPOSE_MISMATCH",
      (v: SyntheticFixture) => {
        v.content.results[0]!.portraitRef = v.content.resources[0]!;
      },
    ],
    [
      "COMPONENT_DECLARATION_MISMATCH",
      (v: SyntheticFixture) => {
        v.content.layouts.cover.component.propsSchemaVersion = "2.0.0";
      },
    ],
    [
      "COMPONENT_VERSION_MISMATCH",
      (v: SyntheticFixture) => {
        v.content.layouts.cover.component.version = "2.0.0";
      },
    ],
    [
      "UNUSED_COMPONENT",
      (v: SyntheticFixture) => {
        v.manifest.components.push({
          id: "unknown",
          version: "1.0.0",
          propsSchemaVersion: "1.0.0",
        });
      },
    ],
    [
      "DUPLICATE_COMPONENT",
      (v: SyntheticFixture) => {
        v.manifest.components.push(v.manifest.components[0]!);
      },
    ],
    [
      "DUPLICATE_MANIFEST_PATH",
      (v: SyntheticFixture) => {
        v.manifest.files.push(v.manifest.files[0]!);
      },
    ],
    [
      "MISSING_CONTENT_FILE",
      (v: SyntheticFixture) => {
        v.manifest.files.shift();
      },
    ],
    [
      "RESOURCE_FILE_DECLARATION_MISMATCH",
      (v: SyntheticFixture) => {
        v.manifest.files[1]!.sha256 = "0".repeat(64);
      },
    ],
    [
      "UNDECLARED_RESOURCE_FILE",
      (v: SyntheticFixture) => {
        v.manifest.files.push({
          ...v.manifest.files[1]!,
          path: "assets/extra.png",
        });
      },
    ],
    [
      "RESOURCE_PATH_MISMATCH",
      (v: SyntheticFixture) => {
        v.content.resources[0]!.path = "assets/other.png";
      },
    ],
    [
      "FILE_MEDIA_TYPE_MISMATCH",
      (v: SyntheticFixture) => {
        v.manifest.files[1]!.mediaType = "image/webp";
      },
    ],
    [
      "IMAGE_PIXEL_LIMIT",
      (v: SyntheticFixture) => {
        v.content.resources[0]!.width = 8192;
        v.content.resources[0]!.height = 8192;
      },
    ],
  ] as const)("rejects %s", (code, mutate) => {
    const value = copy();
    mutate(value);
    expect(codes(value)).toContain(code);
  });
  it("rejects foreign target independently of package agreement", () => {
    expect(
      validateContentReferences(
        fixture.manifest,
        fixture.content,
        "foreign",
      ).map((issue) => issue.code),
    ).toContain("TARGET_PRODUCT_MISMATCH");
  });
  it("rejects incomplete archetype targets and invalid dimension ranges", async () => {
    const a = copy();
    if (a.content.rules.kind === "archetype")
      a.content.rules.profiles[0]!.targets.pop();
    expect(codes(a)).toContain("INCOMPLETE_DIMENSION_VECTOR");
    const d = await createSyntheticFixture("dimensions");
    if (d.content.rules.kind === "dimensions")
      d.content.rules.profiles[0]!.ranges[0]!.min = 50;
    expect(codes(d)).toContain("INVALID_RESULT_RANGE");
  });
  it.each(["contentSchemaVersions", "engines", "components"] as const)(
    "requires trusted %s compatibility",
    (key) => {
      const policy = { ...DEFAULT_COMPATIBILITY_POLICY, [key]: [] };
      expect(
        checkCompatibility(fixture.manifest, policy).length,
      ).toBeGreaterThan(0);
    },
  );
});

describe("finite P1 component state capabilities", () => {
  it.each([
    "cover",
    "question",
    "resume",
    "result",
    "report",
    "poster",
  ] as const)("rejects known but wrong component in %s", (state) => {
    const value = copy();
    const other = state === "result" ? "cover" : "result";
    value.content.layouts[state].component =
      value.content.layouts[other].component;
    expect(codes(value)).toContain("COMPONENT_STATE_MISMATCH");
    expect(
      checkCompatibility(value.manifest, DEFAULT_COMPATIBILITY_POLICY),
    ).toEqual([]);
  });
  it("rejects a report template using a known cover component", () => {
    const value = copy();
    value.content.reportTemplates[0]!.component =
      value.content.layouts.cover.component;
    expect(codes(value)).toContain("COMPONENT_STATE_MISMATCH");
  });
  it("rejects wrong state version even if manifest/policy both allow it", () => {
    const value = copy();
    value.content.layouts.cover.component = {
      ...value.content.layouts.cover.component,
      propsSchemaVersion: "2.0.0",
    };
    value.manifest.components[0] = value.content.layouts.cover.component;
    expect(codes(value)).toContain("COMPONENT_STATE_MISMATCH");
    const policy = {
      ...DEFAULT_COMPATIBILITY_POLICY,
      components: value.manifest.components,
    };
    expect(checkCompatibility(value.manifest, policy)).toEqual([]);
  });
});

describe("structural production bounds", () => {
  it.each([
    ["questions", 100],
    ["dimensions", 16],
    ["results", 32],
    ["resources", 64],
  ] as const)(
    "accepts exact %s structure bound and rejects one more",
    (key, limit) => {
      const value = copy();
      const item = value.content[key][0]!;
      Object.assign(value.content, {
        [key]: Array.from({ length: limit }, () => structuredClone(item)),
      });
      expect(parseQuizPackContent(value.content).ok).toBe(true);
      Object.assign(value.content, {
        [key]: Array.from({ length: limit + 1 }, () => structuredClone(item)),
      });
      expect(parseQuizPackContent(value.content).ok).toBe(false);
    },
  );
  it("bounds options and contribution integers at both ends", () => {
    const value = copy();
    const option = value.content.questions[0]!.options[0]!;
    value.content.questions[0]!.options = Array.from({ length: 8 }, () =>
      structuredClone(option),
    );
    value.content.questions[0]!.options[0]!.contributions[0]!.value = -100;
    value.content.questions[0]!.options[1]!.contributions[0]!.value = 100;
    expect(parseQuizPackContent(value.content).ok).toBe(true);
    value.content.questions[0]!.options[0]!.contributions[0]!.value = -101;
    expect(parseQuizPackContent(value.content).ok).toBe(false);
    value.content.questions[0]!.options[0]!.contributions[0]!.value = 101;
    expect(parseQuizPackContent(value.content).ok).toBe(false);
    value.content.questions[0]!.options[0]!.contributions[0]!.value = 0;
    value.content.questions[0]!.options.push(structuredClone(option));
    expect(parseQuizPackContent(value.content).ok).toBe(false);
  });
  it("requires positive image dimensions, bounded resource bytes and lowercase SHA", () => {
    const value = copy();
    value.content.resources[0]!.width = 0;
    expect(parseQuizPackContent(value.content).ok).toBe(false);
    value.content.resources[0]!.width = 8193;
    expect(parseQuizPackContent(value.content).ok).toBe(false);
    value.content.resources[0]!.width = 8;
    value.content.resources[0]!.bytes = 8 * 1024 * 1024 + 1;
    expect(parseQuizPackContent(value.content).ok).toBe(false);
    value.content.resources[0]!.bytes = 100;
    value.content.resources[0]!.sha256 = "A".repeat(64);
    expect(parseQuizPackContent(value.content).ok).toBe(false);
  });
});

it("rejects whitespace-only baseline and evidence while preserving valid text", () => {
  const value = copy();
  value.content.reportTemplates[0]!.baseline.summary = "  \n ";
  expect(parseQuizPackContent(value.content).ok).toBe(false);
  const source = copy();
  source.content.resources[0]!.source.evidence = " ";
  expect(parseQuizPackContent(source.content).ok).toBe(false);
  const padded = copy();
  padded.content.product.title = "  Synthetic title  ";
  const parsed = parseQuizPackContent(padded.content);
  expect(parsed.ok && parsed.value.product.title).toBe("  Synthetic title  ");
});

it("emits nonblank, local plain-text constraints in JSON Schema", () => {
  const productSchema = getQuizPackContentJsonSchema().properties?.product as {
    properties: {
      title: {
        minLength: number;
        maxLength: number;
        allOf: { pattern: string }[];
      };
    };
  };
  const title = productSchema.properties.title;
  expect(title.allOf).toHaveLength(3);
  for (const text of [
    "",
    "  \n ",
    "<html>",
    "HTTPS://remote.invalid",
    "JaVaScRiPt:code",
    "text\u0000",
    "  Valid text  ",
    "普通合成内容",
  ]) {
    const schemaAccepts =
      text.length >= title.minLength &&
      text.length <= title.maxLength &&
      title.allOf.every((rule) => new RegExp(rule.pattern).test(text));
    const value = copy();
    value.content.product.title = text;
    expect(schemaAccepts).toBe(parseQuizPackContent(value.content).ok);
  }
});
