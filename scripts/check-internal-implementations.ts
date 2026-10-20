import { verifyInternalImplementations } from "./verify-internal-implementations";
import { verifyConsumerImplementations } from "./verify-consumer-implementations";
import { verifyConsumerAccessGateway } from "./verify-consumer-access-gateway";
import { CONSUMER_ACCESS_GATEWAY } from "../src/features/product/internal-play/access-gateway-binding";
import {
  CONSUMER_IMPLEMENTATION_DESCRIPTORS,
  CONSUMER_IMPLEMENTATION_AVAILABILITY,
  consumerImplementationAvailable,
} from "../src/features/product/internal-play/implementation-catalog";
try {
  const value = await verifyInternalImplementations(process.cwd());
  const compiled = Object.values(CONSUMER_IMPLEMENTATION_AVAILABILITY);
  if (compiled.some((identity) => !consumerImplementationAvailable(identity)))
    throw Error("CONSUMER_COMPILED_MAPPING_MISMATCH");
  const consumer = await verifyConsumerImplementations(
    process.cwd(),
    CONSUMER_IMPLEMENTATION_DESCRIPTORS,
    compiled,
  );
  const accessGateway = await verifyConsumerAccessGateway(
    process.cwd(),
    CONSUMER_ACCESS_GATEWAY,
    CONSUMER_IMPLEMENTATION_DESCRIPTORS,
    compiled,
  );
  process.stdout.write(
    JSON.stringify({
      code: "INTERNAL_IMPLEMENTATIONS_OK",
      ...value,
      consumer,
      accessGateway,
    }) + "\n",
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
