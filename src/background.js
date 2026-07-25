import { looksGraphQL } from "./graphql.js";

const panelPorts = new Map();
const httpRecords = new Map();
const httpEventsByTab = new Map();
const diagnostics = { webRequestAvailable: Boolean(chrome.webRequest), listenerErrors: [], beforeRequestCount: 0, recentRequests: [] };

globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__ = () => ({
  ...diagnostics,
  bufferedTabs: Array.from(httpEventsByTab.entries()).map(([tabId, events]) => ({ tabId, events: events.length })),
  pendingRequests: httpRecords.size,
  connectedPanels: Array.from(panelPorts.entries()).map(([tabId, ports]) => ({ tabId, ports: ports.size }))
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
      for (const event of httpEventsByTab.get(tabId) || []) {
        try { port.postMessage(event); } catch {}
      }
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
    if (tabId === undefined) return;
    panelPorts.get(tabId)?.delete(port);
    if (!panelPorts.get(tabId)?.size) {
      panelPorts.delete(tabId);
      clearTabData(tabId);
      setCaptureState(tabId, false);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.source !== "private-graphql-inspector" || !Number.isInteger(sender.tab?.id)) return;
  if (!panelPorts.has(sender.tab.id)) return;
  if (message.type === "content-ready") setCaptureState(sender.tab.id, true);
  if (message.type?.startsWith("http-request-")) {
    emitHttpEvent(sender.tab.id, { ...message, frameId: sender.frameId });
    return;
  }
  for (const port of panelPorts.get(sender.tab.id) || []) {
    try { port.postMessage({ ...message, frameId: sender.frameId }); } catch {}
  }
});

chrome.tabs?.onRemoved?.addListener(tabId => {
  panelPorts.delete(tabId);
  clearTabData(tabId);
});

function clearTabData(tabId) {
  httpEventsByTab.delete(tabId);
  for (const [requestId, record] of httpRecords) {
    if (record.tabId === tabId) httpRecords.delete(requestId);
  }
}

function setCaptureState(tabId, enabled) {
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

try {
  chrome.webRequest.onBeforeRequest.addListener(
    details => {
      diagnostics.beforeRequestCount += 1;
      diagnostics.recentRequests = diagnostics.recentRequests.concat({ tabId: details.tabId, method: details.method, url: details.url }).slice(-10);
      if (!panelPorts.has(details.tabId)) return;
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
      httpRecords.set(details.requestId, record);
      if (!looksGraphQL({ url: details.url, method: details.method, postData: requestBody })) return;
      record.emittedStart = true;
      emitHttpEvent(details.tabId, { ...record, type: "http-request-start", source: "background", phase: "start" });
    },
    { urls: ["<all_urls>"] },
    ["requestBody"]
  );
} catch (error) {
  diagnostics.listenerErrors.push(`onBeforeRequest: ${error.message}`);
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
    diagnostics.listenerErrors.push(`onBeforeSendHeaders: ${error.message}`);
  }
}

function handleBeforeSendHeaders(details) {
  if (!panelPorts.has(details.tabId)) return;
  const record = httpRecords.get(details.requestId) || {
    requestId: details.requestId,
    tabId: details.tabId,
    url: details.url,
    method: details.method,
    requestBody: "",
    startedAt: details.timeStamp || Date.now()
  };
  record.requestHeaders = details.requestHeaders || [];
  httpRecords.set(details.requestId, record);
  if (!looksGraphQL({ url: record.url, method: record.method, postData: record.requestBody })) return;
  if (record.emittedStart) return;
  record.emittedStart = true;
  emitHttpEvent(details.tabId, { ...record, type: "http-request-start", source: "background", phase: "start" });
}

function emitHttpEvent(tabId, event) {
  if (tabId < 0) return;
  const events = httpEventsByTab.get(tabId) || [];
  events.push(event);
  httpEventsByTab.set(tabId, events.slice(-250));
  for (const port of panelPorts.get(tabId) || []) {
    try { port.postMessage(event); } catch {}
  }
}

function getWebRequestBody(details) {
  const body = details.requestBody;
  if (!body) return "";
  if (body.formData) return new URLSearchParams(Object.entries(body.formData).flatMap(([key, values]) => (values || [""]).map(value => [key, value]))).toString();
  if (!body.raw) return "";
  return body.raw.map(part => {
    if (!part.bytes) return "";
    try { return new TextDecoder().decode(part.bytes); } catch { return ""; }
  }).join("");
}

function pruneHttpRecords() {
  const cutoff = Date.now() - 60000;
  for (const [requestId, record] of httpRecords) {
    if (record.startedAt < cutoff) httpRecords.delete(requestId);
  }
}
