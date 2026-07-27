export function createCaptureSession({
  storage,
  key,
  buffer,
  isEnabled,
  onError,
  persistDelay = 250,
}) {
  let persistTimer;
  let restorePromise = Promise.resolve();

  function restore() {
    restorePromise = restoreFromSession();
    return restorePromise;
  }

  async function restoreFromSession() {
    if (!storage) return;
    try {
      if (!isEnabled()) {
        await storage.remove(key);
        return;
      }
      const stored = await storage.get({ [key]: [] });
      buffer.restore(stored[key]);
    } catch (error) {
      onError(`restore: ${error.message}`);
    }
  }

  function schedulePersist() {
    if (!isEnabled() || !storage || persistTimer !== undefined) return;
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      void restorePromise.then(persist);
    }, persistDelay);
    persistTimer?.unref?.();
  }

  async function persist() {
    if (!isEnabled()) return;
    try {
      await storage.set({ [key]: buffer.snapshot() });
    } catch (error) {
      onError(`persist: ${error.message}`);
    }
  }

  async function clear() {
    cancelPersist();
    if (!storage) return;
    try {
      await storage.remove(key);
    } catch (error) {
      onError(`clear: ${error.message}`);
    }
  }

  function cancelPersist() {
    if (persistTimer === undefined) return;
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }

  return Object.freeze({
    clear,
    restore,
    schedulePersist,
  });
}
