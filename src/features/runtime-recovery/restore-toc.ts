import "server-only";
import { RECOVERY_TABLES } from "./contracts";
import { RecoveryError } from "./errors";

/** Finite own PG18.4 schema, not a parser or sandbox for arbitrary SQL archives. */
export function assertRecoveryToc(text: string, instanceId: string): void {
  const expected: Record<string, number> = {
    ACL: 159,
    SCHEMA: 2,
    TYPE: 6,
    FUNCTION: 40,
    TABLE: 23,
    "TABLE DATA": 23,
    CONSTRAINT: 70,
    "CHECK CONSTRAINT": 6,
    INDEX: 15,
    TRIGGER: 21,
    "FK CONSTRAINT": 38,
  };
  const counts: Record<string, number> = {},
    tables: string[] = [],
    data: string[] = [];
  const fail = () => new RecoveryError("RECOVERY_FORMAT_INVALID");
  if (
    !text.includes("Format: CUSTOM") ||
    !text.includes("Dumped from database version: 18.4") ||
    !text.includes("Dumped by pg_dump version: 18.4")
  )
    throw fail();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(";")) continue;
    const match =
      /^\d+;\s+\d+\s+\d+\s+(ACL|SCHEMA|TYPE|FUNCTION|TABLE DATA|TABLE|CHECK CONSTRAINT|FK CONSTRAINT|CONSTRAINT|INDEX|TRIGGER)\s+(qf_meta|qf|-)\s+(.+)$/.exec(
        line,
      );
    if (!match) throw fail();
    const [, kind, schema, rest] = match;
    if (rest!.endsWith(" pg_database_owner")) {
      if (
        kind !== "ACL" ||
        schema !== "-" ||
        rest !== "SCHEMA public pg_database_owner"
      )
        throw fail();
    } else if (!rest!.endsWith(` qf_owner_${instanceId}`)) throw fail();
    counts[kind!] = (counts[kind!] ?? 0) + 1;
    if (kind === "TABLE" || kind === "TABLE DATA") {
      const name = `${schema}.${rest!.split(" ")[0]}`;
      (kind === "TABLE" ? tables : data).push(name);
    }
    if (
      kind === "SCHEMA" &&
      (schema !== "-" || !["qf", "qf_meta"].includes(rest!.split(" ")[0]!))
    )
      throw fail();
  }
  if (
    Object.entries(expected).some(([kind, n]) => counts[kind] !== n) ||
    JSON.stringify(tables.sort()) !== JSON.stringify(RECOVERY_TABLES) ||
    JSON.stringify(data.sort()) !== JSON.stringify(RECOVERY_TABLES)
  )
    throw fail();
}
