import { BarChart3, WalletCards } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button-variants";
import { EmptyState } from "@/components/ui/card";

// The empty state renders no dynamic data, so this takes no props and declares
// no props interface — an empty one would only need a lint suppression to exist.

export function InvestmentsPageView() {
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 lg:px-8" data-testid="investments-page">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="app-page-title">Investments</h1>
      </div>
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
