/** Explicit local regression. Creates/stops its own test cluster; no credentials are persisted or printed. */
import { readFile } from "node:fs/promises";
import {
  initLocalInstance,
  loadManagedInstance,
  manageLocalInstance,
} from "../../src/lib/db/management";
import { runPg } from "../../src/lib/db/pg-command";
import {
  createDatabase,
  openSql,
  verifyDatabaseIdentity,
} from "../../src/lib/db/client";
import type postgres from "postgres";

async function main() {
  const port = Number(process.env.QF_DRAFT_FK_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432)
    throw new Error("TEST_FK_PORT_REQUIRED");
  let bootstrap: { user: string; password: string } | undefined;
  let instanceId: string | undefined;
  let privileged: postgres.Sql | undefined;
  try {
    const manifest = await initLocalInstance(
      { port, origin: "http://127.0.0.1:3100", purpose: "test" },
      async (command, args) => {
        if (
          command === "initdb" &&
          args.some((value) => value.startsWith("--pwfile="))
        ) {
          const passwordFile = args
            .find((value) => value.startsWith("--pwfile="))
            ?.slice(9);
          const user = args[args.indexOf("-U") + 1];
          if (!passwordFile || !user)
            throw new Error("TEST_INIT_IDENTITY_REQUIRED");
          // Only the freshly generated test initializer's own transient secret.
          bootstrap = {
            user,
            password: (await readFile(passwordFile, "utf8")).trim(),
          };
        }
        return runPg(command, args);
      },
    );
    instanceId = manifest.instanceId;
    const { config } = await loadManagedInstance(instanceId);
    if (
      config.purpose !== "test" ||
      !bootstrap ||
      bootstrap.user !== `qf_cluster_${instanceId}`
    )
      throw new Error("TEST_INIT_IDENTITY_REQUIRED");
    privileged = openSql({ ...config.database, ...bootstrap }, 1);
    bootstrap = undefined;
    await verifyDatabaseIdentity(
      privileged,
      config,
      `qf_cluster_${instanceId}`,
    );
    const [role] = await privileged<
      { superuser: boolean }[]
    >`SELECT rolsuper AS superuser FROM pg_roles WHERE rolname=current_user`;
    if (role?.superuser !== true) throw new Error("TEST_OWN_CLUSTER_REQUIRED");
    const openApp = async () => {
      const app = await createDatabase(config);
      await app.close();
    };
    await openApp();
    for (const target of ["qf.draft_application", "qf.quizpack_validation"]) {
      const rows = await privileged<{ name: string; definition: string }[]>`
        SELECT t.tgname AS name,pg_get_constraintdef(k.oid) AS definition
        FROM pg_constraint k JOIN pg_trigger t ON t.tgconstraint=k.oid
        WHERE k.conrelid='qf.draft_revision'::regclass AND k.confrelid=to_regclass(${target})
          AND k.contype='f' AND t.tgrelid=k.conrelid AND t.tgisinternal AND t.tgtype=5 AND t.tgenabled='O'`;
      if (rows.length !== 1) throw new Error("TEST_EXACT_FK_TRIGGER_REQUIRED");
      const original = rows[0]!;
      await privileged`ALTER TABLE qf.draft_revision DISABLE TRIGGER ${privileged(original.name)}`;
      try {
        const [unchanged] = await privileged<{ exact: boolean }[]>`
          SELECT convalidated AND pg_get_constraintdef(oid)=${original.definition} AS exact
          FROM pg_constraint WHERE conrelid='qf.draft_revision'::regclass AND confrelid=to_regclass(${target}) AND contype='f'`;
        if (unchanged?.exact !== true)
          throw new Error("TEST_FK_DEFINITION_CHANGED");
        const rejected = await openApp().then(
          () => false,
          (error: unknown) =>
            error instanceof Error && error.message === "STUDIO_UNAVAILABLE",
        );
        if (!rejected) throw new Error("TEST_DISABLED_FK_ACCEPTED");
      } finally {
        await privileged`ALTER TABLE qf.draft_revision ENABLE TRIGGER ${privileged(original.name)}`;
      }
      await openApp();
      process.stdout.write(
        `DRAFT_FK_GUARD_PASS ${target === "qf.draft_application" ? "cycle" : "source"}\n`,
      );
    }
  } finally {
    bootstrap = undefined;
    await privileged?.end({ timeout: 3 });
    if (instanceId) {
      await manageLocalInstance("stop", instanceId);
      process.stdout.write(`DRAFT_FK_GUARD_INSTANCE_STOPPED ${instanceId}\n`);
    }
  }
}
main().catch(() => {
  process.stderr.write("DRAFT_FK_GUARD_FAILED\n");
  process.exitCode = 1;
});
