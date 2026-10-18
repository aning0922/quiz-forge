import { consumerExchangeInputSchema } from "@/features/fulfillment/consumer-flow/contracts";
/** Erase first, including malformed input. Return only a validated in-memory token, never a URL. */
export function takeConsumerAccessFragmentV1(
  location: Pick<Location, "hash" | "pathname" | "search">,
  replace: (url: string) => void,
): string | null {
  const fragment = location.hash;
  const hasQuery = location.search.length > 0;
  replace(location.pathname);
  if (hasQuery || fragment.length > 256 || !fragment.startsWith("#"))
    return null;
  const values = new URLSearchParams(fragment.slice(1));
  if ([...values.keys()].length !== 1 || !values.has("key")) return null;
  const parsed = consumerExchangeInputSchema.safeParse({
    rawKey: values.get("key"),
  });
  return parsed.success ? parsed.data.rawKey : null;
}
