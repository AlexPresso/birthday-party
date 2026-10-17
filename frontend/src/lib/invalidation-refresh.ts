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
      const current = controller;
      const deadline = setTimeout(() => current.abort(), 10000);
      try {
        await read(current.signal);
      } catch (error) {
        if (!disposed) onError(error);
      } finally {
        clearTimeout(deadline);
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
