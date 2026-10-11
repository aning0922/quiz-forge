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
      .sql`TRUNCATE qf.operator_session,qf.audit_event,qf.operator`;
  } finally {
    await verified.close();
  }
}
