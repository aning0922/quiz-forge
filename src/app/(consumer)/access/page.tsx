import { notFound } from "next/navigation";
import { ConsumerAccessV1 } from "@/features/theme/consumer-v1/access";
import { consumerPageSourceAllowed } from "@/features/fulfillment/consumer-flow/http/page-source";
export default async function Page() {
  if (!(await consumerPageSourceAllowed())) notFound();
  return <ConsumerAccessV1 />;
}
