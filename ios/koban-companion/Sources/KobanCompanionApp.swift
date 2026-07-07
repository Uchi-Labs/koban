import SwiftUI

@main
struct KobanCompanionApp: App {
    @StateObject private var model = CompanionModel()

    init() {
        BackgroundSync.register {
            await CompanionModel.runBackgroundSync()
        }
        BackgroundSync.schedule()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .task {
                    await model.refreshAuthorizationAndAccounts()
                }
        }
    }
}
