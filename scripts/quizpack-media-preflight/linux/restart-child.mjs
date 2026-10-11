// Fresh process: persistent control record must block all new execution.
import { executeSynthetic } from "./controller.mjs";
import { safeMain } from "./common.mjs";
safeMain(async () => {
  const r = await executeSynthetic();
  process.stdout.write(
    JSON.stringify({ outcome: r.outcome, code: r.code, stopped: r.stopped }),
  );
  if (r.code !== "BUSY" || r.stopped !== "not-started") process.exitCode = 1;
});
