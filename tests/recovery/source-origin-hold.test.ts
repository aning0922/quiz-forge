import { createConnection, createServer } from "node:net";
import { expect, it } from "vitest";
import { holdRecoverySourceOrigin } from "./source-origin-hold";

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("TEST_PORT_INVALID");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
it("resets unexpected source connections and closes the actual listener before returning", async () => {
  const port = await freePort();
  const hold = await holdRecoverySourceOrigin(`http://127.0.0.1:${port}`);
  const client = createConnection({ host: "127.0.0.1", port });
  client.on("error", () => {});
  const closed = new Promise<void>((resolve) =>
    client.once("close", () => resolve()),
  );
  await closed;
  expect(client.destroyed).toBe(true);
  await hold.close();
  await hold.close();
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
});
