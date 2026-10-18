import { verifyInternalImplementations } from "./verify-internal-implementations";
try {
  const value = await verifyInternalImplementations(process.cwd());
  process.stdout.write(
    JSON.stringify({ code: "INTERNAL_IMPLEMENTATIONS_OK", ...value }) + "\n",
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: "INTERNAL_IMPLEMENTATIONS_INVALID",
      reason: error instanceof Error ? error.message : "UNKNOWN",
    }) + "\n",
  );
  process.exitCode = 1;
}
