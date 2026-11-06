export function createAutosaveQueue(save: () => Promise<boolean>) {
  let pending: Promise<boolean> | null = null;
  let requested = false;

  async function drain() {
    try {
      do {
        requested = false;
        if (!(await save())) return false;
      } while (requested);
      return true;
    } finally {
      pending = null;
    }
  }

  return function flush(): Promise<boolean> {
    requested = true;
    if (!pending) {
      // Assign pending before draining, even when save throws synchronously.
      pending = Promise.resolve().then(drain);
    }
    return pending;
  };
}
