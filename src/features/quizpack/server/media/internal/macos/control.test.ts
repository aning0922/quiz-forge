import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMacControl } from "./control";
describe("Mac fixed control lifecycle", () => {
  let root: string;
  let path: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "quizforge-synthetic-control-"));
    path = join(root, ".cache/media/control");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const runId = "626e311b-4211-4f35-b874-a39d801b2df6";
  const profileId = "a".repeat(64);
  it("persists issued facts and removes only its exact known control objects", () => {
    const control = createMacControl({ checkoutRoot: root, controlRoot: path });
    const owned = control.acquireControl(runId, profileId);
    owned.update("issued");
    expect(control.readControlForHarness()).toMatchObject({
      phase: "issued",
      runId,
      profileId,
    });
    owned.update("spawned", 123, { sec: 1, usec: 2 });
    owned.finish();
    expect(readdirSync(path)).toEqual([]);
  });
  it("unknown facts block a new invocation and remain intact", () => {
    const control = createMacControl({ checkoutRoot: root, controlRoot: path });
    control.acquireControl(runId, profileId).update("unknown");
    const before = readFileSync(join(path, "active.json"));
    expect(() => control.acquireControl(runId, profileId)).toThrow("BUSY");
    expect(readFileSync(join(path, "active.json"))).toEqual(before);
  });
  it("replacement state cannot be cleared by the original owner", () => {
    const control = createMacControl({ checkoutRoot: root, controlRoot: path });
    const owned = control.acquireControl(runId, profileId);
    const record = control.readControlForHarness();
    writeFileSync(
      join(path, "active.json"),
      JSON.stringify({
        ...record,
        runId: "626e311b-4211-4f35-b874-a39d801b2df7",
      }),
    );
    expect(() => owned.finish()).toThrow("ISOLATION_UNAVAILABLE");
    expect(readdirSync(path).sort()).toEqual(["active.json", "guard"]);
  });
  it("symlink control objects fail closed", () => {
    const control = createMacControl({ checkoutRoot: root, controlRoot: path });
    control.acquireControl(runId, profileId);
    unlinkSync(join(path, "active.json"));
    const synthetic = join(root, "synthetic");
    writeFileSync(synthetic, "synthetic", { mode: 0o600 });
    symlinkSync(synthetic, join(path, "active.json"));
    expect(() => control.readControlForHarness()).toThrow(
      "ISOLATION_UNAVAILABLE",
    );
  });
  it("a control role outside the checkout cache is rejected", () => {
    mkdirSync(join(root, "outside"));
    const control = createMacControl({
      checkoutRoot: root,
      controlRoot: join(root, "outside"),
    });
    expect(() => control.acquireControl(runId, profileId)).toThrow(
      "ISOLATION_UNAVAILABLE",
    );
  });
});
