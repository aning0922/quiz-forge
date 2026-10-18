import { expect, it } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase } from "@/lib/db/management";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { spawn } from "node:child_process";
import path from "node:path";

it("keeps four synthetic memory bodies owned after real guard/DB close, while independent SQL can still run", async () => {
  const config = await loadRuntimeConfig();
  if (!["test", "ci"].includes(config.purpose))
    throw Error("P4_REQUEST_OWNER_TEST_REQUIRED");
  const admin = await openManagedDatabase(config.instanceId);
  const held: {
    owner: ReturnType<typeof createConsumerRequestOwner>;
    bytes: Buffer;
    body: ReadableStream<Uint8Array>;
  }[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const owner = createConsumerRequestOwner(
        config,
        createStudioRequestBudget(new AbortController().signal),
      );
      // Synthetic verified-memory lifecycle only; this does not assert private asset authorization/reading.
      const bytes = Buffer.alloc(32, i + 1);
      try {
        const result = await owner.run("read-resource", async (c) => {
          await c.sql(async (db) => {
            const [r] = await db.sql`SELECT 1 n`;
            expect(r?.n).toBe(1);
          });
          return c.io(async (io) => {
            await io.guard.check();
            io.issueBody(bytes);
            return bytes;
          });
        });
        expect(result).toBe(bytes);
        held.push({ owner, bytes, body: owner.resourceBody(bytes) });
      } finally {
        await owner.closeIfNotTransferred();
      }
    }
    const fifth = createConsumerRequestOwner(
      config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      await expect(
        fifth.run("read-resource", async (c) => {
          await c.sql(async () => 0);
          return c.io(async () => 0);
        }),
      ).rejects.toThrow("PREVIEW_BUSY");
    } finally {
      await fifth.closeIfNotTransferred();
    }
    const sqlOnly = createConsumerRequestOwner(
      config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      expect(
        await sqlOnly.run("read-session", (c) =>
          c.sql(async (db) => {
            const [r] = await db.sql`SELECT 42 n`;
            return r?.n;
          }),
        ),
      ).toBe(42);
    } finally {
      await sqlOnly.closeIfNotTransferred();
    }
    const reader = held[0]!.body.getReader();
    expect((await reader.read()).value).toEqual(
      Uint8Array.from(held[0]!.bytes),
    );
    expect((await reader.read()).done).toBe(true);
    let stopped = false;
    for (let i = 0; i < 200; i++) {
      const [r] = await admin.sql<
        { n: number }[]
      >`SELECT count(*)::integer n FROM pg_stat_activity WHERE datname=current_database() AND usename=${config.database.user}`;
      if (r?.n === 0) {
        stopped = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(stopped).toBe(true);
  } finally {
    await Promise.all(held.slice(1).map((f) => f.body.cancel()));
    await admin.close();
  }
});

it("retains four real maintenance guards after injected DB close rejection until actual process and backends exit", async () => {
  const config = await loadRuntimeConfig();
  if (!["test", "ci"].includes(config.purpose))
    throw Error("P4_REQUEST_OWNER_TEST_REQUIRED");
  const admin = await openManagedDatabase(config.instanceId);
  try {
    const result = await new Promise<boolean>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "tests/driver/p4-request-owner-child.ts",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: path.resolve("tsconfig.json"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "",
        badOutput = false,
        timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 12000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (output.length + chunk.length > 1024) {
          badOutput = true;
          child.kill("SIGKILL");
        } else output += chunk.toString();
      });
      child.stderr.on("data", () => {
        badOutput = true;
      });
      child.once("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.once("close", (_code, signal) => {
        clearTimeout(timer);
        resolve(
          signal === "SIGTERM" &&
            !timedOut &&
            !badOutput &&
            output === "P4_IO_OWNER_QUARANTINE_OK\n",
        );
      });
    });
    let stopped = false;
    for (let i = 0; i < 200; i++) {
      const [r] = await admin.sql<
        { n: number }[]
      >`SELECT count(*)::integer n FROM pg_stat_activity WHERE datname=current_database() AND usename=${config.database.user}`;
      if (r?.n === 0) {
        stopped = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(stopped, "actual isolated child app backends exited").toBe(true);
    expect(result, "actual child guard quarantine assertions and exit").toBe(
      true,
    );
  } finally {
    await admin.close();
  }
}, 20000);
