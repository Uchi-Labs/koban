import { BarChart3, WalletCards } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/card";
import { PageHeader, pageFrameClassName } from "@/components/page-header";

// The empty state renders no dynamic data, so this takes no props and declares
// no props interface — an empty one would only need a lint suppression to exist.

export function InvestmentsPageView() {
  return (
    <main className={pageFrameClassName} data-testid="investments-page">
      <PageHeader title="Investments" />
      <EmptyState
        actions={
          <Link className={buttonVariants({ variant: "secondary", size: "sm" })} href="/settings">
            <WalletCards className="size-4" />
            Connect a brokerage
          </Link>
        }
        description="Connect a SnapTrade brokerage in Settings to sync investment accounts, balances, and holdings."
        icon={<BarChart3 className="size-5" />}
        title="No investment accounts yet"
      />
    </main>
  );
}
