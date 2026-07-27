import { appendWithinBudget, estimateValueBytes } from "./collections.js";

export function createCaptureBuffer({
  maxTabs,
  maxItemsPerTab,
  maxBytesPerTab,
  maxTotalBytes,
  isPinned = () => false,
  onEvict = () => {},
}) {
  const eventsByTab = new Map();
  const bytesByTab = new Map();

  function append(tabId, event) {
    ensureTabCapacity(tabId);
    const events = eventsByTab.get(tabId) || [];
    appendWithinBudget(events, event, {
      maxItems: maxItemsPerTab,
      maxBytes: maxBytesPerTab,
    });
    eventsByTab.set(tabId, events);
    bytesByTab.set(
      tabId,
      events.reduce((total, value) => total + estimateValueBytes(value), 0),
    );
    enforceTotalByteLimit();
  }

  function deleteTab(tabId, notify = true) {
    const deleted = eventsByTab.delete(tabId);
    bytesByTab.delete(tabId);
    if (deleted && notify) onEvict(tabId);
  }

  function ensureTabCapacity(tabId) {
    if (eventsByTab.has(tabId) || isPinned(tabId)) return;
    const unpinnedTabs = [...eventsByTab.keys()].filter(id => !isPinned(id));
    if (unpinnedTabs.length >= maxTabs) deleteTab(unpinnedTabs[0]);
  }

  function enforceTotalByteLimit() {
    const unpinnedTabs = [...bytesByTab.entries()]
      .filter(([tabId]) => !isPinned(tabId));
    let totalBytes = unpinnedTabs.reduce((total, [, bytes]) => total + bytes, 0);
    for (const [tabId, bytes] of unpinnedTabs) {
      if (totalBytes <= maxTotalBytes) return;
      deleteTab(tabId);
      totalBytes -= bytes;
    }
  }

  function enforceLimits() {
    const unpinnedTabs = [...eventsByTab.keys()].filter(id => !isPinned(id));
    for (let index = 0; index < unpinnedTabs.length - maxTabs; index += 1) {
      deleteTab(unpinnedTabs[index]);
    }
    enforceTotalByteLimit();
  }

  function restore(snapshot) {
    if (!Array.isArray(snapshot)) return;
    const current = [...eventsByTab.entries()];
    eventsByTab.clear();
    bytesByTab.clear();
    for (const entry of [...snapshot, ...current]) {
      if (!Array.isArray(entry) || !Number.isInteger(entry[0]) || !Array.isArray(entry[1])) {
        continue;
      }
      for (const event of entry[1]) {
        if (event && typeof event === "object") append(entry[0], event);
      }
    }
  }

  return Object.freeze({
    append,
    delete: tabId => deleteTab(tabId, false),
    enforceLimits,
    entries: () => eventsByTab.entries(),
    get: tabId => eventsByTab.get(tabId),
    keys: () => eventsByTab.keys(),
    restore,
    snapshot: () => [...eventsByTab.entries()],
  });
}
