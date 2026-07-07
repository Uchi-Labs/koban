import BackgroundTasks
import Foundation

enum BackgroundSync {
    static let taskIdentifier = "com.vishhvak.koban.companion.refresh"
    private static var syncHandler: (() async -> Void)?

    static func register(sync: @escaping () async -> Void) {
        syncHandler = sync
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }

            handle(refreshTask)
        }
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handle(_ task: BGAppRefreshTask) {
        schedule()
        let operation = Task {
            await syncHandler?()
            task.setTaskCompleted(success: !Task.isCancelled)
        }

        task.expirationHandler = {
            operation.cancel()
        }
    }
}
