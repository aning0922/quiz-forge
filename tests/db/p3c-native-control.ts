import { lstat, realpath, opendir } from "node:fs/promises";
import path from "node:path";
export type PreviewNativeControlStatus = "not-provisioned" | "empty";
export const previewNativePlatform =
  process.platform === "darwin" && process.arch === "arm64"
    ? "darwin-arm64"
    : process.platform === "linux" && process.arch === "x64"
      ? "linux-x64"
      : null;
const invalid = () => Error("PREVIEW_FIXTURE_NATIVE_CONTROL_UNCONFIRMED");
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
/** Only this explicit no-native fixture may distinguish a wholly absent platform state root.
 * The root argument isolates actual filesystem tests; production/native cleanup is unchanged.
 */
export async function inspectPreviewNativeControl(
  qualification: unknown,
  root = process.cwd(),
): Promise<PreviewNativeControlStatus> {
  if (
    qualification !== "synthetic-db-and-private-pixels-no-native" ||
    !previewNativePlatform ||
    !path.isAbsolute(root)
  )
    throw invalid();
  try {
    const container = path.join(root, ".cache", "quizpack-media-runtime"),
      stateRoot = path.join(container, previewNativePlatform);
    for (const dir of [root, path.join(root, ".cache"), container]) {
      let stat;
      try {
        stat = await lstat(dir);
      } catch (error) {
        if (dir !== root && missing(error)) continue;
        throw invalid();
      }
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid?.() ||
        (await realpath(dir)) !== dir
      )
        throw invalid();
    }
    let state;
    try {
      state = await lstat(stateRoot);
    } catch (error) {
      if (missing(error)) return "not-provisioned";
      throw invalid();
    }
    if (
      !state.isDirectory() ||
      state.isSymbolicLink() ||
      state.uid !== process.getuid?.() ||
      (state.mode & 0o777) !== 0o700 ||
      (await realpath(stateRoot)) !== stateRoot
    )
      throw invalid();
    const directory = path.join(stateRoot, "control"),
      before = await lstat(directory);
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o777) !== 0o700 ||
      (await realpath(directory)) !== directory
    )
      throw invalid();
    const entries = await opendir(directory, { bufferSize: 16 });
    try {
      if (await entries.read()) throw invalid();
    } finally {
      await entries.close();
    }
    const after = await lstat(directory);
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      after.uid !== process.getuid?.() ||
      (after.mode & 0o777) !== 0o700 ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      (await realpath(directory)) !== directory
    )
      throw invalid();
    return "empty";
  } catch {
    throw invalid();
  }
}
