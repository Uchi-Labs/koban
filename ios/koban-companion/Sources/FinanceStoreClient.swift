import FinanceKit
import Foundation

struct FinanceKitSnapshot {
    let accountSummaries: [FinanceKitAccountSummary]
    let accounts: [FinanceKitAccountPayload]
    let transactions: [FinanceKitTransactionPayload]
}

struct FinanceKitAccountSummary: Identifiable {
    let balance: Decimal?
    let currency: String
    let displayName: String
    let id: String
    let institutionName: String
    let kind: FinanceKitAccountKind

    var formattedBalance: String {
        guard let balance else {
            return "No balance"
        }

        return Self.formatter(currency: currency).string(from: NSDecimalNumber(decimal: balance)) ?? "\(balance)"
    }

    var kindLabel: String {
        switch kind {
        case .asset:
            return "Asset"
        case .credit:
            return "Credit"
        }
    }

    private static func formatter(currency: String) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        return formatter
    }
}

enum FinanceKitAccountKind: String, Codable {
    case asset
    case credit
}

enum FinanceKitCreditDebit: String, Codable {
    case credit
    case debit
}

struct FinanceKitAccountPayload: Encodable, Identifiable {
    let id: String
    let displayName: String
    let institutionName: String?
    let type: FinanceKitAccountKind
    let currency: String
    let balance: Double?
    let balanceAsOf: String?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case institutionName = "institution_name"
        case type
        case currency
        case balance
        case balanceAsOf = "balance_as_of"
    }
}

struct FinanceKitTransactionPayload: Encodable, Identifiable {
    let id: String
    let accountID: String
    let amountMinor: Int64
    let currency: String
    let creditDebit: FinanceKitCreditDebit
    let merchantName: String?
    let description: String?
    let postedDate: String
    let pending: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case accountID = "account_id"
        case amountMinor = "amount_minor"
        case currency
        case creditDebit = "credit_debit"
        case merchantName = "merchant_name"
        case description
        case postedDate = "posted_date"
        case pending
    }
}

final class FinanceStoreClient {
    private let calendar = Calendar(identifier: .gregorian)
    private let store = FinanceStore.shared

    func authorizationStatus() async throws -> AuthorizationStatus {
        try await store.authorizationStatus()
    }

    func requestAuthorization() async throws -> AuthorizationStatus {
        guard FinanceStore.isDataAvailable(.financialData) else {
            throw FinanceStoreClientError.dataUnavailable
        }

        return try await store.requestAuthorization()
    }

    func fetchAccountSummaries() async throws -> [FinanceKitAccountSummary] {
        let accounts = try await fetchAccounts()
        var summaries: [FinanceKitAccountSummary] = []

        for account in accounts {
            let balance = try await latestBalance(for: account)
            summaries.append(accountSummary(for: account, balance: balance))
        }

        return summaries
    }

    func fetchSnapshot() async throws -> FinanceKitSnapshot {
        let accounts = try await fetchAccounts()
        var summaries: [FinanceKitAccountSummary] = []
        var accountPayloads: [FinanceKitAccountPayload] = []
        var transactionPayloads: [FinanceKitTransactionPayload] = []

        for account in accounts {
            let balance = try await latestBalance(for: account)
            summaries.append(accountSummary(for: account, balance: balance))
            accountPayloads.append(accountPayload(for: account, balance: balance))
            transactionPayloads.append(contentsOf: try await transactions(for: account))
        }

        return FinanceKitSnapshot(
            accountSummaries: summaries,
            accounts: accountPayloads,
            transactions: transactionPayloads
        )
    }

    private func fetchAccounts() async throws -> [Account] {
        let query = AccountQuery(sortDescriptors: [SortDescriptor(\Account.displayName)])
        return try await store.accounts(query: query)
    }

    private func latestBalance(for account: Account) async throws -> Balance? {
        let accountID = account.id
        let query = AccountBalanceQuery(
            predicate: #Predicate<AccountBalance> { balance in
                balance.accountID == accountID
            }
        )
        let balances = try await store.accountBalances(query: query)

        return balances
            .compactMap(preferredBalance)
            .max { left, right in left.asOfDate < right.asOfDate }
    }

    private func transactions(for account: Account) async throws -> [FinanceKitTransactionPayload] {
        if let token = loadHistoryToken(for: account.id) {
            do {
                let sequence = store.transactionHistory(forAccountID: account.id, since: token, isMonitoring: false)
                var changedTransactions: [Transaction] = []

                for try await change in sequence {
                    changedTransactions.append(contentsOf: change.inserted)
                    changedTransactions.append(contentsOf: change.updated)
                    saveHistoryToken(change.newToken, for: account.id)
                }

                return changedTransactions.map(transactionPayload)
            } catch FinanceError.historyTokenInvalid {
                clearHistoryToken(for: account.id)
            }
        }

        let accountID = account.id
        let startDate = calendar.date(byAdding: .day, value: -180, to: Date()) ?? Date(timeIntervalSinceNow: -180 * 86_400)
        let query = TransactionQuery(
            sortDescriptors: [SortDescriptor(\Transaction.transactionDate, order: .reverse)],
            predicate: #Predicate<Transaction> { transaction in
                transaction.accountID == accountID && transaction.transactionDate >= startDate
            }
        )
        let transactions = try await store.transactions(query: query)
        return transactions.map(transactionPayload)
    }

    private func accountSummary(for account: Account, balance: Balance?) -> FinanceKitAccountSummary {
        let kind = account.liabilityAccount == nil ? FinanceKitAccountKind.asset : .credit
        let rawBalance = balance?.amount.amount
        let displayBalance = rawBalance.map { kind == .credit ? -absoluteDecimal($0) : absoluteDecimal($0) }

        return FinanceKitAccountSummary(
            balance: displayBalance,
            currency: balance?.amount.currencyCode ?? account.currencyCode,
            displayName: account.displayName,
            id: account.id.uuidString,
            institutionName: account.institutionName,
            kind: kind
        )
    }

    private func accountPayload(for account: Account, balance: Balance?) -> FinanceKitAccountPayload {
        let kind = account.liabilityAccount == nil ? FinanceKitAccountKind.asset : .credit
        let amount = balance.map { abs(decimalDouble($0.amount.amount)) }

        return FinanceKitAccountPayload(
            id: account.id.uuidString,
            displayName: account.displayName,
            institutionName: account.institutionName,
            type: kind,
            currency: balance?.amount.currencyCode ?? account.currencyCode,
            balance: amount,
            balanceAsOf: balance.map { Self.isoDateTimeFormatter.string(from: $0.asOfDate) }
        )
    }

    private func transactionPayload(_ transaction: Transaction) -> FinanceKitTransactionPayload {
        let description = transaction.transactionDescription.isEmpty
            ? transaction.originalTransactionDescription
            : transaction.transactionDescription
        let postedDate = transaction.postedDate ?? transaction.transactionDate

        return FinanceKitTransactionPayload(
            id: transaction.id.uuidString,
            accountID: transaction.accountID.uuidString,
            amountMinor: minorUnits(from: transaction.transactionAmount.amount),
            currency: transaction.transactionAmount.currencyCode,
            creditDebit: transaction.creditDebitIndicator == .credit ? .credit : .debit,
            merchantName: transaction.merchantName,
            description: description.isEmpty ? nil : description,
            postedDate: Self.isoDateFormatter.string(from: postedDate),
            pending: transaction.status == .pending || transaction.status == .authorized
        )
    }

    private func preferredBalance(_ accountBalance: AccountBalance) -> Balance? {
        switch accountBalance.currentBalance {
        case .available(let balance):
            return balance
        case .booked(let balance):
            return balance
        case .availableAndBooked(_, let booked):
            return booked
        @unknown default:
            return accountBalance.booked ?? accountBalance.available
        }
    }

    private func loadHistoryToken(for accountID: UUID) -> FinanceStore.HistoryToken? {
        guard let data = UserDefaults.standard.data(forKey: historyTokenKey(accountID)) else {
            return nil
        }

        return try? JSONDecoder().decode(FinanceStore.HistoryToken.self, from: data)
    }

    private func saveHistoryToken(_ token: FinanceStore.HistoryToken, for accountID: UUID) {
        if let data = try? JSONEncoder().encode(token) {
            UserDefaults.standard.set(data, forKey: historyTokenKey(accountID))
        }
    }

    private func clearHistoryToken(for accountID: UUID) {
        UserDefaults.standard.removeObject(forKey: historyTokenKey(accountID))
    }

    private func historyTokenKey(_ accountID: UUID) -> String {
        "koban.financekit.historyToken.\(accountID.uuidString)"
    }

    private func minorUnits(from decimal: Decimal) -> Int64 {
        var value = decimal
        var rounded = Decimal()
        NSDecimalRound(&rounded, &value, 2, .plain)
        let scaled = rounded * Decimal(100)
        return NSDecimalNumber(decimal: scaled).int64Value
    }

    private func decimalDouble(_ decimal: Decimal) -> Double {
        NSDecimalNumber(decimal: decimal).doubleValue
    }

    private func absoluteDecimal(_ decimal: Decimal) -> Decimal {
        decimal < 0 ? -decimal : decimal
    }

    private static let isoDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return formatter
    }()

    private static let isoDateTimeFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

enum FinanceStoreClientError: LocalizedError {
    case dataUnavailable

    var errorDescription: String? {
        switch self {
        case .dataUnavailable:
            return "FinanceKit financial data is not available on this device."
        }
    }
}
