/** Test-owned child process; IPC only, no credentials or driver errors on stdout/stderr. */
import { getDatabase } from "../../src/lib/db/client";
import { createImportReceiveService } from "../../src/features/quizpack/import/service";
import { createReceiveContext } from "../../src/features/quizpack/import/context";
import type { StudioWriteCredentials } from "../../src/lib/auth/write";
process.on(
  "message",
  async (message: {
    credentials: StudioWriteCredentials;
    productId: string;
    importId: string;
  }) => {
    const { context, dispose } = createReceiveContext(
      new AbortController().signal,
    );
    const db = await getDatabase(context);
    try {
      const service = createImportReceiveService({
        afterClaim: async () => {
          process.send?.({ claimed: true });
          await new Promise<void>(() => {});
        },
      });
      await service.receiveArchive(
        db,
        message.credentials,
        message.productId,
        message.importId,
        {
          chunks: {
            async *[Symbol.asyncIterator]() {
              yield new Uint8Array([1]);
            },
          },
          cancel: async () => {},
        },
        context,
      );
    } catch {
      process.send?.({ failed: true });
    } finally {
      dispose();
      await db.close();
    }
  },
);
process.send?.({ ready: true });
