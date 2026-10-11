import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { chmod, mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import { join } from "node:path";

const productionSource = await readFile(
  new URL("./control-fault.mjs", import.meta.url),
  "utf8",
);

async function bounded(work) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("TRANSPORT_DEADLINE")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function fixture(mode, handler, run, onUpgrade) {
  // A short, exclusively created Unix path also fits macOS sockaddr_un.
  const root = await mkdtemp("/tmp/qf-cf-");
  const sockets = new Set();
  const requests = new Set();
  const peer = http.createServer(handler);
  let channel;
  try {
    await chmod(root, 0o700);
    assert.equal((await lstat(root)).mode & 0o777, 0o700, "DIRECTORY_MODE");
    const peerPath = join(root, "peer");
    peer.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
    });
    if (onUpgrade) peer.on("upgrade", onUpgrade);
    await bounded(
      new Promise((ok, no) => {
        peer.once("error", () => no(new Error("PEER_LISTEN_FAILED")));
        peer.listen(peerPath, ok);
      }),
    );
    await chmod(peerPath, 0o600);
    assert.equal((await lstat(peerPath)).mode & 0o777, 0o600, "SOCKET_MODE");

    // Execute the actual production function. Replace only its filesystem/
    // daemon boundaries in memory; no real Docker socket or launcher is used.
    const boundary = 'import { CACHE, privateDir } from "./common.mjs";';
    assert.equal(productionSource.split(boundary).length, 2, "FIXTURE_IMPORT");
    assert.equal(
      productionSource.split('"/var/run/docker.sock"').length,
      3,
      "FIXTURE_ENDPOINTS",
    );
    const source = productionSource
      .replace(
        boundary,
        `const CACHE=${JSON.stringify(root)}; const privateDir=async path=>{
          const {mkdir}=await import("node:fs/promises");
          await mkdir(path,{mode:0o700});
        };`,
      )
      .replaceAll('"/var/run/docker.sock"', JSON.stringify(peerPath));
    const { controlFault } = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
    );
    channel = await bounded(controlFault(mode));
    const socketPath = channel.endpoint.slice("unix://".length);
    assert.equal((await lstat(socketPath)).mode & 0o777, 0o600, "PROXY_MODE");
    const request = (path, onResponse) => {
      const req = http.request(
        { socketPath, method: "POST", path },
        onResponse,
      );
      requests.add(req);
      req.once("close", () => requests.delete(req));
      return req;
    };
    const connect = () => {
      const socket = net.connect(socketPath);
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
      return socket;
    };
    await bounded(run({ channel, request, connect }));
  } catch (error) {
    // Never expose OS errors, socket paths or data-URL source in test output.
    const failure = new Error(
      error instanceof assert.AssertionError
        ? "TRANSPORT_ASSERTION"
        : "TRANSPORT_FAILED",
    );
    failure.stack = failure.message;
    throw failure;
  } finally {
    for (const request of requests) request.destroy();
    for (const socket of sockets) socket.destroy();
    try {
      const closed = await Promise.allSettled([
        ...(channel ? [bounded(channel.close())] : []),
        ...(peer.listening
          ? [bounded(new Promise((ok) => peer.close(ok)))]
          : []),
      ]);
      if (closed.some((result) => result.status === "rejected"))
        throw new Error("TRANSPORT_CLOSE_FAILED");
    } finally {
      try {
        await rm(root, { recursive: true, force: true });
      } catch {
        const failure = new Error("TRANSPORT_CLEANUP_FAILED");
        failure.stack = failure.message;
        throw failure;
      }
    }
  }
}

test("wait headers reach the client before body so a dependent start can be issued", async () => {
  let waitReply;
  let started = false;
  await fixture(
    "lose-stop-response",
    (req, res) => {
      if (req.url.endsWith("/wait?condition=next-exit")) {
        waitReply = res;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.flushHeaders();
        // No body until start: buffering these headers causes a real deadlock.
      } else if (req.url.endsWith("/start")) {
        started = true;
        res.writeHead(204);
        res.end();
        waitReply.end('{"StatusCode":0}');
      } else {
        res.writeHead(404);
        res.end();
      }
    },
    async ({ channel, request }) => {
      const completed = deferred();
      const wait = request(
        "/v1.48/containers/synthetic/wait?condition=next-exit",
        (reply) => {
          if (reply.statusCode !== 200 || started) {
            reply.destroy();
            completed.reject(new Error("WAIT_HEADERS_INVALID"));
            return;
          }
          let bytes = 0;
          reply.on("data", (chunk) => {
            bytes += chunk.length;
          });
          reply.once("end", () => completed.resolve(bytes));
          reply.once("error", () => completed.reject(new Error("WAIT_FAILED")));
          const start = request(
            "/v1.48/containers/synthetic/start",
            (response) => {
              response.resume();
            },
          );
          start.on("error", () => completed.reject(new Error("START_FAILED")));
          start.end();
        },
      );
      wait.on("error", () => completed.reject(new Error("WAIT_FAILED")));
      wait.end();
      assert.equal(await completed.promise, 16, "WAIT_BODY_SIZE");
      assert.equal(channel.evidence().startRequests, 1, "SINGLE_START");
      assert.equal(channel.fired, false, "NO_FAULT_FIRED");
    },
  );
});

test("create and kill reply loss still severs responses after the peer finishes", async () => {
  for (const mode of ["lose-create-response", "lose-stop-response"]) {
    let peerFinished = false;
    const status = mode === "lose-create-response" ? 201 : 204;
    await fixture(
      mode,
      (_req, res) => {
        res.writeHead(status);
        res.once("finish", () => {
          peerFinished = true;
        });
        res.end();
      },
      async ({ channel, request }) => {
        let responseSeen = false;
        const lost = deferred();
        const req = request(
          mode === "lose-create-response"
            ? "/v1.48/containers/create"
            : "/v1.48/containers/synthetic/kill?signal=KILL",
          (reply) => {
            responseSeen = true;
            reply.resume();
          },
        );
        req.on("error", () => lost.resolve());
        req.end();
        await lost.promise;
        assert.equal(peerFinished, true, "PEER_FINISHED");
        assert.equal(responseSeen, false, "REPLY_LOST");
        assert.equal(channel.fired, true, "FAULT_FIRED");
        assert.deepEqual(channel.evidence(), {
          createRequests: mode === "lose-create-response" ? 1 : 0,
          startRequests: 0,
          killRequests: mode === "lose-stop-response" ? 1 : 0,
          lostReplies: 1,
          lastLostStatus: status,
          upgradeRequests: 0,
        });
      },
    );
  }
});

test("101 upgrade preserves media type and coalesced raw bytes in both directions", async () => {
  const frame = Buffer.from([1, 0, 0, 0, 0, 0, 0, 1, 65]);
  const peerInput = deferred();
  await fixture(
    "lose-stop-response",
    (_req, res) => {
      res.writeHead(404);
      res.end();
    },
    async ({ channel, connect }) => {
      const received = deferred();
      const socket = connect();
      let bytes = Buffer.alloc(0);
      socket.once("connect", () => {
        socket.write(
          "POST /v1.48/containers/synthetic/attach HTTP/1.1\r\n" +
            "Host: synthetic\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n" +
            "Content-Length: 0\r\n\r\nprobe",
        );
      });
      socket.on("data", (chunk) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 2048) {
          socket.destroy();
          received.reject(new Error("OUTPUT_LIMIT"));
          return;
        }
        const end = bytes.indexOf("\r\n\r\n");
        if (end >= 0 && bytes.length >= end + 4 + frame.length)
          received.resolve(end);
      });
      const end = await received.promise;
      assert.equal(
        bytes.subarray(0, 12).toString(),
        "HTTP/1.1 101",
        "UPGRADE_STATUS",
      );
      assert.equal(
        bytes
          .subarray(0, end)
          .includes("application/vnd.docker.multiplexed-stream"),
        true,
        "MEDIA_TYPE",
      );
      assert.deepEqual(bytes.subarray(end + 4), frame, "DAEMON_HEAD");
      assert.equal(await peerInput.promise, true, "CLIENT_HEAD");
      assert.equal(channel.evidence().upgradeRequests, 1, "SINGLE_UPGRADE");
      assert.equal(channel.fired, false, "NO_FAULT_FIRED");
    },
    (_req, socket, head) => {
      let input = head;
      const check = () => {
        if (input.length >= 5)
          peerInput.resolve(input.equals(Buffer.from("probe")));
      };
      socket.on("data", (chunk) => {
        input = Buffer.concat([input, chunk]);
        if (input.length > 16) {
          peerInput.resolve(false);
          socket.destroy();
        } else check();
      });
      socket.write(
        Buffer.concat([
          Buffer.from(
            "HTTP/1.1 101 UPGRADED\r\n" +
              "Content-Type: application/vnd.docker.multiplexed-stream\r\n" +
              "Connection: Upgrade\r\nUpgrade: tcp\r\n\r\n",
          ),
          frame,
        ]),
      );
      check();
    },
  );
});
