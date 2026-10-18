import { verifyConsumerImplementationEntry } from "../src/features/product/internal-play/implementation-schema";
import { consumerRendererIdentitySchema } from "../src/lib/consumer-contract/v1/identities";
import { verifyTrustedImplementationEntries } from "./verify-internal-implementations";

const key = (value: {
  kind: string;
  id: string;
  version: string;
  entrySha256: string;
}) => JSON.stringify([value.kind, value.id, value.version, value.entrySha256]);

/**
 * Read-only build gate for the application's local compiled catalog. These arguments are never
 * request, database or package input. Availability is supplied by the compiled bindings separately
 * from immutable metadata. Running this verifier does not register or activate an implementation.
 */
export async function verifyConsumerImplementations(
  cwd: string,
  catalog: readonly unknown[],
  compiledIdentities: readonly unknown[],
  overrideRead?: (path: string) => Promise<Buffer>,
) {
  if (catalog.length > 100 || compiledIdentities.length > 16)
    throw Error("CONSUMER_CATALOG_LIMIT");
  const entries = await Promise.all(
    catalog.map(verifyConsumerImplementationEntry),
  );
  const keys = entries.map((entry) =>
    key({ ...entry.descriptor, entrySha256: entry.entrySha256 }),
  );
  const available = compiledIdentities.map((value) =>
    key(consumerRendererIdentitySchema.parse(value)),
  );
  if (
    new Set(keys).size !== keys.length ||
    new Set(available).size !== available.length ||
    available.some((k) => !keys.includes(k))
  )
    throw Error("CONSUMER_CATALOG_BINDING_MISMATCH");
  return verifyTrustedImplementationEntries(
    cwd,
    entries,
    (entry) =>
      available.includes(
        key({ ...entry.descriptor, entrySha256: entry.entrySha256 }),
      ),
    overrideRead,
  );
}
