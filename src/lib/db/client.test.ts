import { afterEach, expect, it, vi } from "vitest";
import { openSql } from "./client";

afterEach(() => {
  vi.unstubAllEnvs();
});
it("pins all postgres defaults against PG environment pollution without opening a connection", async () => {
  const pollution = {
    PGHOST: "example.invalid",
    PGPORT: "5432",
    PGUSER: "external",
    PGUSERNAME: "external",
    PGDATABASE: "external",
    PGPASSWORD: "external",
    PGAPPNAME: "external",
    PGMAX: "99",
    PGSSL: "require",
    PGSSLNEGOTIATION: "direct",
    PGDEBUG: "1",
    PGIDLE_TIMEOUT: "900",
    PGCONNECT_TIMEOUT: "900",
    PGMAX_LIFETIME: "900",
    PGMAX_PIPELINE: "900",
    PGBACKOFF: "900",
    PGKEEP_ALIVE: "900",
    PGPREPARE: "false",
    PGFETCH_TYPES: "false",
    PGPUBLICATIONS: "external",
    PGTARGET_SESSION_ATTRS: "read-only",
    PGTARGETSESSIONATTRS: "read-only",
  };
  for (const [key, value] of Object.entries(pollution)) vi.stubEnv(key, value);
  const sql = openSql({
    host: "127.0.0.1",
    port: 55421,
    name: "synthetic",
    user: "synthetic",
    password: "synthetic",
  });
  try {
    const options = sql.options as unknown as Record<string, unknown>;
    expect(options).toMatchObject({
      host: ["127.0.0.1"],
      port: [55421],
      database: "synthetic",
      user: "synthetic",
      pass: "synthetic",
      max: 5,
      ssl: false,
      sslnegotiation: null,
      debug: false,
      idle_timeout: 10,
      connect_timeout: 3,
      max_lifetime: 1800,
      max_pipeline: 100,
      backoff: false,
      keep_alive: 60,
      prepare: true,
      fetch_types: true,
      publications: "alltables",
      target_session_attrs: "read-write",
      connection: {
        application_name: "quizforge-p2a",
        search_path: "pg_catalog",
      },
    });
    expect(sql.options.host).toEqual(["127.0.0.1"]);
  } finally {
    await sql.end({ timeout: 1 });
  }
});
