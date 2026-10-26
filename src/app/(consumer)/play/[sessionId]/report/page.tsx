import { notFound } from "next/navigation";
import { consumerUuidSchema } from "@/lib/consumer-contract/v1/primitives";
import { consumerPageSourceAllowed } from "@/features/fulfillment/consumer-flow/http/page-source";
import { ConsumerSessionExperience } from "../experience";
export default async function Page({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  if (!(await consumerPageSourceAllowed())) notFound();
  const id = consumerUuidSchema.safeParse((await params).sessionId);
  if (!id.success) notFound();
  return (
    <ConsumerSessionExperience
      key={id.data}
      sessionId={id.data}
      initialScreen="report"
    />
  );
}
