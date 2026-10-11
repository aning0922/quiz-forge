import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalFoundationJson,
  cloneFoundationJson,
  FOUNDATION_JSON_MAX_BYTES,
  hashFoundationJson,
  parseFoundationJson,
  readFoundationJsonStream,
} from "./foundation-json";

describe("bounded ordinary foundation JSON", () => {
  it("sorts object keys lexically (including integer-like keys), preserving arrays", () => {
    const canonical = '{"10":3,"2":4,"a":[2,1],"z":{"a":null,"b":true}}';
    const input = { z: { b: true, a: null }, a: [2, 1], 2: 4, 10: 3 };
    expect(canonicalFoundationJson(input)).toBe(canonical);
    expect(hashFoundationJson(input)).toBe(
      createHash("sha256").update(canonical).digest("hex"),
    );
    expect(hashFoundationJson({ b: 2, a: 1 })).toBe(
      hashFoundationJson({ a: 1, b: 2 }),
    );
    expect(hashFoundationJson([1, 2])).not.toBe(hashFoundationJson([2, 1]));
    expect(hashFoundationJson(-0)).toBe(hashFoundationJson(0));
  });

  it("detaches every nested value and accepts null-prototype ordinary data", () => {
    const nested = { data: [1, { title: "synthetic" }] };
    const cloned = cloneFoundationJson(nested);
    expect(cloned).toEqual(nested);
    expect(cloned).not.toBe(nested);
    expect((cloned as typeof nested).data).not.toBe(nested.data);
    expect(
      canonicalFoundationJson(
        Object.assign(Object.create(null), { safe: true }),
      ),
    ).toBe('{"safe":true}');
  });

  it.each([
    undefined,
    NaN,
    Infinity,
    -Infinity,
    BigInt(1),
    new Date(),
    new Map(),
    () => 1,
    Symbol("synthetic"),
  ])("rejects non-JSON values", (value) => {
    expect(() => canonicalFoundationJson(value)).toThrow();
  });

  it("rejects accessors without executing them, sparse/exotic arrays, hidden and symbol keys", () => {
    let invoked = false;
    expect(() =>
      canonicalFoundationJson({
        get unsafe() {
          invoked = true;
          return 1;
        },
      }),
    ).toThrow();
    expect(invoked).toBe(false);
    expect(() => canonicalFoundationJson(new Array(2))).toThrow();
    expect(() =>
      canonicalFoundationJson(Object.assign([1], { extra: true })),
    ).toThrow();
    expect(() =>
      canonicalFoundationJson(
        Object.defineProperty({}, "hidden", { value: 1 }),
      ),
    ).toThrow();
    expect(() => canonicalFoundationJson({ [Symbol("key")]: 1 })).toThrow();
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(() => canonicalFoundationJson(cyclic)).toThrow();
  });

  it.each([
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"nested":{"id":1,"id":2}}',
  ])("rejects duplicate decoded object keys", (source) => {
    expect(() => parseFoundationJson(source)).toThrow();
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "rejects pollution key %s in parsing and object content",
    (key) => {
      expect(() => parseFoundationJson(`{"${key}":1}`)).toThrow();
      expect(() => canonicalFoundationJson({ [key]: 1 })).toThrow();
    },
  );

  it.each([
    "",
    " ",
    "{}{}",
    "[1,]",
    '{"a":1,}',
    '{"a" 1}',
    "01",
    "+1",
    "1e999",
    "NaN",
    '"unterminated',
    '"bad\\xescape"',
    '"literal\nnewline"',
    "/*comment*/{}",
  ])("rejects malformed/nonfinite input without echo", (source) => {
    expect(() => parseFoundationJson(source)).toThrow("JSON input rejected.");
  });

  it("parses string escapes, JSON primitives and safe prototype-like property names", () => {
    const source =
      ' {"safe":"brace } and \\\" quote", "toString": [true, false, null, -1.25e2]} \n';
    expect(parseFoundationJson(source)).toEqual(JSON.parse(source));
  });

  it("accepts 32 nested containers and rejects the 33rd both in text and in-memory", () => {
    const source = "[".repeat(32) + "0" + "]".repeat(32);
    expect(parseFoundationJson(source)).toEqual(JSON.parse(source));
    expect(() => parseFoundationJson("[" + source + "]")).toThrow();
    expect(canonicalFoundationJson(JSON.parse(source))).toBe(source);
    expect(() =>
      canonicalFoundationJson(JSON.parse("[" + source + "]")),
    ).toThrow();
  });

  it("limits UTF-8 bytes including canonical punctuation and escaping", () => {
    const exact = '"' + "a".repeat(FOUNDATION_JSON_MAX_BYTES - 2) + '"';
    expect(parseFoundationJson(exact)).toHaveLength(
      FOUNDATION_JSON_MAX_BYTES - 2,
    );
    expect(canonicalFoundationJson(JSON.parse(exact))).toBe(exact);
    expect(() => parseFoundationJson(exact + " ")).toThrow();
    expect(() =>
      canonicalFoundationJson("界".repeat(FOUNDATION_JSON_MAX_BYTES / 3)),
    ).toThrow();
    expect(() =>
      canonicalFoundationJson("\n".repeat(FOUNDATION_JSON_MAX_BYTES / 2)),
    ).toThrow();
  });

  it("stops an incremental stream immediately after exceeding the byte budget", async () => {
    let reachedTail = false;
    async function* oversized() {
      yield Buffer.alloc(FOUNDATION_JSON_MAX_BYTES, 32);
      yield Buffer.from(" ");
      reachedTail = true;
      yield Buffer.from("{}");
    }
    await expect(readFoundationJsonStream(oversized())).rejects.toThrow();
    expect(reachedTail).toBe(false);
    async function* splitUtf8() {
      const bytes = Buffer.from('"合成"');
      yield bytes.subarray(0, 2);
      yield bytes.subarray(2);
    }
    await expect(readFoundationJsonStream(splitUtf8())).resolves.toBe("合成");
    await expect(
      readFoundationJsonStream(
        (async function* () {
          yield Buffer.from([0xff]);
        })(),
      ),
    ).rejects.toThrow();
  });
});
