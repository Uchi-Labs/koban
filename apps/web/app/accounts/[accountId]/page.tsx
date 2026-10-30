import { notFound } from "next/navigation";
import { AccountDetailView } from "@/components/account-detail-view";
import { accountHistory, getInvestmentsData } from "@/lib/investments";
import { createAccountCategorySpending, selectAccountDetailData } from "@/lib/account-detail";
import { getFinanceData } from "@/lib/finance-data";
import { getTransactionViews, getUpcomingRecurringViews } from "@/lib/view-models";

export default async function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const financeData = await getFinanceData();
  const selection = selectAccountDetailData(financeData, accountId);

  if (!selection) {
    notFound();
  }

  const { account, recurringItems, transactions } = selection;
  const providerConnection = financeData.providerConnections.find(
    (connection) => connection.id === account.providerConnectionId
  );
  const snapshots = financeData.ledger?.balanceSnapshots ?? [];
  const history = accountHistory(account.id, snapshots);
  const transactionViews = getTransactionViews(transactions, {
    accounts: financeData.accounts,
    categories: financeData.categories
  });
  const categorySpending = createAccountCategorySpending(transactions, financeData.categories);
  const recurringViews = getUpcomingRecurringViews(recurringItems, financeData.categories);
  const investmentData = account.type === "investment" ? await getInvestmentsData() : null;
  const holdings = investmentData?.holdings.filter((holding) => holding.accountId === account.id) ?? [];

  return (
    <AccountDetailView
      account={account}
      categorySpending={categorySpending}
      history={history}
      holdings={holdings}
      providerConnection={providerConnection}
      recurringViews={recurringViews}
      transactionViews={transactionViews}
    />
  );
}
