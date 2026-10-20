import { ConsumerAccessV1_1 } from "@/features/theme/consumer-v1-1/access";
import { CONSUMER_ACCESS_GATEWAY } from "./access-gateway-binding";

/** No unverified Key, URL or product metadata chooses an executable module. */
export function ConsumerAccessGateway() {
  const { renderer, protocol } = CONSUMER_ACCESS_GATEWAY;
  return (
    <div
      data-consumer-access-gateway={renderer.id}
      data-consumer-access-version={renderer.version}
      data-consumer-access-entry={renderer.entrySha256}
      data-consumer-access-protocol={protocol}
    >
      <ConsumerAccessV1_1 />
    </div>
  );
}
