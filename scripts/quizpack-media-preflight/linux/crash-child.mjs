// Fixed synthetic parent-crash window: create has actually closed, no start
// request can be issued until the hook returns. Harness kills this parent here.
import { executeSynthetic } from "./controller.mjs";
import { safeMain } from "./common.mjs";
safeMain(async () => {
  await executeSynthetic({
    scenario: "hang",
    hooks: {
      async afterCreate(record, created) {
        if (created.code !== 0 || created.reason || !created.settled)
          throw new Error("CREATE_UNCONFIRMED");
        process.stdout.write(
          JSON.stringify({
            schema: "qf-own-create-closed.v1",
            runId: record.runId,
            ownerPid: process.pid,
            createClosed: true,
          }),
        );
        setInterval(() => {}, 1000);
        await new Promise(() => {});
      },
    },
  });
});
