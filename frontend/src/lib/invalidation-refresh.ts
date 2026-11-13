// Signals received during a request require one trailing read: the first
// response may have been captured before the change was committed.
export function createInvalidationRefresh(
  read: (signal: AbortSignal) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let disposed = false;
  let dirty = false;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;

  async function drain() {
    while (dirty && !disposed) {
      dirty = false;
      controller = new AbortController();
      try {
        await read(controller.signal);
      } catch (error) {
        if (!disposed) onError(error);
      }
    }
  }

  function request(): Promise<void> {
    if (disposed) return Promise.resolve();
    dirty = true;
    running ??= drain().finally(() => {
      running = undefined;
      if (dirty && !disposed) return request();
    });
    return running;
  }

  return {
    request,
    dispose() {
      disposed = true;
      dirty = false;
      controller?.abort();
    },
  };
}
