export interface DbWriteQueue {
  drain(): Promise<void>;
  enqueue<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

interface DbWriteQueueOptions {
  onOperationSettled?: () => void;
  onTimeout?: (error: DbWriteTimeoutError) => void;
  runInScope: <T>(operation: () => Promise<T>) => Promise<T>;
  timeoutMs: number;
}

export class DbWriteTimeoutError extends Error {
  constructor(timeoutMs: number, enqueuedAt: string | undefined) {
    super(
      `Database write exceeded ${timeoutMs}ms. Cancellation was requested; write ownership is retained until the operation settles.` +
        (enqueuedAt ? `\nEnqueued from:\n${enqueuedAt}` : "")
    );
    this.name = "DbWriteTimeoutError";
  }
}

/**
 * Serializes database writes and keeps ownership tied to the actual operation.
 * A caller can time out before a cooperative operation finishes unwinding, but
 * the next writer cannot start until that unwind has completed.
 */
export function createDbWriteQueue(options: DbWriteQueueOptions): DbWriteQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    drain: () => tail,
    enqueue<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const enqueuedAt = new Error("db write enqueued").stack;
      let resolveCaller: (value: T | PromiseLike<T>) => void = () => undefined;
      let rejectCaller: (reason?: unknown) => void = () => undefined;
      const callerResult = new Promise<T>((resolve, reject) => {
        resolveCaller = resolve;
        rejectCaller = reject;
      });

      const ownedOperation = tail.then(async () => {
        const controller = new AbortController();
        let callerSettled = false;
        const timer = setTimeout(() => {
          if (callerSettled) {
            return;
          }

          callerSettled = true;
          const error = new DbWriteTimeoutError(options.timeoutMs, enqueuedAt);
          controller.abort(error);
          options.onTimeout?.(error);
          rejectCaller(error);
        }, options.timeoutMs);
        timer.unref?.();

        try {
          const value = await options.runInScope(() => operation(controller.signal));
          if (!callerSettled) {
            callerSettled = true;
            resolveCaller(value);
          }
        } catch (error) {
          if (!callerSettled) {
            callerSettled = true;
            rejectCaller(error);
          }
        } finally {
          clearTimeout(timer);
          options.onOperationSettled?.();
        }
      });

      tail = ownedOperation.then(
        () => undefined,
        () => undefined
      );
      return callerResult;
    }
  };
}
