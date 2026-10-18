import { CONSUMER_COMPONENTS_V1 } from "./components";
import { matchesConsumerMappingV1 } from "./component-map";
export {
  CONSUMER_RENDERER_V1,
  CONSUMER_COMPONENT_MAPPING_V1,
  matchesConsumerMappingV1,
} from "./component-map";

/** No component default/latest lookup; caller first resolves the exact registered renderer identity. */
export function bindConsumerComponentsV1(mapping: unknown) {
  return matchesConsumerMappingV1(mapping) ? CONSUMER_COMPONENTS_V1 : null;
}
