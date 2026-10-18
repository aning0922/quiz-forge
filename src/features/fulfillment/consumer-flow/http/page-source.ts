import "server-only";
import { headers } from "next/headers";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { configuredHost } from "@/lib/http-security/source";
/** Direct navigation may have no Fetch Metadata/Origin. Host still matches the local profile. */
export async function consumerPageSourceAllowed() {
  try {
    const config = await loadRuntimeConfig();
    return (await headers()).get("host") === configuredHost(config);
  } catch {
    return false;
  }
}
