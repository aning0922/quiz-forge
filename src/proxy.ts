import { NextResponse } from "next/server";
import { consumerPrivateHeaders } from "@/features/fulfillment/consumer-flow/http/response";
/** Apply real HTTP privacy headers to consumer documents, API and error responses. No credential reads. */
export function proxy() {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(consumerPrivateHeaders))
    response.headers.set(name, value);
  return response;
}
export const config = { matcher: ["/access/:path*", "/play/:path*"] };
