import { createServer, type Socket } from "node:net";
import { recoveryOriginSchema } from "@/features/runtime-recovery/contracts";

const uncertain = new Set<unknown>();
/** Owns only a new listener; it rejects every connection and never speaks HTTP or adopts a PID. */
export async function holdRecoverySourceOrigin(origin: string) {
  if (uncertain.size || !recoveryOriginSchema.safeParse(origin).success)
    throw Error("RECOVERY_SOURCE_ORIGIN_HOLD_INVALID");
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {}); // An intentional reset is still followed by actual close.
    socket.once("close", () => sockets.delete(socket));
    socket.destroy();
  });
  server.maxConnections = 16;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(origin).port), "127.0.0.1", resolve);
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({
    close() {
      return (closing ??= new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          uncertain.add(server);
          for (const socket of sockets) uncertain.add(socket);
          reject(Error("RECOVERY_SOURCE_ORIGIN_CLOSE_UNPROVEN"));
        }, 5000);
        for (const socket of sockets) socket.destroy();
        server.close((error) => {
          clearTimeout(timer);
          if (uncertain.has(server)) return;
          if (error || sockets.size) {
            uncertain.add(server);
            for (const socket of sockets) uncertain.add(socket);
            reject(Error("RECOVERY_SOURCE_ORIGIN_CLOSE_UNPROVEN"));
          } else resolve();
        });
      }));
    },
  });
}
