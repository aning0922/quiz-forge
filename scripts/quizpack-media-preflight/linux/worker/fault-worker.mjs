// Closed synthetic harness scenarios; never selected by normal image API.
const [scenario] = process.argv.slice(2);
const success =
  '{"ok":true,"mediaType":"image/png","width":2,"height":2,"frames":1,"mediaDecoded":true}';
if (scenario === "stdout") process.stdout.write("x".repeat(2049));
else if (scenario === "stderr") process.stderr.write("x".repeat(4097));
else if (scenario === "bad-json") process.stdout.write("{");
else if (scenario === "multi-json") process.stdout.write(success + success);
else if (scenario === "invalid-utf8") process.stdout.write(Buffer.from([255]));
else if (scenario === "nonzero") {
  process.stdout.write(success);
  process.exitCode = 7;
} else if (scenario === "crash") process.abort();
else if (scenario === "oom") {
  const a = [];
  setInterval(() => {
    a.push(Buffer.alloc(32 * 1024 * 1024, 1));
  }, 1);
} else if (["hang", "success-hang", "backpressure"].includes(scenario)) {
  if (scenario === "success-hang") process.stdout.write(success);
  setInterval(() => {}, 1000);
} else process.exitCode = 9;
