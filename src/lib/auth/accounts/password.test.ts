import { describe, it, expect, vi } from "vitest";
import {
  normalizePassword,
  validPasswordHash,
  withPasswordCapacity,
} from "./password";
import {
  passwordSetupCsrf,
  passwordTokenBytes,
} from "@/features/studio/accounts/password-token";
import {
  issuePasswordToken,
  passwordTokenDigest,
  requirePasswordTokenCsrf,
} from "./service";
describe("account password policy and bounded execution", () => {
  it("counts NFC code points, preserves spaces and long passphrases, rejects malformed/weak input without truncation", () => {
    expect(
      normalizePassword("  synthetic long passphrase 2026  ").startsWith("  "),
    ).toBe(true);
    expect(normalizePassword("e\u0301".repeat(15) + " context")).toBe(
      "é".repeat(15) + " context",
    );
    for (const value of [
      "short",
      "123456789012345",
      "x".repeat(257),
      "abc\ud800" + "x".repeat(20),
    ])
      expect(() => normalizePassword(value)).toThrow(
        "PASSWORD_POLICY_REJECTED",
      );
    expect([...normalizePassword("旅程".repeat(128))]).toHaveLength(256);
  });
  it("only accepts fixed Argon2id cost and verifies correct/incorrect passwords inside one lease", async () => {
    await withPasswordCapacity(async (k) => {
      const hash = await k.hash("synthetic wrapper passphrase 2026");
      expect(validPasswordHash(hash)).toBe(true);
      expect(validPasswordHash(hash.replace("m=65536", "m=999999999"))).toBe(
        false,
      );
      expect(await k.verify("synthetic wrapper passphrase 2026", hash)).toBe(
        true,
      );
      expect(await k.verify("synthetic wrong wrapper phrase 2026", hash)).toBe(
        false,
      );
      expect(await k.verify("synthetic wrong wrapper phrase 2026", null)).toBe(
        false,
      );
    });
  });
  it("admits two whole-workflow leases and eight waiters, refuses overflow before starting work", async () => {
    let active = 0,
      max = 0;
    const release: Array<() => void> = [];
    const work = () =>
      withPasswordCapacity(async () => {
        active++;
        max = Math.max(active, max);
        await new Promise<void>((r) => release.push(r));
        active--;
      });
    const pending = Array.from({ length: 10 }, work);
    await expect(work()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(active).toBe(2);
    while (release.length || active) {
      const next = release.shift();
      next?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(pending);
    expect(max).toBe(2);
  });
  it("expires a queued workflow after five seconds without starting or abandoning active work", async () => {
    vi.useFakeTimers();
    const release: Array<() => void> = [];
    const held = Array.from({ length: 2 }, () =>
      withPasswordCapacity(() => new Promise<void>((r) => release.push(r))),
    );
    let started = false;
    try {
      const queued = withPasswordCapacity(async () => {
        started = true;
      });
      const rejected = expect(queued).rejects.toMatchObject({
        code: "RATE_LIMITED",
      });
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(started).toBe(false);
      expect(release).toHaveLength(2);
    } finally {
      release.forEach((r) => r());
      await Promise.all(held);
      vi.useRealTimers();
    }
  });
  it("uses one canonical bearer encoding and dedicated CSRF domain", async () => {
    const a = issuePasswordToken(),
      b = issuePasswordToken();
    expect(passwordTokenBytes(a.raw)?.length).toBe(32);
    expect(passwordTokenBytes(a.raw + "=")).toBeNull();
    const csrf = await passwordSetupCsrf(a.raw);
    expect(typeof csrf).toBe("string");
    expect(await requirePasswordTokenCsrf(a.raw, csrf)).toBe(
      passwordTokenDigest(a.raw),
    );
    await expect(requirePasswordTokenCsrf(b.raw, csrf)).rejects.toMatchObject({
      code: "CSRF_REJECTED",
    });
  });
});
