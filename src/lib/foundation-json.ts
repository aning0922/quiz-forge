import { createHash } from "node:crypto";
import { types } from "node:util";

export const FOUNDATION_JSON_MAX_BYTES = 1024 * 1024;
export const FOUNDATION_JSON_MAX_DEPTH = 32;
export type FoundationJson =
  | null
  | boolean
  | number
  | string
  | FoundationJson[]
  | { [key: string]: FoundationJson };

export class FoundationJsonError extends Error {
  constructor(public readonly code: string) {
    super("JSON input rejected.");
    this.name = "FoundationJsonError";
  }
}

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const fail = (code: string): never => {
  throw new FoundationJsonError(code);
};

/** Ordinary JSON only. Accessors, exotic objects, holes and shared cycles are rejected. */
export function canonicalFoundationJson(input: unknown): string {
  const ancestors = new Set<object>();
  let bytes = 0;
  const account = (value: string) => {
    bytes += Buffer.byteLength(value, "utf8");
    if (bytes > FOUNDATION_JSON_MAX_BYTES) fail("JSON_SIZE_LIMIT");
    return value;
  };
  const walk = (value: unknown, depth: number): string => {
    if (value === null) return account("null");
    if (typeof value === "boolean") return account(String(value));
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("JSON_INVALID_VALUE");
      return account(JSON.stringify(value));
    }
    if (typeof value === "string") {
      if (value.length > FOUNDATION_JSON_MAX_BYTES) fail("JSON_SIZE_LIMIT");
      return account(JSON.stringify(value));
    }
    if (typeof value !== "object") return fail("JSON_INVALID_VALUE");
    if (types.isProxy(value)) fail("JSON_INVALID_VALUE");
    if (depth >= FOUNDATION_JSON_MAX_DEPTH) fail("JSON_DEPTH_LIMIT");
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

export function cloneFoundationJson(input: unknown): FoundationJson {
  return JSON.parse(canonicalFoundationJson(input)) as FoundationJson;
}

export function hashFoundationJson(input: unknown): string {
  return createHash("sha256")
    .update(canonicalFoundationJson(input), "utf8")
    .digest("hex");
}

/** Parse before JSON.parse can erase duplicate keys; messages never contain source text. */
export function parseFoundationJson(source: string): FoundationJson {
  if (Buffer.byteLength(source, "utf8") > FOUNDATION_JSON_MAX_BYTES)
    fail("JSON_SIZE_LIMIT");
  let cursor = 0;
  const whitespace = () => {
    while (/[\x20\x09\x0a\x0d]/.test(source[cursor] ?? "!")) cursor++;
  };
  const string = (): string => {
    const start = cursor++;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === '"') {
        try {
          return JSON.parse(source.slice(start, cursor)) as string;
        } catch {
          return fail("JSON_SYNTAX");
        }
      }
      if (character === "\\") cursor++;
    }
    return fail("JSON_SYNTAX");
  };
  const value = (depth: number): FoundationJson => {
    whitespace();
    const character = source[cursor];
    if (character === '"') return string();
    if (character === "{" || character === "[") {
      if (depth >= FOUNDATION_JSON_MAX_DEPTH) fail("JSON_DEPTH_LIMIT");
      cursor++;
      whitespace();
      const object = character === "{";
      const close = object ? "}" : "]";
      const entries: FoundationJson[] = [];
      const record: { [key: string]: FoundationJson } = {};
      const keys = new Set<string>();
      if (source[cursor] === close) {
        cursor++;
        return object ? record : entries;
      }
      while (true) {
        whitespace();
        if (object) {
          if (source[cursor] !== '"') fail("JSON_SYNTAX");
          const key = string();
          if (forbiddenKeys.has(key)) fail("JSON_FORBIDDEN_KEY");
          if (keys.has(key)) fail("JSON_DUPLICATE_KEY");
          keys.add(key);
          whitespace();
          if (source[cursor++] !== ":") fail("JSON_SYNTAX");
          record[key] = value(depth + 1);
        } else entries.push(value(depth + 1));
        whitespace();
        if (source[cursor] === close) {
          cursor++;
          return object ? record : entries;
        }
        if (source[cursor++] !== ",") fail("JSON_SYNTAX");
      }
    }
    for (const [token, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (source.startsWith(token, cursor)) {
        cursor += token.length;
        return result;
      }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      source.slice(cursor),
    );
    if (!match) return fail("JSON_SYNTAX");
    cursor += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("JSON_INVALID_VALUE");
    return number;
  };
  const parsed = value(0);
  whitespace();
  if (cursor !== source.length) fail("JSON_SYNTAX");
  return parsed;
}

/** Stop reading as soon as the byte budget is exceeded, including stdin streams. */
export async function readFoundationJsonStream(
  stream: AsyncIterable<Uint8Array>,
): Promise<FoundationJson> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > FOUNDATION_JSON_MAX_BYTES) fail("JSON_SIZE_LIMIT");
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks, bytes);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer,
    );
  } catch {
    return fail("JSON_ENCODING");
  }
  return parseFoundationJson(source);
}
