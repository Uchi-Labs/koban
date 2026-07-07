"use client";

import dynamic from "next/dynamic";
import type {
  CashflowChartCategory,
  CashflowChartProps,
  CashflowChartRow,
  CashflowChartVariant
} from "@/components/cashflow-chart-renderer";

export type {
  CashflowChartCategory,
  CashflowChartProps,
  CashflowChartRow,
  CashflowChartVariant
};

const CashflowChartRenderer = dynamic<CashflowChartProps>(
  () => import("@/components/cashflow-chart-renderer").then((module) => module.CashflowChartRenderer),
  { ssr: false }
);

export function CashflowChart(props: CashflowChartProps) {
  return <CashflowChartRenderer {...props} />;
}
