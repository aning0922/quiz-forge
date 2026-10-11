import { describe, expect, it } from "vitest";
import fixture from "./fixtures/historical.foundation.json";
import {
  foundationBundleSchema,
  getFoundationJsonSchema,
  validateFoundationBundle,
  type FoundationBundle,
} from "./foundation";

const productId = "historical-synthetic";
const fresh = () => foundationBundleSchema.parse(structuredClone(fixture));
const validate = (input: unknown, target = productId) =>
  validateFoundationBundle(input, target);
const failReference = (
  mutate: (bundle: FoundationBundle) => void,
  code: string,
) => {
  const bundle = fresh();
  mutate(bundle);
  const result = validate(bundle);
  expect(result.structurallyValid).toBe(true);
  expect(result.referenceValid).toBe(false);
  expect(result.publishable).toBe(false);
  expect(result.issues.some((issue) => issue.code === code)).toBe(true);
};

/** A second independent synthetic workspace; no shared-resource exception. */
function secondProduct() {
  return JSON.parse(
    JSON.stringify(fixture).replaceAll(productId, "second-synthetic"),
  ) as FoundationBundle;
}

describe("foundation.v1 contract and isolation", () => {
  it("accepts the complete three-result fixture without granting execution or publication", () => {
    const before = structuredClone(fixture);
    const result = validate(fixture);
    expect(result).toMatchObject({
      structurallyValid: true,
      referenceValid: true,
      publishable: false,
      issues: [],
    });
    expect(fixture.results).toHaveLength(3);
    expect(Object.keys(fixture.layouts)).toEqual([
      "cover",
      "question",
      "resume",
      "result",
      "report",
      "poster",
    ]);
    expect(result.unverified).toEqual([
      "zip-container-and-extraction",
      "file-bytes-media-type-and-sha256",
      "scoring-and-witness-reachability",
      "component-registry-and-compatibility",
      "source-and-commercial-license-claims",
      "human-content-visual-and-resource-approval",
      "database-authorization-and-publication",
    ]);
    expect(fixture).toEqual(before);
  });

  it("accepts separate product-local bundles and rejects the wrong target", () => {
    expect(validate(secondProduct(), "second-synthetic").referenceValid).toBe(
      true,
    );
    for (const target of ["second-synthetic", "", " ../bad "]) {
      expect(validate(fixture, target)).toMatchObject({
        structurallyValid: true,
        referenceValid: false,
        publishable: false,
      });
    }
    expect(validate(secondProduct()).referenceValid).toBe(false);
  });

  it("rejects a foreign resource even when it claims approved commercial use", () => {
    failReference((bundle) => {
      bundle.resources[0] = secondProduct().resources[0]!;
      bundle.resources[0]!.licenseClaim.status = "approved";
      bundle.resources[0]!.licenseClaim.commercialUse = "claimed-permitted";
    }, "foreign_owner");
  });

  it.each([
    [
      "dimension",
      (b: FoundationBundle) => {
        b.dimensions[0]!.productId = "second-synthetic";
      },
    ],
    [
      "question",
      (b: FoundationBundle) => {
        b.questions[0]!.productId = "second-synthetic";
      },
    ],
    [
      "option",
      (b: FoundationBundle) => {
        b.questions[0]!.options[0]!.productId = "second-synthetic";
      },
    ],
    [
      "result",
      (b: FoundationBundle) => {
        b.results[0]!.productId = "second-synthetic";
      },
    ],
    [
      "component",
      (b: FoundationBundle) => {
        b.components[0]!.productId = "second-synthetic";
      },
    ],
    [
      "template",
      (b: FoundationBundle) => {
        b.reportTemplates[0]!.productId = "second-synthetic";
      },
    ],
  ])("rejects foreign %s definitions", (_name, mutate) => {
    failReference(mutate, "foreign_owner");
  });

  it("rejects references that falsely keep a local ID with foreign ownership", () => {
    failReference((bundle) => {
      bundle.results[0]!.portraitRef.productId = "second-synthetic";
    }, "foreign_reference");
  });

  it.each([
    [
      "dimension",
      (b: FoundationBundle) => {
        b.questions[0]!.options[0]!.effects[0]!.dimensionRef.id = "unknown";
      },
    ],
    [
      "result",
      (b: FoundationBundle) => {
        b.rules.resultOrder[0]!.id = "unknown";
      },
    ],
    [
      "portrait",
      (b: FoundationBundle) => {
        b.results[0]!.portraitRef.id = "unknown";
      },
    ],
    [
      "template",
      (b: FoundationBundle) => {
        b.results[0]!.reportTemplateRef.id = "unknown";
      },
    ],
    [
      "layout component",
      (b: FoundationBundle) => {
        b.layouts.resume.componentRef.id = "unknown";
      },
    ],
    [
      "template component",
      (b: FoundationBundle) => {
        b.reportTemplates[0]!.componentRef.id = "unknown";
      },
    ],
    [
      "layout resource",
      (b: FoundationBundle) => {
        b.layouts.cover.resourceRefs[0]!.id = "unknown";
      },
    ],
    [
      "witness question",
      (b: FoundationBundle) => {
        b.results[0]!.witness.answers[0]!.questionRef.id = "unknown";
      },
    ],
    [
      "witness option",
      (b: FoundationBundle) => {
        b.results[0]!.witness.answers[0]!.optionRef.id = "unknown";
      },
    ],
  ])("rejects dangling %s references", (_name, mutate) => {
    failReference(mutate, "unknown_reference");
  });

  it("pins definition, content and referenced versions", () => {
    failReference((b) => {
      b.questions[0]!.version = "2.0.0";
    }, "definition_version_mismatch");
    failReference((b) => {
      b.results[0]!.portraitRef.version = "2.0.0";
    }, "reference_version_mismatch");
    failReference((b) => {
      b.layouts.question.componentRef.version = "2.0.0";
    }, "reference_version_mismatch");
    const b = fresh();
    b.resources[0]!.version = "2.0.0";
    for (const layout of Object.values(b.layouts))
      layout.resourceRefs[0]!.version = "2.0.0";
    expect(validate(b).referenceValid).toBe(true);
  });

  it.each([
    [
      "dimensions",
      (b: FoundationBundle) => {
        b.dimensions.push(b.dimensions[0]!);
      },
    ],
    [
      "questions",
      (b: FoundationBundle) => {
        b.questions.push(b.questions[0]!);
      },
    ],
    [
      "results",
      (b: FoundationBundle) => {
        b.results[1]!.id = b.results[0]!.id;
      },
    ],
    [
      "resources",
      (b: FoundationBundle) => {
        b.resources.push(b.resources[0]!);
      },
    ],
    [
      "components",
      (b: FoundationBundle) => {
        b.components.push(b.components[0]!);
      },
    ],
    [
      "templates",
      (b: FoundationBundle) => {
        b.reportTemplates.push(b.reportTemplates[0]!);
      },
    ],
    [
      "local options",
      (b: FoundationBundle) => {
        b.questions[0]!.options.push(b.questions[0]!.options[0]!);
      },
    ],
    [
      "cross-question options",
      (b: FoundationBundle) => {
        b.questions[1]!.options[0]!.id = b.questions[0]!.options[0]!.id;
      },
    ],
    [
      "tags",
      (b: FoundationBundle) => {
        b.product.tags.push(b.product.tags[0]!);
      },
    ],
  ])("rejects duplicate %s IDs", (_name, mutate) => {
    failReference(mutate, "duplicate_id");
  });

  it("requires each rule profile and result order to cover each result exactly once", () => {
    failReference((b) => {
      b.rules.resultOrder[1] = b.rules.resultOrder[0]!;
    }, "missing_result");
    failReference((b) => {
      b.rules.profiles[1]!.resultRef = b.rules.profiles[0]!.resultRef;
    }, "duplicate_reference");
    failReference((b) => {
      b.rules.profiles[0]!.targets.push(b.rules.profiles[0]!.targets[0]!);
    }, "duplicate_reference");
    failReference((b) => {
      b.layouts.cover.resourceRefs.push(b.layouts.cover.resourceRefs[0]!);
    }, "duplicate_reference");
    failReference((b) => {
      b.questions[0]!.options[0]!.effects.push(
        b.questions[0]!.options[0]!.effects[0]!,
      );
    }, "duplicate_reference");
  });

  it("requires complete, nonduplicated witness answers with options from the correct question", () => {
    failReference((b) => {
      b.results[0]!.witness.answers.pop();
    }, "missing_answer");
    failReference((b) => {
      b.results[0]!.witness.answers.push(b.results[0]!.witness.answers[0]!);
    }, "duplicate_answer");
    failReference((b) => {
      b.results[0]!.witness.answers[0]!.optionRef =
        b.results[0]!.witness.answers[1]!.optionRef;
    }, "wrong_question_option");
  });

  it("rejects colliding paths, media/extension mismatch, and the wrong portrait purpose", () => {
    failReference((b) => {
      b.resources[1]!.path = b.resources[0]!.path;
    }, "duplicate_path");
    failReference((b) => {
      b.resources[0]!.mediaType = "image/jpeg";
    }, "resource_type_mismatch");
    failReference((b) => {
      b.resources[0]!.purpose = "font";
    }, "resource_type_mismatch");
    failReference((b) => {
      b.results[0]!.portraitRef.id = "neutral-cover";
    }, "resource_purpose_mismatch");
  });

  it("never trusts self-reported approval or mutates returned warning policy", () => {
    const b = fresh();
    b.resources.forEach((resource) => {
      resource.licenseClaim.status = "approved";
      resource.licenseClaim.commercialUse = "claimed-permitted";
    });
    const result = validate(b);
    expect(result.referenceValid).toBe(true);
    expect(result.publishable).toBe(false);
    result.unverified.length = 0;
    expect(validate(b).unverified.length).toBeGreaterThan(0);
  });
});

describe("foundation.v1 structural boundary", () => {
  it.each([
    "script",
    "html",
    "moduleUrl",
    "eval",
    "props",
    "__proto__",
    "constructor",
  ])(
    "rejects unknown execution field %s at root and nested objects without echoing it",
    (key) => {
      const marker = "PRIVATE-input-body";
      for (const place of ["root", "component", "baseline"]) {
        const b = structuredClone(fixture);
        const object =
          place === "root"
            ? b
            : place === "component"
              ? b.components[0]!
              : b.results[0]!.baseline;
        Object.defineProperty(object, key, { value: marker, enumerable: true });
        const result = validate(b);
        expect(result.structurallyValid).toBe(false);
        expect(result.referenceValid).toBe(false);
        expect(JSON.stringify(result)).not.toContain(marker);
        expect(JSON.stringify(result.issues)).not.toContain(key);
      }
    },
  );

  it.each([
    "../portrait.png",
    "assets/../portrait.png",
    "/portrait.png",
    "C:/portrait.png",
    "assets\\portrait.png",
    "assets//portrait.png",
    "assets/.hidden.png",
    "assets/a%2f..png",
    "assets/a.svg",
    "assets/a.js",
    "assets/a.PNG",
    "https://example.com/a.png",
  ])("rejects unsafe or unsupported asset path %s", (path) => {
    const b = fresh();
    b.resources[0]!.path = path;
    expect(validate(b).structurallyValid).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, 101, -101, 0.5])(
    "rejects illegal dimension value %s",
    (value) => {
      const b = fresh();
      b.questions[0]!.options[0]!.effects[0]!.value = value;
      expect(validate(b).structurallyValid).toBe(false);
    },
  );

  it.each([0, -1, Infinity, 0.1, 20 * 1024 * 1024 + 1])(
    "rejects illegal declared byte count %s",
    (bytes) => {
      const b = fresh();
      b.resources[0]!.bytes = bytes;
      expect(validate(b).structurallyValid).toBe(false);
    },
  );

  it.each([
    "1",
    "v1.0.0",
    "1.0.*",
    "^1.0.0",
    "01.0.0",
    "1.0.0-beta",
    "9999999.0.0",
  ])("rejects unpinned or unbounded version %s", (version) => {
    const b = fresh();
    b.contentVersion = version;
    expect(validate(b).structurallyValid).toBe(false);
  });

  it("rejects missing slots, wrong kinds/enums, empty/long text and oversized collections", () => {
    const missing = structuredClone(fixture) as Record<string, unknown>;
    delete (missing.layouts as Record<string, unknown>).resume;
    expect(validate(missing).structurallyValid).toBe(false);
    for (const title of [
      "",
      " \n\t ",
      "x".repeat(2001),
      "<script>run()</script>",
    ]) {
      const b = fresh();
      b.results[0]!.baseline.title = title;
      expect(validate(b).structurallyValid).toBe(false);
    }
    const incomplete = structuredClone(fixture);
    delete (
      incomplete.results[0]!.baseline as Partial<
        (typeof incomplete.results)[0]["baseline"]
      >
    ).disclaimer;
    expect(validate(incomplete).structurallyValid).toBe(false);
    for (const b of [
      { ...fixture, kind: "published" },
      { ...fixture, rules: { ...fixture.rules, declarationOnly: false } },
      { ...fixture, results: fixture.results.slice(0, 2) },
      {
        ...fixture,
        resources: Array.from({ length: 65 }, () => fixture.resources[0]),
      },
      {
        ...fixture,
        questions: Array.from({ length: 101 }, () => fixture.questions[0]),
      },
      {
        ...fixture,
        product: { ...fixture.product, productId: "x".repeat(65) },
      },
      {
        ...fixture,
        product: {
          ...fixture.product,
          tags: Array.from({ length: 13 }, () => "tag"),
        },
      },
    ])
      expect(validate(b).structurallyValid).toBe(false);
  });

  it("exposes a strict Draft 2020-12 schema with shape constraints at every object", () => {
    const schema = getFoundationJsonSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      const node = value as Record<string, unknown>;
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(node.properties).toBeDefined();
        expect(node.required).toEqual(Object.keys(node.properties as object));
      }
      if (node.type === "array") {
        expect(node.maxItems).toBeTypeOf("number");
        expect(node.items).toBeDefined();
      }
      if (node.type === "string" && !node.const && !node.enum) {
        expect(node.maxLength).toBeTypeOf("number");
        if (node.pattern) expect(node.pattern).toBeTypeOf("string");
        else {
          expect(node.allOf).toBeInstanceOf(Array);
          expect((node.allOf as { pattern: string }[]).length).toBeGreaterThan(
            0,
          );
          for (const constraint of node.allOf as { pattern: string }[])
            expect(constraint.pattern).toBeTypeOf("string");
        }
      }
      if (node.type === "integer") {
        expect(node.minimum).toBeTypeOf("number");
        expect(node.maximum).toBeTypeOf("number");
      }
      Object.values(node).forEach(walk);
    };
    walk(schema);
    expect(JSON.stringify(schema)).not.toContain("refine");
    expect(schema.properties?.results).toMatchObject({
      minItems: 3,
      maxItems: 3,
    });
    expect(schema.properties?.resources).toMatchObject({
      minItems: 1,
      maxItems: 64,
    });
  });
});
