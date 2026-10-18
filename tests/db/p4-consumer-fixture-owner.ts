/** Test fixture lifecycle, process-global across module reload. Never a serialized cleanup capability. */
type FixtureOwner = { unknown: boolean; retained: Set<unknown> };
const key = Symbol.for("quizforge.p4-consumer-fixture-owner.v1"),
  root = globalThis as typeof globalThis & { [key]?: FixtureOwner };
const owner = (root[key] ??= { unknown: false, retained: new Set() });
export function assertConsumerFixtureKnown(): void {
  if (owner.unknown) throw Error("CONSUMER_FIXTURE_UNKNOWN_PRESERVED");
}
/** No reset, TTL or late-close release. An unknown write/FD requires actual process exit and fresh evidence. */
export function retainConsumerFixtureUnknown(...resources: unknown[]): void {
  owner.unknown = true;
  for (const resource of resources) owner.retained.add(resource);
}
