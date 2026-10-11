// Trusted offline setup only. The ordinary entry never accepts this path or a candidate ID.
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { CAPABILITY_FILE } from "./policy";
export function readCapabilityBytes(): Buffer {
  const fd = openSync(
    CAPABILITY_FILE,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.size > 1024 ||
      st.uid !== process.getuid?.() ||
      st.nlink !== 1
    )
      throw new Error("CAPABILITY_UNAVAILABLE");
    const b = Buffer.alloc(1025);
    const n = readSync(fd, b, 0, b.length, 0);
    if (n !== st.size || n > 1024) throw new Error("CAPABILITY_UNAVAILABLE");
    return Buffer.from(b.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}
export function sealCapabilityAfterChecks(
  allChecksPassed: boolean,
  componentId: string,
): boolean {
  if (!allChecksPassed) return false;
  if (!/^[a-f0-9]{64}$/.test(componentId))
    throw new Error("CAPABILITY_INVALID");
  const before = lstatSync(CAPABILITY_FILE),
    previous = readCapabilityBytes();
  if (before.isSymbolicLink()) throw new Error("CAPABILITY_UNAVAILABLE");
  const temp = `${CAPABILITY_FILE}.next`;
  const fd = openSync(
    temp,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  let committed = false;
  const owned = fstatSync(fd);
  try {
    const bytes = Buffer.from(
      JSON.stringify({ schema: "mac-media-capability.v1", componentId }) + "\n",
    );
    let offset = 0;
    while (offset < bytes.length) {
      const n = writeSync(fd, bytes, offset, bytes.length - offset);
      if (n <= 0) throw new Error("CAPABILITY_WRITE_FAILED");
      offset += n;
    }
    fsyncSync(fd);
    closeSync(fd);
    const now = lstatSync(CAPABILITY_FILE);
    if (
      now.ino !== before.ino ||
      now.dev !== before.dev ||
      !readCapabilityBytes().equals(previous)
    )
      throw new Error("CAPABILITY_CHANGED");
    // Verify directory sync capability before the irreversible atomic rename.
    // Rename is the commit point; no fallible validation or IO follows it.
    const dir = openSync(
      dirname(CAPABILITY_FILE),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (!fstatSync(dir).isDirectory())
        throw new Error("CAPABILITY_UNAVAILABLE");
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    renameSync(temp, CAPABILITY_FILE);
    committed = true;
    return true;
  } finally {
    try {
      closeSync(fd);
    } catch {}
    if (!committed) {
      try {
        const st = lstatSync(temp);
        if (st.ino === owned.ino && st.dev === owned.dev) unlinkSync(temp);
      } catch {}
    }
  }
}
