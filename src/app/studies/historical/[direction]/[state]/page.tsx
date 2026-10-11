import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HistoricalPrototype } from "@/features/theme/historical/prototype";
import {
  directions,
  states,
  historicalStudies,
} from "@/features/theme/historical/tokens";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ direction: string; state: string }>;
}): Promise<Metadata> {
  const { direction, state } = await params;
  const study = historicalStudies[direction as keyof typeof historicalStudies];
  return {
    title: `${study?.name ?? "历史人物"} · ${state === "portrait" ? "档案" : "封面"}概念`,
  };
}

export function generateStaticParams() {
  return directions.flatMap((direction) =>
    states.map((state) => ({ direction, state })),
  );
}

export default async function PrototypePage({
  params,
}: {
  params: Promise<{ direction: string; state: string }>;
}) {
  const { direction, state } = await params;
  if (
    !directions.includes(direction as (typeof directions)[number]) ||
    !states.includes(state as (typeof states)[number])
  )
    notFound();
  return (
    <HistoricalPrototype
      direction={direction as (typeof directions)[number]}
      state={state as (typeof states)[number]}
    />
  );
}
