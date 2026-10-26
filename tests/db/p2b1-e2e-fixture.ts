import { seedVersionFixtureAccount } from "./version-account-fixture";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { openTestDatabase, resetTestDatabase } from "./p2a-fixture";

import { readPrivateJson } from "@/lib/db/runtime";

// A separate react-server process; secrets are written only to an exclusive 0600 file.
async function run() {
  const mode = process.argv[2];
  const runId = process.argv[3];
  if (mode !== "prepare" && mode !== "cleanup") throw new Error();
  if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error();
  const fixture = await openTestDatabase();
  const file = path.join(
    process.cwd(),
    ".cache",
    "p2a",
    fixture.config.instanceId,
    "workspace-e2e-fixture.json",
  );
  let created = false;
  try {
    if (mode === "cleanup") {
      const stored = await readPrivateJson(file);
      if (
        !stored ||
        typeof stored !== "object" ||
        !("runId" in stored) ||
        stored.runId !== runId
      )
        throw new Error();
      await resetTestDatabase(fixture);
      await unlink(file);
      return;
    }
    const operator = randomBytes(32).toString("base64url");
    const readOnly = randomBytes(32).toString("base64url");
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    try {
      await handle.writeFile(
        JSON.stringify({
          version: 1,
          runId,
          operator: operator,
          readOnly: readOnly,
        }),
      );
    } finally {
      await handle.close();
    }
    // The A-owned reset explicitly bounds cleanup to the test instance's seven tables.
    await resetTestDatabase(fixture);
    await seedVersionFixtureAccount(
      fixture,
      { identifier: randomUUID(), secret: operator },
      "Synthetic workspace-e2e operator",
      "operator",
      "workspace-e2e-operator",
    );
    await seedVersionFixtureAccount(
      fixture,
      { identifier: randomUUID(), secret: readOnly },
      "Synthetic workspace-e2e reader",
      "read-only",
      "workspace-e2e-read-only",
    );
  } catch {
    if (created) await unlink(file).catch(() => undefined);
    throw new Error();
  } finally {
    await fixture.close();
  }
}

run()
  .then(() => {
    process.stdout.write("WORKSPACE_E2E_FIXTURE_READY\n");
  })
  .catch(() => {
    process.stderr.write("WORKSPACE_E2E_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
