import { auditBuildTraces } from "../src/lib/build/trace-audit";

// No arguments or user-selected paths: inspect this checkout's completed build.
if (process.argv.length !== 2) {
  process.stdout.write(
    `${JSON.stringify({ code: "BUILD_TRACE_INVALID_ARGUMENTS", traceCount: 0, pathCount: 0, violationCount: 0 })}\n`,
  );
  process.exitCode = 1;
} else {
  const result = await auditBuildTraces(process.cwd());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.code !== "BUILD_TRACE_OK") process.exitCode = 1;
}
