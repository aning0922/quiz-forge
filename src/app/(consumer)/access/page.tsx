import { notFound } from "next/navigation";
import { ConsumerAccessGateway } from "@/features/product/internal-play/access-gateway";
import { consumerPageSourceAllowed } from "@/features/fulfillment/consumer-flow/http/page-source";
export default async function Page() {
  if (!(await consumerPageSourceAllowed())) notFound();
  return <ConsumerAccessGateway />;
}
