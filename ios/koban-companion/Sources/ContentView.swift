import FinanceKit
import Security
import SwiftUI
import UIKit

@MainActor
final class CompanionModel: ObservableObject {
    @Published var accounts: [FinanceKitAccountSummary] = []
    @Published var authorizationStatus: AuthorizationStatus = .notDetermined
    @Published var bearerToken: String
    @Published var errorMessage: String?
    @Published var isSyncing = false
    @Published var lastResultMessage: String?
    @Published var lastSyncAt: Date?
    @Published var serverURLString: String

    private let api = KobanAPI()
    private let financeStore = FinanceStoreClient()
    private static let serverURLKey = "koban.serverURL"
    private static let lastSyncAtKey = "koban.lastSyncAt"
    private static let tokenKey = "koban.bearerToken"

    init() {
        serverURLString = UserDefaults.standard.string(forKey: Self.serverURLKey) ?? "https://finances.vishhvak.com"
        bearerToken = KeychainStore.string(forKey: Self.tokenKey) ?? ""
        if let timestamp = UserDefaults.standard.object(forKey: Self.lastSyncAtKey) as? Date {
            lastSyncAt = timestamp
        }
    }

    func saveSettings() {
        UserDefaults.standard.set(serverURLString, forKey: Self.serverURLKey)
        KeychainStore.setString(bearerToken, forKey: Self.tokenKey)
    }

    func requestAuthorization() async {
        do {
            errorMessage = nil
            authorizationStatus = try await financeStore.requestAuthorization()
            if authorizationStatus == .authorized {
                await refreshAuthorizationAndAccounts()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshAuthorizationAndAccounts() async {
        do {
            guard FinanceStore.isDataAvailable(.financialData) else {
                errorMessage = "FinanceKit data is not available on this device."
                return
            }

            authorizationStatus = try await financeStore.authorizationStatus()
            guard authorizationStatus == .authorized else {
                accounts = []
                return
            }

            accounts = try await financeStore.fetchAccountSummaries()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func syncNow() async {
        saveSettings()
        errorMessage = nil
        lastResultMessage = nil

        guard let serverURL = URL(string: serverURLString), serverURL.scheme?.hasPrefix("http") == true else {
            errorMessage = "Enter a valid Koban server URL."
            return
        }

        guard !bearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Enter the Koban bearer token."
            return
        }

        isSyncing = true
        defer {
            isSyncing = false
            BackgroundSync.schedule()
        }

        do {
            let status = try await financeStore.requestAuthorization()
            authorizationStatus = status
            guard status == .authorized else {
                errorMessage = "FinanceKit access is not authorized."
                return
            }

            let snapshot = try await financeStore.fetchSnapshot()
            let totals = try await api.sync(
                serverURL: serverURL,
                bearerToken: bearerToken,
                deviceName: UIDevice.current.name,
                accounts: snapshot.accounts,
                transactions: snapshot.transactions
            )
            accounts = snapshot.accountSummaries
            lastSyncAt = Date()
            UserDefaults.standard.set(lastSyncAt, forKey: Self.lastSyncAtKey)
            lastResultMessage = [
                "\(totals.accountsUpserted) accounts",
                "\(totals.transactionsAdded) added",
                "\(totals.transactionsUpdated) updated",
                "\(totals.transactionsUnchanged) unchanged"
            ].joined(separator: ", ")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    static func runBackgroundSync() async {
        guard
            let serverURLString = UserDefaults.standard.string(forKey: serverURLKey),
            let serverURL = URL(string: serverURLString),
            let bearerToken = KeychainStore.string(forKey: tokenKey),
            !bearerToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return
        }

        let client = FinanceStoreClient()
        let api = KobanAPI()

        do {
            guard try await client.authorizationStatus() == .authorized else {
                return
            }

            let snapshot = try await client.fetchSnapshot()
            _ = try await api.sync(
                serverURL: serverURL,
                bearerToken: bearerToken,
                deviceName: UIDevice.current.name,
                accounts: snapshot.accounts,
                transactions: snapshot.transactions
            )
            UserDefaults.standard.set(Date(), forKey: lastSyncAtKey)
        } catch {
            return
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var model: CompanionModel

    var body: some View {
        NavigationStack {
            Form {
                Section("Status") {
                    LabeledContent("Authorization", value: authorizationStatusLabel(model.authorizationStatus))
                    LabeledContent("Accounts", value: "\(model.accounts.count)")
                    LabeledContent("Last sync", value: model.lastSyncAt.map(Self.dateFormatter.string(from:)) ?? "Never")

                    if let message = model.lastResultMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    if let error = model.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section("Settings") {
                    TextField("Server URL", text: $model.serverURLString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    SecureField("Bearer token", text: $model.bearerToken)
                        .textInputAutocapitalization(.never)
                    Button("Save settings") {
                        model.saveSettings()
                    }
                }

                Section("Accounts") {
                    if model.accounts.isEmpty {
                        Text("No authorized FinanceKit accounts.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.accounts) { account in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(account.displayName)
                                    Spacer()
                                    Text(account.formattedBalance)
                                        .monospacedDigit()
                                }
                                Text("\(account.institutionName) - \(account.kindLabel)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                    Button {
                        Task {
                            await model.requestAuthorization()
                        }
                    } label: {
                        Label("Authorize FinanceKit", systemImage: "lock.open")
                    }

                    Button {
                        Task {
                            await model.syncNow()
                        }
                    } label: {
                        if model.isSyncing {
                            ProgressView()
                        } else {
                            Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                        }
                    }
                    .disabled(model.isSyncing)
                }
            }
            .navigationTitle("Koban Companion")
            .refreshable {
                await model.refreshAuthorizationAndAccounts()
            }
        }
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    private func authorizationStatusLabel(_ status: AuthorizationStatus) -> String {
        switch status {
        case .authorized:
            return "Authorized"
        case .denied:
            return "Denied"
        case .notDetermined:
            return "Not determined"
        @unknown default:
            return "Unknown"
        }
    }
}

enum KeychainStore {
    static func string(forKey key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: "KobanCompanion",
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    static func setString(_ value: String, forKey key: String) {
        let encoded = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: "KobanCompanion"
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: encoded,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        SecItemDelete(query as CFDictionary)
        SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
    }
}
