import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMediaCapability } from "./capability";
const capability = {
  schema: "quizpack-media-capability.v1",
  platform: "darwin-arm64",
  componentId: "a".repeat(64),
  deploymentId: "b".repeat(64),
  runtimeBundleHash: "c".repeat(64),
  limitsHash: "d".repeat(64),
  profileId: "e".repeat(64),
};
describe("private ordinary capability read", () => {
  let root: string, path: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "quizforge-synthetic-capability-"));
    const dir = join(root, "state");
    mkdirSync(dir, { mode: 0o700 });
    path = join(dir, "capability.json");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  function write(value: unknown) {
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  }
  it("requires strict bounded identity and owner-only file permissions", () => {
    write(capability);
    expect(readMediaCapability(path, () => {})).toEqual(capability);
    chmodSync(path, 0o644);
    expect(() => readMediaCapability(path, () => {})).toThrow();
  });
  it.each([
    { ...capability, skip: true },
    { ...capability, platform: "unknown" },
    { ...capability, deploymentId: "short" },
  ])("rejects unregistered capability fields and identities", (value) => {
    write(value);
    expect(() => readMediaCapability(path, () => {})).toThrow();
  });
  it("rejects duplicate JSON keys and oversized bytes", () => {
    writeFileSync(
      path,
      JSON.stringify(capability).replace(
        '"platform":"darwin-arm64"',
        '"platform":"linux-x64","platform":"darwin-arm64"',
      ),
      { mode: 0o600 },
    );
    expect(() => readMediaCapability(path, () => {})).toThrow();
    writeFileSync(path, Buffer.alloc(16 * 1024 + 1));
    expect(() => readMediaCapability(path, () => {})).toThrow();
  });
  it("preserves interruption rather than reading more or producing a binding", () => {
    write(capability);
    expect(() =>
      readMediaCapability(path, () => {
        throw new Error("SYNTHETIC_STOP");
      }),
    ).toThrow("SYNTHETIC_STOP");
  });
});
