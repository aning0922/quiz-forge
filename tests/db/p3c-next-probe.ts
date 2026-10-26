import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  previewEntryResponseSchema,
  previewRevealResponseSchema,
} from "@/features/product/preview/contracts";
import {
  previewApiPath,
  previewResourceUrl,
} from "@/features/product/preview/urls";
import { PREAUTH_COOKIE, SESSION_COOKIE } from "@/lib/auth/cookies";
import { openTestDatabase } from "./p2a-fixture";
import {
  readPreviewFixture,
  cleanupPreviewFixture,
} from "./p3c-preview-fixture";
import {
  launchPreviewServer,
  assertPreviewServerRunning,
  stopAndProveServerExit,
} from "../support/p3c-server-owner";
const fail = () => Error("P3C_NEXT_PROBE_FAILED");
export async function probePreviewNext() {
  const db = await openTestDatabase(),
    runId = randomUUID(),
    origin = db.config.origin;
  const port = Number(new URL(origin).port);
  // Main owns 3100. This independent probe is restricted to an explicitly isolated test origin.
  if (db.config.purpose !== "test" || port === 3100) throw fail();
  const env = {
    ...process.env,
    TSX_TSCONFIG_PATH: path.resolve("tsconfig.json"),
  };
  const owner = await launchPreviewServer({
    cwd: process.cwd(),
    instanceId: db.config.instanceId,
    runId,
    port,
    runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
    env,
  });
  let prepared = false,
    passed = false;
  const command = async (action: "prepare" | "finish") => {
    try {
      await promisify(execFile)(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "tests/db/p3c-preview-fixture.ts",
          action,
          runId,
        ],
        {
          cwd: process.cwd(),
          env,
          timeout: action === "prepare" ? 90000 : 30000,
          maxBuffer: 4096,
        },
      );
    } catch {
      throw fail();
    }
  };
  try {
    const until = performance.now() + 10000;
    let ready = false;
    while (performance.now() < until) {
      assertPreviewServerRunning(owner);
      try {
        const response = await fetch(origin, {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(50);
    }
    if (!ready) throw fail();
    await command("prepare");
    prepared = true;
    const fixture = await readPreviewFixture(db, runId);
    const postHeaders = { origin, "content-type": "application/json" };
    const pre = await fetch(origin + "/api/studio/auth/preauth", {
      method: "POST",
      headers: postHeaders,
      body: "{}",
    });
    const preDto = await pre.json();
    if (pre.status !== 201) throw fail();
    const preCookie = pre.headers
      .getSetCookie()
      .find((c) => c.startsWith(PREAUTH_COOKIE + "="))
      ?.split(";")[0];
    if (!preCookie) throw fail();
    const login = await fetch(origin + "/api/studio/auth/password-login", {
      method: "POST",
      headers: {
        ...postHeaders,
        cookie: preCookie,
        "x-csrf-token": preDto.csrfToken,
      },
      body: JSON.stringify({
        loginName: `test-${fixture.readOnly.identifier}`,
        password: fixture.readOnly.secret,
      }),
    });
    const session = await login.json();
    if (!login.ok || session.operator.role !== "read-only") throw fail();
    const cookie = login.headers
      .getSetCookie()
      .find((c) => c.startsWith(SESSION_COOKIE + "="))
      ?.split(";")[0];
    if (!cookie) throw fail();
    let entries = 0,
      images = 0,
      scores = 0;
    for (const source of fixture.sources) {
      const response = await fetch(origin + previewApiPath(source.scope), {
        headers: { cookie },
      });
      if (!response.ok) throw fail();
      const parsed = previewEntryResponseSchema.parse(await response.json());
      entries++;
      for (const asset of parsed.value.assets) {
        const url =
          origin +
          previewResourceUrl({
            binding: source.binding,
            resourceRef: asset.resourceRef,
          });
        const image = await fetch(url, {
          headers: { cookie, "if-none-match": "*" },
        });
        if (image.status !== 200 || image.headers.has("etag")) throw fail();
        const bytes = new Uint8Array(await image.arrayBuffer());
        if (
          bytes.length !== asset.bytes ||
          createHash("sha256").update(bytes).digest("hex") !== asset.sha256
        )
          throw fail();
        images++;
        const head = await fetch(url, { method: "HEAD", headers: { cookie } });
        if (head.status !== 400) throw fail();
        const range = await fetch(url, {
          headers: { cookie, range: "bytes=0-3" },
        });
        if (range.status !== 400) throw fail();
        await range.body?.cancel();
      }
      for (const witness of source.witnesses) {
        const requestId = randomUUID();
        const scored = await fetch(
          origin + previewApiPath(source.scope, "score"),
          {
            method: "POST",
            headers: {
              ...postHeaders,
              cookie,
              "x-csrf-token": session.csrfToken,
            },
            body: JSON.stringify({
              binding: source.binding,
              requestId,
              answers: witness.answers,
            }),
          },
        );
        if (!scored.ok) throw fail();
        const reveal = previewRevealResponseSchema.parse(await scored.json());
        if (
          reveal.value.requestId !== requestId ||
          reveal.value.selectedResultRef.id !== witness.resultId
        )
          throw fail();
        scores++;
      }
    }
    passed = true;
    return {
      entries,
      images,
      scores,
      engines: 2,
      transport: "real-production-next",
      browser: false,
    };
  } finally {
    try {
      const proof = await stopAndProveServerExit(owner);
      if (prepared && passed) {
        await command("finish");
        await cleanupPreviewFixture(db, runId, proof);
      }
    } finally {
      await db.close();
    }
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  probePreviewNext()
    .then((result) =>
      process.stdout.write(
        JSON.stringify({ code: "P3C_NEXT_PROBE_OK", ...result }) + "\n",
      ),
    )
    .catch(() => {
      process.stderr.write("P3C_NEXT_PROBE_FAILED\n");
      process.exitCode = 1;
    });
