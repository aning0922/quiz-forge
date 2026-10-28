import data from "./implementation-data/d3-runtime-bindings.json";
import { z } from "zod";
import {
  engineImplementationEntryV2Schema,
  rendererImplementationEntryV2Schema,
} from "./implementation-schema-v2";
import { consumerImplementationEntryV2Schema } from "../internal-play/implementation-schema-v2";

/** Installed only after final integrated source collection. Null is explicitly unavailable.
 * Old descriptor JSON remains immutable history; an old hash is never an executable fallback. */
export const D3_IMPLEMENTATION_BINDINGS = z
  .strictObject({
    engine: engineImplementationEntryV2Schema.nullable(),
    structuredPreview: rendererImplementationEntryV2Schema.nullable(),
    structuredConsumer: consumerImplementationEntryV2Schema.nullable(),
    qianzaiPreview: rendererImplementationEntryV2Schema.nullable(),
    qianzaiConsumer: consumerImplementationEntryV2Schema.nullable(),
  })
  .parse(data);
