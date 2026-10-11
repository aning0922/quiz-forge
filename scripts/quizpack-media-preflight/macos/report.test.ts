import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { emitFinalReport } from "./report";
test("report IO failure cannot revoke an already committed capability", async () => {
  const broken = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("SYNTHETIC_REPORT_FAILURE"));
    },
  });
  assert.deepEqual(await emitFinalReport(broken, '{"passed":true}', true), {
    reported: false,
    capabilityCommitted: true,
  });
});
test("uncommitted report IO failure remains a fixed failure", async () => {
  const broken = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("SYNTHETIC_REPORT_FAILURE"));
    },
  });
  await assert.rejects(emitFinalReport(broken, '{"passed":true}', false), {
    message: "REPORT_UNAVAILABLE",
  });
});
