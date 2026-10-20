import "server-only";
import type postgres from "postgres";

/** Internal actual-resource facts, issued synchronously by the database factory.
 * A rejected factory is not evidence of closed resources. Observers must never throw.
 * No credentials, SQL text or business data crosses this interface.
 */
export type DatabaseLifecycleObserver = Readonly<{
  allocated(client: postgres.Sql): void;
  verification(actual: Promise<void>): void;
  ending(actual: Promise<void>): void;
  neverAllocated(): void;
}>;
