import { createDatabase } from "../../src/lib/db/client";
import { loadRuntimeConfig } from "../../src/lib/db/runtime";
import { openManagedDatabase } from "../../src/lib/db/management";

// No implicit instance creation, no demo cleanup, no skip or in-memory fallback.
export async function openTestDatabase() {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw new Error("P2A_TEST_DATABASE_REQUIRED");
  const admin = await openManagedDatabase(config.instanceId);
  try {
    if (JSON.stringify(admin.config) !== JSON.stringify(config))
      throw new Error("P2A_TEST_DATABASE_IDENTITY_MISMATCH");
    const app = await createDatabase(config);
    return {
      config,
      app,
      admin,
      close: async () => {
        await app.close();
        await admin.close();
      },
    };
  } catch (error) {
    await admin.close();
    throw error;
  }
}
export type TestDatabase = Awaited<ReturnType<typeof openTestDatabase>>;

export async function resetTestDatabase(database: TestDatabase): Promise<void> {
  if (database.config.purpose !== "test" && database.config.purpose !== "ci")
    throw new Error("P2A_TEST_DATABASE_REQUIRED");
  // Reverify marker/role/version before every destructive fixture operation.
  const verified = await openTestDatabase();
  try {
    if (verified.config.instanceId !== database.config.instanceId)
      throw new Error("P2A_TEST_DATABASE_IDENTITY_MISMATCH");
    await verified.admin
      .sql`TRUNCATE qf.product_tag,qf.product,qf.category,qf.tag,qf.operator_session,qf.audit_event,qf.operator`;
  } finally {
    await verified.close();
  }
}

/** Synthetic sessions for B1 domain/HTTP tests; raw values stay inside test process. */
export async function authenticateTestOperator(
  database: TestDatabase,
  role: "operator" | "read-only" = "operator",
) {
  const { randomUUID } = await import("node:crypto");
  const { issueToken } = await import("../../src/lib/security/p2a-tokens");
  const { createPreauth, login } = await import("../../src/lib/auth/service");
  const credential = issueToken("credential");
  const id = randomUUID();
  await safeTestOperation(
    () =>
      database.admin
        .sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${id},${`test-${id}`},${credential.digest},${role},'active')`,
  );
  const preauth = await safeTestOperation(() =>
    createPreauth(database.app, null, randomUUID()),
  );
  const session = await safeTestOperation(() =>
    login(
      database.app,
      preauth.raw,
      preauth.dto.csrfToken,
      credential.raw,
      randomUUID(),
    ),
  );
  return {
    id,
    session,
    credentials: {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    },
  };
}

/** Prevent a driver query/parameter exception from reaching test reporters. */
export async function safeTestOperation<T>(
  work: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const { StudioError } = await import("../../src/lib/http-security/errors");
    if (error instanceof StudioError) throw error;
    throw new Error("TEST_DATABASE_OPERATION_FAILED");
  }
}
