import { beforeAll, describe, expect, it, vi } from "vitest";
import { createContentV2Fixture, asRef } from "./fixtures.test-support";
import {
  getContentJsonSchema,
  parseSupportedContent,
  validateSupportedContentReferences,
} from "./index";
import { quizPackContentV2Schema, type QuizPackContentV2 } from "./v2";
import { createSyntheticFixture } from "../v1/fixtures/synthetic";
import {
  getQuizPackContentJsonSchema,
  parseQuizPackContent,
} from "../v1/content";
import {
  checkCompatibility,
  DEFAULT_COMPATIBILITY_POLICY,
} from "../v1/compatibility";
import { canonicalP1Json } from "../v1/canonical";

let fixture: QuizPackContentV2;
beforeAll(async () => {
  fixture = await createContentV2Fixture();
});
const copy = () => structuredClone(fixture);
const codes = (content: unknown) =>
  validateSupportedContentReferences(content, fixture.product.productId).map(
    (issue) => issue.code,
  );

describe("explicit offline content dispatch", () => {
  it.each(["dimensions", "archetype"] as const)(
    "accepts v1 and v2 %s without widening old entry points",
    async (engine) => {
      const v1 = await createSyntheticFixture(engine),
        v2 = await createContentV2Fixture(engine);
      expect(parseSupportedContent(v1.content).ok).toBe(true);
      expect(parseSupportedContent(v2).ok).toBe(true);
      expect(
        validateSupportedContentReferences(
          v1.content,
          v1.content.product.productId,
        ),
      ).toEqual([]);
      expect(
        validateSupportedContentReferences(v2, v2.product.productId),
      ).toEqual([]);
      expect(parseQuizPackContent(v2).ok).toBe(false);
      expect(
        checkCompatibility(
          {
            ...v1.manifest,
            contentSchemaVersion: "quizpack-content.v2" as never,
          },
          DEFAULT_COMPATIBILITY_POLICY,
        ).map((i) => i.code),
      ).toContain("UNSUPPORTED_CONTENT_SCHEMA");
      expect(getContentJsonSchema("quizpack-content.v1")).toEqual(
        getQuizPackContentJsonSchema(),
      );
    },
  );
  it.each([undefined, "quizpack-content.v3", "v2", "foundation.v1"])(
    "rejects unknown version %s",
    (version) => {
      expect(
        parseSupportedContent({ ...copy(), schemaVersion: version }).ok,
      ).toBe(false);
      expect(() => getContentJsonSchema(version as never)).toThrow(
        "UNSUPPORTED_CONTENT_SCHEMA",
      );
    },
  );
  it("snapshots before access and rejects proxy/getter/symbol/sparse/cyclic/custom objects", () => {
    const getter = vi.fn(() => "quizpack-content.v2"),
      accessor = { ...copy() };
    Object.defineProperty(accessor, "schemaVersion", {
      get: getter,
      enumerable: true,
    });
    const traps = vi.fn(),
      proxy = new Proxy({}, { ownKeys: traps });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [
      accessor,
      proxy,
      { ...copy(), [Symbol()]: "hidden" },
      new Array(3),
      cycle,
      new Date(),
    ])
      expect(parseSupportedContent(value).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(traps).not.toHaveBeenCalled();
  });
  it("preserves text exactly and returns an isolated deeply frozen parsed snapshot", () => {
    const input = copy();
    input.visualPresentation.sections[0]!.name = "  e\u0301 😀\n";
    const parsed = parseSupportedContent(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(canonicalP1Json(parsed.value)).toBe(canonicalP1Json(input));
    expect(
      Object.isFrozen(parsed.value.questions[0]!.options[0]!.contributions),
    ).toBe(true);
    input.questions[0]!.prompt = "caller changed";
    expect(parsed.value.questions[0]!.prompt).not.toBe("caller changed");
  });
  it("rejects the ordinary-JSON content envelope above 2MiB before structural parsing", () => {
    const result = parseSupportedContent({
      ...copy(),
      extra: "x".repeat(2 * 1024 * 1024),
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues[0]!.code).toBe("CONTENT_INPUT_REJECTED");
  });
  it("caps public issues, marks truncation and never echoes unknown field names or values", () => {
    const value = copy();
    value.visualPresentation.questionFrames = Array.from(
      { length: 100 },
      () => ({ questionRef: {}, sectionId: "BAD-SECRET", caption: "<SECRET>" }),
    ) as never;
    const result = parseSupportedContent(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(32);
    expect(result.issues[31]!.code).toBe("ISSUES_TRUNCATED");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

type TextSchema = {
  minLength: number;
  maxLength: number;
  allOf: { pattern: string }[];
};
const textCases: { limit: number; path: (string | number)[] }[] = [
  { limit: 40, path: ["visualPresentation", "sections", 0, "name"] },
  { limit: 40, path: ["visualPresentation", "sections", 0, "chapter"] },
  { limit: 400, path: ["visualPresentation", "sections", 0, "introduction"] },
  { limit: 80, path: ["visualPresentation", "questionFrames", 0, "caption"] },
  {
    limit: 240,
    path: ["visualPresentation", "resourceDescriptions", 0, "alt"],
  },
  { limit: 80, path: ["reportPresentation", "resultCards", 0, "displayName"] },
  { limit: 120, path: ["reportPresentation", "resultCards", 0, "subtitle"] },
  {
    limit: 120,
    path: ["reportPresentation", "resultCards", 0, "posterLine", "text"],
  },
  {
    limit: 240,
    path: ["reportPresentation", "resultCards", 0, "posterDisclosure"],
  },
];
describe("v2 plain Unicode text and exported JSON Schema", () => {
  it.each([
    ["sections", 8],
    ["questionFrames", 100],
    ["resourceDescriptions", 64],
    ["resultCards", 32],
  ] as const)(
    "bounds %s without weakening the structural minimum",
    (field, maximum) => {
      const content = copy();
      const parent =
        field === "resultCards"
          ? content.reportPresentation
          : content.visualPresentation;
      const fields = parent as unknown as Record<string, unknown[]>;
      const item = fields[field]![0];
      for (const length of [0, maximum, maximum + 1]) {
        fields[field] = Array.from({ length }, () => structuredClone(item));
        expect(quizPackContentV2Schema.safeParse(content).success).toBe(
          length === maximum,
        );
      }
    },
  );
  it.each(textCases)(
    "enforces $limit code points at $path including non-BMP and final newline",
    ({ limit, path }) => {
      const root = getContentJsonSchema("quizpack-content.v2") as Record<
        string,
        unknown
      >;
      let node: Record<string, unknown> = root;
      for (const part of path)
        node =
          typeof part === "number"
            ? (node.items as Record<string, unknown>)
            : (node.properties as Record<string, Record<string, unknown>>)[
                part
              ]!;
      const schema = node as unknown as TextSchema;
      expect(schema.minLength).toBe(1);
      expect(schema.maxLength).toBe(limit);
      for (const text of [
        "",
        " \t\n",
        "<b>text</b>\n",
        "https:evil\n",
        "a\u0000\n",
        "\ud800",
        "a\udc00",
        "😀".repeat(limit),
        "😀".repeat(limit + 1),
        "a".repeat(limit - 1) + "\n",
        "a".repeat(limit) + "\n",
        " e\u0301 😀\n",
      ]) {
        const content = copy();
        let target: unknown = content;
        for (const part of path.slice(0, -1))
          target = (target as Record<string | number, unknown>)[part];
        (target as Record<string | number, unknown>)[path.at(-1)!] = text;
        const accepted = quizPackContentV2Schema.safeParse(content).success;
        const expected =
          ![
            "",
            " \t\n",
            "<b>text</b>\n",
            "https:evil\n",
            "a\u0000\n",
            "\ud800",
            "a\udc00",
          ].includes(text) && [...text].length <= limit;
        expect(accepted, JSON.stringify(text)).toBe(expected);
        for (const flags of ["", "u"]) {
          const schemaAccepts =
            [...text].length >= schema.minLength &&
            [...text].length <= schema.maxLength &&
            schema.allOf.every((rule) =>
              new RegExp(rule.pattern, flags).test(text),
            );
          expect(
            schemaAccepts,
            `schema flags=${flags} ${JSON.stringify(text)}`,
          ).toBe(accepted);
        }
      }
    },
  );
  it.each([
    (c: QuizPackContentV2) => {
      (
        c.visualPresentation.sections[0] as unknown as Record<string, unknown>
      ).html = "x";
    },
    (c: QuizPackContentV2) => {
      c.reportPresentation.resultCards[0]!.posterLine.kind =
        "classical" as never;
    },
    (c: QuizPackContentV2) => {
      c.layouts.question.component.id = "folio-cover";
    },
    (c: QuizPackContentV2) => {
      c.reportTemplates[0]!.component.version = "1.0.0" as never;
    },
  ])(
    "rejects unknown fields and unsupported component declarations %#",
    (mutate) => {
      const c = copy();
      mutate(c);
      expect(parseSupportedContent(c).ok).toBe(false);
    },
  );
  it("allows up to 64 v2 layout references, with v1 still limited to 16", async () => {
    const c = copy();
    c.layouts.question.resourceRefs = Array.from({ length: 64 }, () =>
      asRef(c.resources[0]!),
    );
    expect(quizPackContentV2Schema.safeParse(c).success).toBe(true);
    c.layouts.question.resourceRefs.push(asRef(c.resources[0]!));
    expect(quizPackContentV2Schema.safeParse(c).success).toBe(false);
    const { content: v1 } = await createSyntheticFixture();
    v1.layouts.question.resourceRefs = Array.from({ length: 17 }, () =>
      asRef(v1.resources[0]!),
    );
    expect(parseQuizPackContent(v1).ok).toBe(false);
  });
});

describe("exact v2 presentation graph", () => {
  it.each([
    [
      "QUESTION_FRAME_COVERAGE",
      (c: QuizPackContentV2) => {
        c.visualPresentation.questionFrames.pop();
      },
    ],
    [
      "QUESTION_FRAME_ORDER_OR_REFERENCE",
      (c: QuizPackContentV2) => {
        c.visualPresentation.questionFrames.reverse();
      },
    ],
    [
      "QUESTION_FRAME_ORDER_OR_REFERENCE",
      (c: QuizPackContentV2) => {
        c.visualPresentation.questionFrames[0]!.questionRef.productId =
          "foreign";
      },
    ],
    [
      "DUPLICATE_SECTION_ID",
      (c: QuizPackContentV2) => {
        c.visualPresentation.sections.push(
          structuredClone(c.visualPresentation.sections[0]!),
        );
      },
    ],
    [
      "UNUSED_SECTION",
      (c: QuizPackContentV2) => {
        c.visualPresentation.sections.push({
          ...c.visualPresentation.sections[0]!,
          id: "unused-hall",
        });
      },
    ],
    [
      "UNKNOWN_SECTION_REFERENCE",
      (c: QuizPackContentV2) => {
        c.visualPresentation.questionFrames[0]!.sectionId = "unknown-hall";
      },
    ],
    [
      "RESOURCE_PURPOSE_MISMATCH",
      (c: QuizPackContentV2) => {
        c.visualPresentation.coverSceneRef = asRef(c.resources[1]!);
      },
    ],
    [
      "RESOURCE_PURPOSE_MISMATCH",
      (c: QuizPackContentV2) => {
        c.visualPresentation.sections[0]!.sceneRef = asRef(c.resources[0]!);
      },
    ],
    [
      "PRESENTATION_REFERENCE_MISMATCH",
      (c: QuizPackContentV2) => {
        c.visualPresentation.sections[0]!.sceneRef.version = "2.0.0";
      },
    ],
    [
      "PRESENTATION_REFERENCE_COVERAGE",
      (c: QuizPackContentV2) => {
        c.visualPresentation.resourceDescriptions.pop();
      },
    ],
    [
      "DUPLICATE_PRESENTATION_REFERENCE",
      (c: QuizPackContentV2) => {
        c.visualPresentation.resourceDescriptions.push(
          c.visualPresentation.resourceDescriptions[0]!,
        );
      },
    ],
    [
      "PRESENTATION_REFERENCE_MISMATCH",
      (c: QuizPackContentV2) => {
        c.visualPresentation.resourceDescriptions[0]!.resourceRef.productId =
          "foreign";
      },
    ],
    [
      "PRESENTATION_REFERENCE_COVERAGE",
      (c: QuizPackContentV2) => {
        c.reportPresentation.resultCards.pop();
      },
    ],
    [
      "DUPLICATE_PRESENTATION_REFERENCE",
      (c: QuizPackContentV2) => {
        c.reportPresentation.resultCards.push(
          c.reportPresentation.resultCards[0]!,
        );
      },
    ],
    [
      "PRESENTATION_REFERENCE_MISMATCH",
      (c: QuizPackContentV2) => {
        c.reportPresentation.resultCards[0]!.resultRef.version = "9.0.0";
      },
    ],
    [
      "PRESENTATION_REFERENCE_COVERAGE",
      (c: QuizPackContentV2) => {
        c.layouts.resume.resourceRefs.pop();
      },
    ],
    [
      "PRESENTATION_REFERENCE_MISMATCH",
      (c: QuizPackContentV2) => {
        c.layouts.question.resourceRefs.push(asRef(c.resources[1]!));
      },
    ],
    [
      "DUPLICATE_PRESENTATION_REFERENCE",
      (c: QuizPackContentV2) => {
        c.layouts.result.resourceRefs.push(c.layouts.result.resourceRefs[0]!);
      },
    ],
    [
      "PRESENTATION_REFERENCE_MISMATCH",
      (c: QuizPackContentV2) => {
        c.layouts.poster.resourceRefs.push(asRef(c.resources[0]!));
      },
    ],
    [
      "INCOMPLETE_DIMENSION_VECTOR",
      (c: QuizPackContentV2) => {
        c.questions[0]!.options[0]!.contributions.pop();
      },
    ],
    [
      "INVALID_NORMALIZATION_BOUNDS",
      (c: QuizPackContentV2) => {
        c.rules.normalization.bounds[0]!.max = 10;
      },
    ],
    [
      "OPTION_QUESTION_MISMATCH",
      (c: QuizPackContentV2) => {
        c.results[0]!.witness.answers[0]!.optionRef = asRef(
          c.questions[1]!.options[0]!,
        );
      },
    ],
  ] as const)("rejects %s %#", (expected, mutate) => {
    const c = copy();
    mutate(c);
    expect(codes(c)).toContain(expected);
  });
  it("uses explicit contiguous section order, permitting shared scene identity", () => {
    const c = copy();
    c.visualPresentation.sections.push({
      ...c.visualPresentation.sections[0]!,
      id: "second-hall",
    });
    c.visualPresentation.questionFrames[1]!.sectionId = "second-hall";
    expect(codes(c)).toEqual([]);
    c.visualPresentation.questionFrames.reverse();
    expect(codes(c)).toContain("NONCONTIGUOUS_SECTION_ORDER");
  });
  it("requires overrides in both question and resume, with exact neutral identity", () => {
    const c = copy(),
      scene = {
        ...c.resources.at(-1)!,
        id: "override-scene",
        path: "assets/override-scene.png",
      };
    c.resources.push(scene);
    c.visualPresentation.resourceDescriptions.push({
      resourceRef: asRef(scene),
      alt: "合成测试",
    });
    c.visualPresentation.questionFrames[0]!.sceneOverrideRef = asRef(scene);
    c.layouts.question.resourceRefs.push(asRef(scene));
    expect(codes(c)).toContain("PRESENTATION_REFERENCE_COVERAGE");
    c.layouts.resume.resourceRefs.push(asRef(scene));
    expect(codes(c)).toEqual([]);
  });
  it("alt declarations do not give unused resources an actual use", () => {
    const c = copy(),
      resource = {
        ...c.resources.at(-1)!,
        id: "unused-scene",
        path: "assets/unused-scene.png",
      };
    c.resources.push(resource);
    c.visualPresentation.resourceDescriptions.push({
      resourceRef: asRef(resource),
      alt: "有alt但未被使用",
    });
    expect(codes(c)).toContain("UNUSED_RESOURCE");
  });
  it("checks target Product without claiming file or renderer validation", () => {
    expect(
      validateSupportedContentReferences(copy(), "other-product").map(
        (i) => i.code,
      ),
    ).toContain("TARGET_PRODUCT_MISMATCH");
    expect(
      JSON.stringify(
        validateSupportedContentReferences(copy(), fixture.product.productId),
      ),
    ).not.toMatch(/candidateValid|renderReady/);
  });
});
