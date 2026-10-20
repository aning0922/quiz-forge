import {
  mkdtemp,
  lstat,
  mkdir,
  chmod,
  symlink,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  inspectPreviewNativeControl,
  previewNativePlatform,
} from "./p3c-native-control";
let root: string;
const qualification = "synthetic-db-and-private-pixels-no-native";
const container = () => path.join(root, ".cache", "quizpack-media-runtime"),
  state = () => path.join(container(), previewNativePlatform!),
  control = () => path.join(state(), "control");
beforeEach(async () => {
  root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "qf-p3c-control-")),
  );
  await chmod(root, 0o700);
});
afterEach(async () => {
  await chmod(path.join(root, ".cache"), 0o700).catch(() => {});
  await rm(root, { recursive: true, force: true });
});
it("a genuinely fresh root reports not-provisioned without creating any control directory", async () => {
  expect(await inspectPreviewNativeControl(qualification, root)).toBe(
    "not-provisioned",
  );
  await expect(
    import("node:fs/promises").then((fs) =>
      fs.lstat(path.join(root, ".cache")),
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("existing ancestors and absent platform state root are checked again on each observation", async () => {
  await mkdir(container(), { recursive: true, mode: 0o700 });
  expect(await inspectPreviewNativeControl(qualification, root)).toBe(
    "not-provisioned",
  );
  await mkdir(state(), { mode: 0o700 });
  await expect(
    inspectPreviewNativeControl(qualification, root),
  ).rejects.toThrow("PREVIEW_FIXTURE_NATIVE_CONTROL_UNCONFIRMED");
  await mkdir(control(), { mode: 0o700 });
  expect(await inspectPreviewNativeControl(qualification, root)).toBe("empty");
  await writeFile(
    path.join(control(), "active-run"),
    "synthetic-unfinished-control",
    { mode: 0o600 },
  );
  await expect(
    inspectPreviewNativeControl(qualification, root),
  ).rejects.toThrow("PREVIEW_FIXTURE_NATIVE_CONTROL_UNCONFIRMED");
});
it.each([
  "state-mode",
  "control-mode",
  "state-file",
  "control-file",
  "control-symlink",
])("existing %s is never called not-provisioned", async (kind) => {
  await mkdir(container(), { recursive: true, mode: 0o700 });
  if (kind === "state-file") await writeFile(state(), "bad");
  else {
    await mkdir(state(), { mode: 0o700 });
    if (kind === "control-file") await writeFile(control(), "bad");
    else if (kind === "control-symlink") await symlink("missing", control());
    else await mkdir(control(), { mode: 0o700 });
  }
  if (kind === "state-mode" || kind === "control-mode") {
    const directory = kind === "state-mode" ? state() : control();
    // mkdir permissions are filtered by umask; explicitly establish this negative fixture.
    await chmod(directory, 0o755);
    expect((await lstat(directory)).mode & 0o777).toBe(0o755);
  }
  await expect(
    inspectPreviewNativeControl(qualification, root),
  ).rejects.toThrow("PREVIEW_FIXTURE_NATIVE_CONTROL_UNCONFIRMED");
});
it.each(["cache", "container", "state"])(
  "dangling %s symlink is rejected despite descendant ENOENT",
  async (kind) => {
    if (kind !== "cache")
      await mkdir(path.join(root, ".cache"), { mode: 0o700 });
    if (kind === "state") await mkdir(container(), { mode: 0o700 });
    await symlink(
      "missing",
      kind === "cache"
        ? path.join(root, ".cache")
        : kind === "container"
          ? container()
          : state(),
    );
    await expect(
      inspectPreviewNativeControl(qualification, root),
    ).rejects.toThrow("PREVIEW_FIXTURE_NATIVE_CONTROL_UNCONFIRMED");
  },
);
it("unknown qualification cannot gain the absent-runtime exception", async () => {
  await expect(
    inspectPreviewNativeControl("native-fixture", root),
  ).rejects.toThrow("PREVIEW_FIXTURE_NATIVE_CONTROL_UNCONFIRMED");
});
