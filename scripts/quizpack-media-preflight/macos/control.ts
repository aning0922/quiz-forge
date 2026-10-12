// Fixed offline role adapter; lifecycle and file checks live in the production core.
import { join } from "node:path";
import { MAC_ROOT, REPO_ROOT, RUNTIME_TARGET, RUNTIME_STATE } from "./policy";
import {
  createMacControl,
  ensurePrivateDirectory as ensureCoreDirectory,
  ControlError,
} from "../../../src/features/quizpack/server/media/internal/macos/control";
export { ControlError };
export const CONTROL_ROOT = join(
  RUNTIME_TARGET ? RUNTIME_STATE : MAC_ROOT,
  "control",
);
const control = createMacControl({
  checkoutRoot: REPO_ROOT,
  controlRoot: CONTROL_ROOT,
});
export const acquireControl = control.acquireControl;
export const readControlForHarness = control.readControlForHarness;
export function ensurePrivateDirectory(path: string) {
  ensureCoreDirectory(path, REPO_ROOT);
}
