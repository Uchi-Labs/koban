import type { Metadata } from "next";
import { InvestmentsPageView } from "@/components/investments-page-view";
import { InvestmentsView } from "@/components/investments-view";
import { getInvestmentsData } from "@/lib/investments";

export const metadata: Metadata = { title: "Investments" };

export default async function InvestmentsPage() {
  const data = await getInvestmentsData();

  if (data.accounts.length === 0) {
    return <InvestmentsPageView />;
  }

  return <InvestmentsView data={data} />;
}
