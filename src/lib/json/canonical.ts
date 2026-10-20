import { types } from "node:util";

export class CanonicalJsonError extends Error {
  constructor(public readonly code: string) {
    super("Canonical JSON rejected.");
  }
}

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

/** Snapshot ordinary JSON without evaluating accessors or accepting custom objects. */
export function canonicalOrdinaryJson(
  input: unknown,
  limits: Readonly<{ maxBytes: number; maxDepth: number }>,
): string {
  const { maxBytes: maximum, maxDepth } = limits;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 2 * 1024 * 1024 ||
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 1 ||
    maxDepth > 32
  )
    throw new CanonicalJsonError("JSON_INVALID_VALUE");
  const ancestors = new Set<object>();
  let bytes = 0;
  const fail = (code: string): never => {
    throw new CanonicalJsonError(code);
  };
  const account = (text: string): string => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > maximum) fail("JSON_SIZE_LIMIT");
    return text;
  };
  const walk = (value: unknown, depth: number): string => {
    if (value === null) return account("null");
    if (typeof value === "boolean") return account(String(value));
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("JSON_INVALID_VALUE");
      return account(JSON.stringify(value));
    }
    if (typeof value === "string") {
      if (value.length > maximum) fail("JSON_SIZE_LIMIT");
      return account(JSON.stringify(value));
    }
    if (typeof value !== "object") return fail("JSON_INVALID_VALUE");
    if (types.isProxy(value)) fail("JSON_INVALID_VALUE");
    if (depth >= maxDepth) fail("JSON_DEPTH_LIMIT");
    if (ancestors.has(value)) fail("JSON_CYCLE");
    ancestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) fail("JSON_INVALID_VALUE");
    let result: string;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype)
        fail("JSON_INVALID_VALUE");
      if (Object.keys(descriptors).length !== value.length + 1)
        fail("JSON_INVALID_VALUE");
      const entries: string[] = [];
      account("[]");
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          fail("JSON_INVALID_VALUE");
        if (index) account(",");
        entries.push(walk(descriptor!.value, depth + 1));
      }
      result = `[${entries.join(",")}]`;
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        fail("JSON_INVALID_VALUE");
      account("{}");
      const entries: string[] = [];
      for (const key of Object.keys(descriptors).sort()) {
        if (forbiddenKeys.has(key)) fail("JSON_FORBIDDEN_KEY");
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || !descriptor.enumerable)
          fail("JSON_INVALID_VALUE");
        if (entries.length) account(",");
        entries.push(
          `${account(JSON.stringify(key))}${account(":")}${walk(descriptor.value, depth + 1)}`,
        );
      }
      result = `{${entries.join(",")}}`;
    }
    ancestors.delete(value);
    return result;
  };
  return walk(input, 0);
}
