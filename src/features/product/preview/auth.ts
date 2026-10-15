import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioActor } from "@/lib/auth/capabilities";
import type postgres from "postgres";
import { read } from "@/features/quizpack/import/repository";
import { verifyCsrf } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";

export type PreviewCredentials = Readonly<{
  sessionToken: string | null;
  csrfToken?: string | null;
}>;
/** POST protection is independent of business write capability and never touches session expiry. */
export function assertPreviewCsrf(credentials: PreviewCredentials): void {
  if (!credentials.sessionToken) throw new StudioError("UNAUTHENTICATED");
  if (
    !credentials.csrfToken ||
    !verifyCsrf(credentials.sessionToken, "session", credentials.csrfToken)
  )
    throw new StudioError("CSRF_REJECTED");
}
export function authorizedPreviewRead<T>(
  db: P2aDatabase,
  credentials: PreviewCredentials,
  work: (tx: postgres.TransactionSql, actor: StudioActor) => Promise<T>,
): Promise<T> {
  // Deliberately three arguments: the import reader's fourth means import:create.
  return read(db, credentials.sessionToken, work);
}
/** Call in a NEW transaction after computation/IO; repeatable-read rechecks are insufficient. */
export async function reauthorizePreview(
  db: P2aDatabase,
  credentials: PreviewCredentials,
): Promise<void> {
  await authorizedPreviewRead(db, credentials, async () => undefined);
}
