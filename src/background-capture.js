import {
  BACKGROUND_CAPTURE_SCRIPT,
  BACKGROUND_CAPTURE_SCRIPT_ID,
  DEFAULT_SETTINGS,
} from "./settings.js";

export function createBackgroundCaptureSetting({
  extensionApi,
  onChange,
  onError,
}) {
  let enabled = DEFAULT_SETTINGS.backgroundCapture;
  let updateQueue = Promise.resolve();
  let receivedStorageChange = false;

  function queueUpdate(nextEnabled, { initial = false } = {}) {
    const update = updateQueue.then(async () => {
      const normalised = Boolean(nextEnabled);
      enabled = normalised;
      const contentScriptUpdate = syncContentScript(
        extensionApi.scripting,
        normalised,
        onError,
      );
      await onChange(normalised, { initial });
      await contentScriptUpdate;
    });
    updateQueue = update.catch(onError);
    return update;
  }

  const ready = readSetting(extensionApi.storage)
    .then(value => (
      receivedStorageChange
        ? updateQueue
        : queueUpdate(value, { initial: true })
    ))
    .catch(error => {
      onError(error);
      return queueUpdate(DEFAULT_SETTINGS.backgroundCapture);
    });

  extensionApi.storage?.onChanged?.addListener((changes, areaName) => {
    const change = changes.backgroundCapture;
    if (areaName !== "local" || !change) return;
    receivedStorageChange = true;
    void queueUpdate(change.newValue, { initial: false });
  });

  return Object.freeze({
    isEnabled: () => enabled,
    ready,
  });
}

async function readSetting(storage) {
  if (!storage?.local?.get) return DEFAULT_SETTINGS.backgroundCapture;
  const settings = await storage.local.get(DEFAULT_SETTINGS);
  return settings.backgroundCapture;
}

async function syncContentScript(scripting, enabled, onError) {
  if (!scripting?.registerContentScripts) return;
  try {
    if (enabled) {
      const registrations = scripting.getRegisteredContentScripts
        ? await scripting.getRegisteredContentScripts({ ids: [BACKGROUND_CAPTURE_SCRIPT_ID] })
        : [];
      if (registrations.length === 0) {
        await scripting.registerContentScripts([BACKGROUND_CAPTURE_SCRIPT]);
      }
      return;
    }
    await scripting.unregisterContentScripts({ ids: [BACKGROUND_CAPTURE_SCRIPT_ID] });
  } catch (error) {
    const expectedMissingRegistration = !enabled
      && /no content script|non-existent|not registered/i.test(error.message);
    const expectedExistingRegistration = enabled
      && /duplicate|already exists/i.test(error.message);
    if (!expectedMissingRegistration && !expectedExistingRegistration) onError(error);
  }
}
