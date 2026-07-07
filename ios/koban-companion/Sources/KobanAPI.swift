import Foundation

struct KobanSyncTotals {
    var accountsUpserted = 0
    var transactionsAdded = 0
    var transactionsUpdated = 0
    var transactionsUnchanged = 0

    mutating func add(_ response: KobanIngestResponse) {
        accountsUpserted = max(accountsUpserted, response.accountsUpserted)
        transactionsAdded += response.transactionsAdded
        transactionsUpdated += response.transactionsUpdated
        transactionsUnchanged += response.transactionsUnchanged
    }
}

struct KobanIngestRequest: Encodable {
    let deviceName: String
    let accounts: [FinanceKitAccountPayload]
    let transactions: [FinanceKitTransactionPayload]

    enum CodingKeys: String, CodingKey {
        case deviceName = "device_name"
        case accounts
        case transactions
    }
}

struct KobanIngestResponse: Decodable {
    let accountsUpserted: Int
    let transactionsAdded: Int
    let transactionsUpdated: Int
    let transactionsUnchanged: Int

    enum CodingKeys: String, CodingKey {
        case accountsUpserted = "accounts_upserted"
        case transactionsAdded = "transactions_added"
        case transactionsUpdated = "transactions_updated"
        case transactionsUnchanged = "transactions_unchanged"
    }
}

final class KobanAPI {
    private let batchSize = 500
    private let encoder: JSONEncoder
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
        encoder = JSONEncoder()
    }

    func sync(
        serverURL: URL,
        bearerToken: String,
        deviceName: String,
        accounts: [FinanceKitAccountPayload],
        transactions: [FinanceKitTransactionPayload]
    ) async throws -> KobanSyncTotals {
        let batches: [[FinanceKitTransactionPayload]] = transactions.isEmpty ? [[]] : transactions.chunked(into: batchSize)
        var totals = KobanSyncTotals()

        for batch in batches {
            let response = try await post(
                serverURL: serverURL,
                bearerToken: bearerToken,
                request: KobanIngestRequest(deviceName: deviceName, accounts: accounts, transactions: batch)
            )
            totals.add(response)
        }

        return totals
    }

    private func post(
        serverURL: URL,
        bearerToken: String,
        request ingestRequest: KobanIngestRequest
    ) async throws -> KobanIngestResponse {
        let endpoint = endpointURL(from: serverURL)
        let body = try encoder.encode(ingestRequest)
        var lastError: Error?

        for attempt in 0..<3 {
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw KobanAPIError.invalidResponse
                }

                if (200..<300).contains(http.statusCode) {
                    return try JSONDecoder().decode(KobanIngestResponse.self, from: data)
                }

                if http.statusCode >= 500 && attempt < 2 {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    continue
                }

                throw KobanAPIError.httpStatus(http.statusCode, message: String(data: data, encoding: .utf8))
            } catch {
                lastError = error
                if attempt < 2 {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    continue
                }
            }
        }

        throw lastError ?? KobanAPIError.invalidResponse
    }

    private func endpointURL(from serverURL: URL) -> URL {
        var base = serverURL
        if !base.absoluteString.hasSuffix("/") {
            base = URL(string: "\(base.absoluteString)/") ?? base
        }

        return URL(string: "api/v1/financekit/ingest", relativeTo: base)!.absoluteURL
    }
}

enum KobanAPIError: LocalizedError {
    case httpStatus(Int, message: String?)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .httpStatus(let status, let message):
            return "Koban ingest returned HTTP \(status): \(message ?? "no response body")"
        case .invalidResponse:
            return "Koban ingest returned an invalid response."
        }
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
