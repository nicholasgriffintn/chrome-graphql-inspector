import { looksGraphQL } from "./graphql.js";
import { appendBounded } from "./collections.js";
import { createBackgroundCaptureSetting } from "./background-capture.js";
import { createCaptureBuffer } from "./capture-buffer.js";
import { createCaptureSession } from "./capture-session.js";
import { BACKGROUND_CAPTURE_SESSION_KEY } from "./settings.js";

const panelPorts = new Map();
const httpRecords = new Map();
const hookInjections = new Map();
const captureTabs = new Set();
let backgroundCaptureEnabled = false;
const HTTP_EVENT_LIMIT = 250;
const HTTP_EVENT_BYTE_LIMIT = 4 * 1024 * 1024;
const BACKGROUND_TAB_LIMIT = 20;
const BACKGROUND_TOTAL_BYTE_LIMIT = 6 * 1024 * 1024;
const REQUEST_BODY_BYTE_LIMIT = 512 * 1024;
const diagnostics = { webRequestAvailable: Boolean(chrome.webRequest), listenerErrors: [] };
let captureBufferHydrated = false;
const hydratingPorts = new Set();
const captureBuffer = createCaptureBuffer({
  maxTabs: BACKGROUND_TAB_LIMIT,
  maxItemsPerTab: HTTP_EVENT_LIMIT,
  maxBytesPerTab: HTTP_EVENT_BYTE_LIMIT,
  maxTotalBytes: BACKGROUND_TOTAL_BYTE_LIMIT,
  isPinned: tabId => panelPorts.has(tabId),
  onEvict: clearPendingRequests,
});
const captureSession = createCaptureSession({
  storage: chrome.storage?.session,
  key: BACKGROUND_CAPTURE_SESSION_KEY,
  buffer: captureBuffer,
  isEnabled: () => backgroundCaptureEnabled,
  onError: message => recordListenerError(`capture-buffer-${message}`),
});

globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__ = () => ({
  ...diagnostics,
  backgroundCaptureEnabled,
  bufferedTabs: Array.from(captureBuffer.entries()).map(([tabId, events]) => ({ tabId, events: events.length })),
  pendingRequests: httpRecords.size,
  connectedPanels: Array.from(panelPorts.entries()).map(([tabId, ports]) => ({ tabId, ports: ports.size }))
});

const backgroundCapture = createBackgroundCaptureSetting({
  extensionApi: chrome,
  onChange: applyBackgroundCapture,
  onError: error => recordListenerError(`background-capture: ${error.message}`),
});
const captureBufferReady = backgroundCapture.ready
  .then(captureSession.restore)
  .finally(() => {
    captureBufferHydrated = true;
  });

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "graphql-panel") return;
  let tabId;
  port.onMessage.addListener(message => {
    if (message.type === "register" && Number.isInteger(message.tabId)) {
      tabId = message.tabId;
      if (!panelPorts.has(tabId)) panelPorts.set(tabId, new Set());
      const shouldEnableCapture = panelPorts.get(tabId).size === 0;
      panelPorts.get(tabId).add(port);
      if (shouldEnableCapture) setCaptureState(tabId, true);
      replayCaptureBuffer(tabId, port);
      return;
    }
    if (
      message.type === "clear-tab-buffer"
      && Number.isInteger(message.tabId)
      && message.tabId === tabId
    ) {
      clearTabData(tabId);
    }
  });
  port.onDisconnect.addListener(() => {
    hydratingPorts.delete(port);
    if (tabId === undefined) return;
    panelPorts.get(tabId)?.delete(port);
    if (!panelPorts.get(tabId)?.size) {
      panelPorts.delete(tabId);
      if (!backgroundCaptureEnabled) {
        clearTabData(tabId);
        setCaptureState(tabId, false);
      } else {
        captureBuffer.enforceLimits();
        captureSession.schedulePersist();
      }
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.source !== "private-graphql-inspector" || !Number.isInteger(sender.tab?.id)) return;
  const tabId = sender.tab.id;
  if (message.type === "content-ready") {
    hookInjections.delete(tabId);
    void backgroundCapture.ready.then(() => {
      if (backgroundCaptureEnabled) {
        captureTabs.add(tabId);
        sendCaptureState(tabId, true);
      } else if (panelPorts.has(tabId)) {
        setCaptureState(tabId, true);
      }
    });
    return;
  }
  if (!shouldCaptureTab(tabId)) return;
  const event = {
    ...message,
    source: "page-hook",
    trust: "page",
    frameId: sender.frameId,
  };
  if (!captureBufferHydrated) {
    emitCaptureEvent(tabId, event);
    return;
  }
  if (message.type?.startsWith("http-request-")) {
    emitCaptureEvent(tabId, event);
    return;
  }
  if (backgroundCaptureEnabled) {
    emitCaptureEvent(tabId, event);
    return;
  }
  for (const port of panelPorts.get(tabId) || []) {
    try {
      port.postMessage(event);
    } catch {}
  }
});

chrome.tabs?.onRemoved?.addListener(tabId => {
  panelPorts.delete(tabId);
  hookInjections.delete(tabId);
  captureTabs.delete(tabId);
  clearTabData(tabId);
});

function clearTabData(tabId) {
  captureBuffer.delete(tabId);
  clearPendingRequests(tabId);
  captureSession.schedulePersist();
}

function replayCaptureBuffer(tabId, port) {
  const replay = () => {
    if (!panelPorts.get(tabId)?.has(port)) return;
    for (const event of captureBuffer.get(tabId) || []) {
      try { port.postMessage(event); } catch {}
    }
  };
  if (captureBufferHydrated) {
    replay();
    return;
  }
  hydratingPorts.add(port);
  void captureBufferReady.then(() => {
    replay();
    hydratingPorts.delete(port);
  });
}

function clearPendingRequests(tabId) {
  for (const [requestId, record] of httpRecords) {
    if (record.tabId === tabId) httpRecords.delete(requestId);
  }
}

async function applyBackgroundCapture(enabled, { initial = false } = {}) {
  backgroundCaptureEnabled = enabled;
  const openTabIds = enabled || !initial ? await getOpenTabIds() : [];
  if (enabled) {
    for (const tabId of openTabIds) setCaptureState(tabId, true);
    return;
  }
  const tabsToDisable = new Set([...captureTabs, ...openTabIds]);
  for (const tabId of tabsToDisable) {
    if (!panelPorts.has(tabId)) setCaptureState(tabId, false);
  }
  for (const tabId of [...captureBuffer.keys()]) {
    if (!panelPorts.has(tabId)) clearTabData(tabId);
  }
  await captureSession.clear();
}

async function getOpenTabIds() {
  try {
    const tabs = await chrome.tabs?.query?.({}) || [];
    return tabs.flatMap(tab => Number.isInteger(tab.id) ? [tab.id] : []);
  } catch (error) {
    recordListenerError(`background-tabs: ${error.message}`);
    return [];
  }
}

function shouldCaptureTab(tabId) {
  return backgroundCaptureEnabled || panelPorts.has(tabId);
}

function setCaptureState(tabId, enabled) {
  if (enabled) captureTabs.add(tabId);
  else captureTabs.delete(tabId);
  if (enabled && chrome.scripting?.executeScript) {
    const injection = hookInjections.get(tabId) || Promise.resolve(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["src/page-hook.js"],
        world: "MAIN",
      }),
    ).catch(error => {
      recordListenerError(`page-hook: ${error.message}`);
      hookInjections.delete(tabId);
    });
    hookInjections.set(tabId, injection);
    void injection.then(() => {
      if (captureTabs.has(tabId)) sendCaptureState(tabId, true);
    });
    return;
  }
  sendCaptureState(tabId, enabled);
}

function sendCaptureState(tabId, enabled) {
  try {
    chrome.tabs?.sendMessage?.(
      tabId,
      { type: "CAPTURE_STATE_CHANGED", enabled },
      () => {
        try { void chrome.runtime.lastError; } catch {}
      }
    );
  } catch {}
}

function recordListenerError(message) {
  appendBounded(diagnostics.listenerErrors, message, 50);
}

try {
  chrome.webRequest.onBeforeRequest.addListener(
    handleBeforeRequest,
    { urls: ["<all_urls>"] },
    ["requestBody"]
  );
} catch (error) {
  recordListenerError(`onBeforeRequest: ${error.message}`);
}

try {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    handleBeforeSendHeaders,
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"]
  );
} catch {
  try {
    chrome.webRequest.onBeforeSendHeaders.addListener(
      handleBeforeSendHeaders,
      { urls: ["<all_urls>"] },
      ["requestHeaders"]
    );
  } catch (error) {
    recordListenerError(`onBeforeSendHeaders: ${error.message}`);
  }
}

function handleBeforeRequest(details) {
  if (!shouldCaptureTab(details.tabId)) {
    if (!backgroundCapture.isEnabled()) {
      void backgroundCapture.ready.then(() => {
        if (shouldCaptureTab(details.tabId)) handleBeforeRequest(details);
      });
    }
    return;
  }
  pruneHttpRecords();
  const requestBody = getWebRequestBody(details);
  const record = {
    requestId: details.requestId,
    tabId: details.tabId,
    url: details.url,
    method: details.method,
    requestBody,
    requestHeaders: [],
    startedAt: details.timeStamp || Date.now()
  };
  if (!looksGraphQL({ url: details.url, method: details.method, postData: requestBody })) return;
  httpRecords.set(details.requestId, record);
  record.emittedStart = true;
  emitCaptureEvent(details.tabId, {
    ...record,
    type: "http-request-start",
    source: "background",
    trust: "extension",
    phase: "start",
  });
}

function handleBeforeSendHeaders(details) {
  if (!shouldCaptureTab(details.tabId)) {
    if (!backgroundCapture.isEnabled()) {
      void backgroundCapture.ready.then(() => {
        if (shouldCaptureTab(details.tabId)) handleBeforeSendHeaders(details);
      });
    }
    return;
  }
  const record = httpRecords.get(details.requestId) || {
    requestId: details.requestId,
    tabId: details.tabId,
    url: details.url,
    method: details.method,
    requestBody: "",
    startedAt: details.timeStamp || Date.now()
  };
  record.requestHeaders = details.requestHeaders || [];
  if (!looksGraphQL({ url: record.url, method: record.method, postData: record.requestBody })) return;
  httpRecords.set(details.requestId, record);
  if (record.emittedStart) return;
  record.emittedStart = true;
  emitCaptureEvent(details.tabId, {
    ...record,
    type: "http-request-start",
    source: "background",
    trust: "extension",
    phase: "start",
  });
}

function emitCaptureEvent(tabId, event) {
  if (tabId < 0) return;
  captureBuffer.append(tabId, event);
  captureSession.schedulePersist();
  for (const port of panelPorts.get(tabId) || []) {
    if (hydratingPorts.has(port)) continue;
    try { port.postMessage(event); } catch {}
  }
}

function getWebRequestBody(details) {
  const body = details.requestBody;
  if (!body) return "";
  if (body.formData) {
    return new URLSearchParams(
      Object.entries(body.formData)
        .flatMap(([key, values]) => (values || [""]).map(value => [key, value])),
    ).toString().slice(0, REQUEST_BODY_BYTE_LIMIT);
  }
  if (!body.raw) return "";
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let result = "";
  for (const part of body.raw) {
    if (!part.bytes || bytesRead >= REQUEST_BODY_BYTE_LIMIT) continue;
    try {
      const bytes = new Uint8Array(part.bytes);
      const chunk = bytes.subarray(0, REQUEST_BODY_BYTE_LIMIT - bytesRead);
      result += decoder.decode(chunk, { stream: true });
      bytesRead += chunk.byteLength;
    } catch {}
  }
  return result + decoder.decode();
}

function pruneHttpRecords() {
  const cutoff = Date.now() - 60000;
  for (const [requestId, record] of httpRecords) {
    if (record.startedAt < cutoff) httpRecords.delete(requestId);
  }
}
