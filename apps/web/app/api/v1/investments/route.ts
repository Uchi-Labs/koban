import { NextResponse } from "next/server";
import {
  getInvestmentsData,
  type HoldingView,
  type InvestmentAccountView,
  type PortfolioPoint
} from "@/lib/investments";

export const runtime = "nodejs";

export async function GET() {
  const data = await getInvestmentsData();

  return NextResponse.json({
    object: "investments",
    as_of: data.asOf,
    currency: data.currency,
    total_market_value: data.totalMarketValue,
    change: data.change
      ? { amount: data.change.amount, percent: data.change.percent }
      : null,
    history: data.history.map(serializePoint),
    accounts: data.accounts.map(serializeAccount),
    holdings: data.holdings.map(serializeHolding),
    total_count: data.holdings.length
  });
}

function serializePoint(point: PortfolioPoint) {
  return { time: point.time, value: point.value };
}

function serializeHolding(holding: HoldingView) {
  return {
    object: "investment_holding",
    id: holding.id,
    symbol: holding.symbol,
    description: holding.description,
    account_id: holding.accountId,
    account_name: holding.accountName,
    units: holding.units,
    price: holding.price ?? null,
    market_value: holding.marketValue,
    currency: holding.currency,
    weight: holding.weight,
    tradingview_symbol: holding.tradingViewSymbol
  };
}

function serializeAccount(account: InvestmentAccountView) {
  return {
    object: "investment_account",
    id: account.id,
    institution_name: account.institutionName,
    name: account.name,
    mask: account.mask ?? null,
    type: account.type,
    balance: account.balance,
    currency: account.currency,
    last_synced_at: account.lastSyncedAt,
    history: account.history.map(serializePoint),
    positions: account.positions.map(serializeHolding)
  };
}
