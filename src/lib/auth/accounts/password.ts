import "server-only";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { StudioError } from "@/lib/http-security/errors";
export const PASSWORD_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  version: 0x13,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});
const weak = new Set([
  "passwordpassword",
  "password123456789",
  "123456789012345",
  "1234567890123456",
  "qwertyuiopasdfgh",
  "letmeinletmeinletmein",
]);
export function normalizePassword(input: unknown): string {
  if (
    typeof input !== "string" ||
    new TextDecoder("utf-8", { fatal: true }).decode(
      new TextEncoder().encode(input),
    ) !== input
  )
    throw new StudioError("PASSWORD_POLICY_REJECTED");
  const value = input.normalize("NFC"),
    length = [...value].length;
  if (
    length < 15 ||
    length > 256 ||
    Buffer.byteLength(value, "utf8") > 1024 ||
    weak.has(value.toLowerCase()) ||
    /^(.)\1+$/u.test(value)
  )
    throw new StudioError("PASSWORD_POLICY_REJECTED");
  return value;
}
export function validPasswordHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(
      value,
    )
  );
}
let running = 0;
const queue: Array<() => void> = [];
async function capacity<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 2) {
    if (queue.length >= 8) throw new StudioError("RATE_LIMITED");
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const enter = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const index = queue.indexOf(enter);
        if (index >= 0) queue.splice(index, 1);
        reject(new StudioError("RATE_LIMITED"));
      }, 5000);
      queue.push(enter);
    });
  } else running++;
  try {
    return await work();
  } finally {
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}
export function hashPassword(value: string): Promise<string> {
  return capacity(() =>
    argon2.hash(value, { ...PASSWORD_OPTIONS, salt: randomBytes(16) }),
  );
}
// Public dummy PHC, not an account password. Its cost is identical to the accepted account policy.
let dummy: Promise<string> | undefined;
export async function verifyPassword(
  value: string,
  phc: string | null,
): Promise<boolean> {
  if (phc !== null && !validPasswordHash(phc))
    throw new StudioError("STUDIO_UNAVAILABLE");
  if (!phc) dummy ??= hashPassword("synthetic dummy verifier passphrase 2026");
  const hash = phc ?? (await dummy!);
  const matched = await capacity(() =>
    argon2.verify(hash, value, { type: argon2.argon2id }),
  );
  return phc !== null && matched;
}
