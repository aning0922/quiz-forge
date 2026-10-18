import "server-only";
import { projectConsumerEntryV1, projectConsumerResultV1 } from "./projection";
/** Display adapter only; exact implementation registration and service authority belong to root/A. */
export const CONSUMER_SERVER_DISPLAY_V1 = Object.freeze({
  projectEntry: projectConsumerEntryV1,
  projectResult: projectConsumerResultV1,
});
