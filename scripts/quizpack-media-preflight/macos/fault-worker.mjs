// Closed synthetic harness. Never called by runIsolatedImage.
const scenario = process.argv[2];
const facts = JSON.stringify({
  ok: true,
  mediaType: "image/png",
  width: 2,
  height: 2,
  frames: 1,
  mediaDecoded: true,
});
const hang = () => setTimeout(() => process.exit(0), 15_000);
switch (scenario) {
  case "stdout":
    process.stdout.write("x".repeat(2049));
    hang();
    break;
  case "stderr":
    process.stderr.write("x".repeat(4097));
    hang();
    break;
  case "invalid":
    process.stdout.write("not-json");
    break;
  case "multiple":
    process.stdout.write(facts + facts);
    break;
  case "extra":
    process.stdout.write(facts.replace('"ok":true', '"ok":true,"extra":1'));
    break;
  case "bom":
    process.stdout.write(
      Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(facts)]),
    );
    break;
  case "nonzero":
    process.stdout.write(facts);
    process.exitCode = 7;
    break;
  case "crash":
    process.abort();
    break;
  case "success-hang":
    process.stdout.write(facts);
    hang();
    break;
  case "backpressure":
    hang();
    break;
  case "identity-hang":
    process.stdout.write(
      JSON.stringify({ pid: process.pid, parentPid: process.ppid }),
    );
    hang();
    break;
  case "environment":
    process.stdout.write(JSON.stringify({ keys: Object.keys(process.env) }));
    break;
  case "unknown-stop":
    process.stdout.write(facts);
    setTimeout(() => process.exit(0), 12000);
    break;
  case "parent-crash":
    process.stdout.write(facts);
    setTimeout(() => process.exit(0), 1500);
    break;
  default:
    process.exitCode = 64;
}
