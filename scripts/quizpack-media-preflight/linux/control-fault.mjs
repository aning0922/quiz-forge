// Closed synthetic Docker transport faults. Proxies the same local daemon;
// never manufactures inspect/wait state or a successful response.
import http from "node:http";
import { chmod, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { CACHE, privateDir } from "./common.mjs";
const MODES = new Set([
  "lose-create-response",
  "lose-stop-response",
  "daemon-unavailable",
]);
export async function controlFault(mode) {
  if (!MODES.has(mode)) throw new Error("FAULT_MODE");
  const root = resolve(CACHE, "fault-channel");
  await privateDir(root);
  const path = resolve(root, "socket");
  // Never unlink an unowned previous socket/record. EADDRINUSE blocks this run.
  let armed = mode !== "daemon-unavailable";
  let fired = false;
  const counts = {
    createRequests: 0,
    startRequests: 0,
    killRequests: 0,
    lostReplies: 0,
    lastLostStatus: null,
    upgradeRequests: 0,
  };
  const sockets = new Set();
  const requests = new Set();
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && /\/containers\/create(?:\?|$)/.test(req.url))
      counts.createRequests++;
    if (
      req.method === "POST" &&
      /\/containers\/[^/]+\/start(?:\?|$)/.test(req.url)
    )
      counts.startRequests++;
    if (
      req.method === "POST" &&
      /\/containers\/[^/]+\/kill(?:\?|$)/.test(req.url)
    )
      counts.killRequests++;
    if (mode === "daemon-unavailable" && armed) {
      fired = true;
      req.socket.destroy();
      return;
    }
    const upstream = http.request({
      socketPath: "/var/run/docker.sock",
      method: req.method,
      path: req.url,
      headers: req.headers,
    });
    requests.add(upstream);
    upstream.on("close", () => requests.delete(upstream));
    upstream.on("error", () => res.destroy());
    upstream.on("response", (reply) => {
      const lose =
        (mode === "lose-create-response" &&
          req.method === "POST" &&
          /\/containers\/create(?:\?|$)/.test(req.url)) ||
        (mode === "lose-stop-response" &&
          req.method === "POST" &&
          /\/containers\/[^/]+\/kill(?:\?|$)/.test(req.url));
      if (lose) {
        // Wait for the real daemon's response to finish, then sever CLI response.
        // Side effect happened; original create is not retried by the launcher.
        reply.resume();
        reply.once("end", () => {
          fired = true;
          counts.lostReplies++;
          counts.lastLostStatus = reply.statusCode;
          res.destroy();
        });
      } else {
        res.writeHead(reply.statusCode, reply.headers);
        res.flushHeaders();
        reply.pipe(res);
      }
    });
    req.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    counts.upgradeRequests++;
    if (mode === "daemon-unavailable" && armed) {
      fired = true;
      socket.destroy();
      return;
    }
    const upstream = http.request({
      socketPath: "/var/run/docker.sock",
      method: req.method,
      path: req.url,
      headers: req.headers,
    });
    requests.add(upstream);
    upstream.on("close", () => requests.delete(upstream));
    upstream.on("error", () => socket.destroy());
    upstream.on("upgrade", (reply, daemonSocket, daemonHead) => {
      sockets.add(daemonSocket);
      daemonSocket.once("close", () => sockets.delete(daemonSocket));
      const headers = Object.entries(reply.headers)
        .flatMap(([k, v]) =>
          Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`],
        )
        .join("\r\n");
      socket.write(
        `HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n${headers}\r\n\r\n`,
      );
      if (daemonHead.length) socket.write(daemonHead);
      if (head.length) daemonSocket.write(head);
      daemonSocket.pipe(socket);
      socket.pipe(daemonSocket);
      socket.on("error", () => daemonSocket.destroy());
      daemonSocket.on("error", () => socket.destroy());
    });
    upstream.on("response", (reply) => {
      socket.write(
        `HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\nConnection: close\r\n\r\n`,
      );
      reply.pipe(socket);
    });
    upstream.end();
  });
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(path, ok);
  });
  await chmod(path, 0o600);
  return {
    endpoint: `unix://${path}`,
    arm() {
      armed = true;
    },
    get fired() {
      return fired;
    },
    evidence() {
      return Object.freeze({ ...counts });
    },
    async close() {
      for (const r of requests) r.destroy();
      for (const s of sockets) s.destroy();
      await new Promise((ok) => server.close(ok));
      try {
        await unlink(path);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    },
  };
}
