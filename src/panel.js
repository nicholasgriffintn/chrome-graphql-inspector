import { parseGraphQLPayload, looksGraphQL, parseMultipart, formatGraphQLQuery, formatJson, inferOperationName, inferOperationTypeFromHeaders, safeJsonParse } from "./graphql.js";
import { downloadJson, sanitiseOperationsForExport, toCurl, toFetch } from "./exports.js";
import { headersToObject, requestHeadersForReplay } from "./headers.js";
import { appendBounded, prependBounded } from "./collections.js";
import { handleTablistKeydown } from "./tabs.js";
import { renderCode, renderObjectTree, renderRawCode } from "./panel-renderers.js";
import {
  badgeLabel,
  badgeType,
  buildSearchIndex,
  boundedJson,
  escapeHtml,
  filterItems,
  findClosestHttpRecord,
  findEquivalentHttpCapture,
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime,
  getOperationCounts,
  isErrorItem,
  isReplayableItem,
  operationStatusLabel,
  parseOptionalJson,
  shortUrl
} from "./panel-model.js";

const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
const ITEM_LIMIT = 1000;
const STREAM_EVENT_LIMIT = 250;
const TIMELINE_DATA_LIMIT = 10000;
const state = { items: [], selectedId: null, ws: new Map(), http: new Map(), graphiql: new Map(), graphiqlLastResponse: "", preserve: false, diagnostics: { background: 0, network: 0, har: 0 } };
const $ = id => document.getElementById(id);
const els = Object.fromEntries([
  "modeInspector","modeGraphiql","inspectorView","graphiqlView","inspectorActions","captureTotal","captureNumber",
  "search","typeFilter","typeSegments","errorsOnly","preserve","requestCount","resetFilters","clear","exportAll","exportAllSensitive","requestListWrap","requests","empty","queryCount","mutationCount","subscriptionCount","unknownCount","errorCount",
  "noSelection","detail","detailType","detailName","detailEndpoint","detailPersisted","detailMeta","detailStatus","detailDuration","responseState","responseViewToggle","copyResponse","openGraphiql","queryView","variablesView","extensionsView","extensionsSection","responseView","responseRawView","headersView","timingSummary","timelineView","copyCurl","copyCurlSensitive","copyFetch","copyJson","tabs",
  "graphiqlEndpoint","graphiqlMethod","graphiqlUseSelected","graphiqlSend","graphiqlSendLabel","graphiqlOperationName","graphiqlQuery","graphiqlInputTabs","graphiqlVariables","graphiqlHeaders","graphiqlStatus","graphiqlTabs","graphiqlCopyResponse","graphiqlResponse","graphiqlResponseRaw","graphiqlResponseHeaders","toast"
].map(id => [id, $(id)]));

const port = chrome.runtime.connect({ name: "graphql-panel" });
port.postMessage({ type: "register", tabId: inspectedTabId });
port.onMessage.addListener(handleStreamEvent);

const preserveReady = chrome.storage.local.get({ preserve: false })
  .then(({ preserve }) => {
    state.preserve = preserve;
    els.preserve.checked = preserve;
  });
chrome.devtools.network.onNavigated.addListener(() => {
  void preserveReady.then(() => {
    if (!state.preserve) clear({ clearBuffer: true });
  });
});
chrome.devtools.network.onRequestFinished.addListener(captureRequest);
loadHarEntries();
const relativeTimeTimer = setInterval(updateRelativeTimes, 15000);
relativeTimeTimer.unref?.();

async function captureRequest(request) {
  const entry = request.request;
  let responseText = "";
  try { responseText = await getRequestContent(request); } catch {}
  const postData = entry.postData?.text || "";
  if (!looksGraphQL({ url: entry.url, method: entry.method, postData, responseText })) return;
  state.diagnostics.network += 1;
  const startedAt = Date.parse(request.startedDateTime) || Date.now();
  const matched = findMatchingHttpRequest(entry.url, entry.method, postData, startedAt);
  addHttpItems({
    requestId: matched?.requestId || `network:${crypto.randomUUID()}`,
    url: entry.url,
    method: entry.method,
    status: request.response.status,
    startedAt,
    duration: request.time,
    requestHeaders: matched?.requestHeaders?.length ? matched.requestHeaders : entry.headers || [],
    responseHeaders: request.response.headers || [],
    requestBody: matched?.requestBody || postData,
    responseText,
    phase: "complete",
    source: "network"
  });
  if (matched) state.http.delete(matched.requestId);
}

function loadHarEntries() {
  chrome.devtools.network.getHAR(har => {
    let captured = 0;
    for (const entry of har?.entries || []) {
      const request = entry.request || {};
      const response = entry.response || {};
      const postData = request.postData?.text || "";
      const responseText = decodeHarContent(response.content);
      if (!looksGraphQL({ url: request.url, method: request.method, postData, responseText })) continue;
      addHttpItems({
        requestId: `har:${crypto.randomUUID()}`,
        url: request.url,
        method: request.method,
        status: response.status,
        startedAt: Date.parse(entry.startedDateTime) || Date.now(),
        duration: entry.time,
        requestHeaders: request.headers || [],
        responseHeaders: response.headers || [],
        requestBody: postData,
        responseText,
        phase: "complete",
        source: "har"
      }, false);
      captured += 1;
    }
    state.diagnostics.har = captured;
    render();
  });
}

function handleStreamEvent(message) {
  if (message.type?.startsWith("http-request-")) return handleHttpEvent(message);
  if (message.type === "graphiql-result") return handleGraphiqlResult(message);
  if (message.type === "ws-frame") return handleWsFrame(message);
  if (message.type === "ws-close") return handleWsClose(message);
  if (message.type === "sse-message") return handleSseMessage(message);
  if (message.type === "sse-close" || message.type === "sse-error") return handleSseEnd(message);
}

function handleHttpEvent(message) {
  const postData = message.requestBody || "";
  const responseText = message.responseText || "";
  if (!looksGraphQL({ url: message.url, method: message.method, postData, responseText })) return;
  const captureSource = message.source === "background" ? "background" : "hook";
  const requestId = captureSource === "hook" ? `hook:${message.requestId}` : message.requestId;
  if (captureSource === "background") state.diagnostics.background += 1;
  pruneHttpRecords();
  state.http.set(requestId, {
    requestId,
    url: message.url,
    method: message.method,
    requestBody: postData,
    requestHeaders: message.requestHeaders || [],
    startedAt: message.startedAt || message.at,
    source: captureSource
  });
  addHttpItems({
    requestId,
    url: message.url,
    method: message.method,
    status: message.status,
    startedAt: message.startedAt || message.at,
    duration: message.type === "http-request-start" ? null : message.at - (message.startedAt || message.at),
    requestHeaders: message.requestHeaders || [],
    responseHeaders: message.responseHeaders || [],
    requestBody: postData,
    responseText,
    error: message.error,
    phase: message.type === "http-request-start" ? "start" : message.type === "http-request-error" ? "error" : "complete",
    source: captureSource
  });
}

function addHttpItems(event, renderAfter = true) {
  const postData = event.requestBody || "";
  const responseText = event.responseText || "";
  const payloads = parseGraphQLPayload(postData, event.url);
  if (!payloads.length) payloads.push({ query: "", operationName: "GraphQL request", operationType: "unknown", variables: {}, extensions: {} });
  const responseHeaders = event.responseHeaders || [];
  const contentType = responseHeaders.find(header => String(header?.name || "").toLowerCase() === "content-type")?.value || "";
  const multipart = parseMultipart(responseText, contentType);
  const parsedResponse = multipart ?? safeJsonParse(responseText) ?? responseText;
  const headerOperationType = inferOperationTypeFromHeaders(event.requestHeaders);
  const equivalent = findEquivalentHttpCapture(state.items, event);
  const requestId = equivalent?.requestId || event.requestId;

  payloads.forEach((payload, batchIndex) => {
    const id = `http:${requestId}:${batchIndex}`;
    const existing = state.items.find(item => item.id === id);
    const captureSources = [...new Set([
      ...(existing?.captureSources || equivalent?.captureSources || []),
      event.source
    ])];
    const captureIds = {
      ...(existing?.captureIds || equivalent?.captureIds || {}),
      [event.source]: event.requestId
    };
    const item = {
      id,
      requestId,
      source: "http",
      batchIndex,
      batchSize: payloads.length,
      captureSource: event.source,
      captureSources,
      captureIds,
      phase: event.phase,
      error: event.error ?? existing?.error,
      url: event.url,
      method: event.method,
      status: event.status,
      startedAt: event.startedAt,
      duration: event.phase === "start" ? null : event.duration,
      requestHeaders: event.requestHeaders || [],
      responseHeaders,
      requestBody: postData,
      response: Array.isArray(parsedResponse) && payloads.length > 1 && !multipart ? parsedResponse[batchIndex] : parsedResponse,
      responseRaw: responseText,
      timeline: [{ at: event.startedAt, direction: "out", data: summarizeTimelineData(postData) }]
        .concat(event.phase === "start" ? [] : [{ at: event.startedAt + (event.duration || 0), direction: event.phase === "error" ? "error" : "in", data: event.error || summarizeTimelineData(parsedResponse, responseText.length) }]),
      ...payload,
      operationType: payload.operationType === "unknown" ? headerOperationType : payload.operationType
    };
    item.searchIndex = buildSearchIndex(item);
    if (existing) {
      const timeline = mergeTimeline(existing.timeline, item.timeline);
      if (existing.phase !== "start" && event.phase === "start") {
        Object.assign(existing, { captureSources, captureIds, timeline });
      } else {
        Object.assign(existing, item, { timeline });
      }
      existing.searchIndex = buildSearchIndex(existing);
    } else {
      addItem(item, false);
    }
  });
  if (renderAfter) render();
}

function handleWsFrame(message) {
  const frame = safeJsonParse(message.data) ?? message.data;
  const type = frame?.type;
  const opId = frame?.id || "connection";
  const key = `${message.socketId}:${opId}`;
  if (message.direction === "out" && ["subscribe", "start"].includes(type)) {
    const payload = frame.payload || {};
    const op = parseGraphQLPayload(payload)[0] || {};
    const item = { id: `ws:${key}`, source: "ws", url: message.url, method: "WS", status: 101, startedAt: message.at, duration: null, requestHeaders: [], responseHeaders: [], requestBody: message.data, response: [], timeline: [{ at: message.at, direction: "out", data: summarizeTimelineData(frame) }], operationName: op.operationName || `Subscription ${opId}`, operationType: "subscription", query: op.query || "", variables: op.variables || {}, extensions: op.extensions || {} };
    state.ws.set(key, item); addItem(item); return;
  }
  const item = state.ws.get(key) || state.ws.get(`${message.socketId}:connection`);
  if (!item) return;
  appendBounded(item.timeline, { at: message.at, direction: message.direction, data: summarizeTimelineData(frame) }, STREAM_EVENT_LIMIT);
  if (message.direction === "in" && ["next", "data", "error"].includes(type)) {
    appendBounded(item.response, frame.payload ?? frame, STREAM_EVENT_LIMIT);
  }
  if (type === "error") item.error = frame.payload || "Subscription error";
  if (["complete", "stop"].includes(type)) {
    item.duration = message.at - item.startedAt;
    state.ws.delete(key);
  }
  item.searchIndex = buildSearchIndex(item);
  render();
}

function handleWsClose(message) {
  let changed = false;
  for (const [key, item] of state.ws) {
    if (!key.startsWith(`${message.socketId}:`)) continue;
    item.duration = Math.max(0, message.at - item.startedAt);
    appendBounded(item.timeline, { at: message.at, direction: "close", data: { code: message.code, reason: message.reason } }, STREAM_EVENT_LIMIT);
    item.searchIndex = buildSearchIndex(item);
    state.ws.delete(key);
    changed = true;
  }
  if (changed) render();
}

function handleSseMessage(message) {
  const parsed = safeJsonParse(message.data) ?? message.data;
  const id = `sse:${message.sourceId}`;
  let item = state.items.find(x => x.id === id);
  if (!item) {
    item = { id, source: "sse", url: message.url, method: "SSE", status: 200, startedAt: message.at, duration: null, operationName: "SSE subscription", operationType: "subscription", query: "", variables: {}, requestHeaders: [], responseHeaders: [], response: [], timeline: [] };
    addItem(item, false);
  }
  appendBounded(item.response, parsed, STREAM_EVENT_LIMIT);
  appendBounded(item.timeline, { at: message.at, direction: "in", data: summarizeTimelineData(parsed) }, STREAM_EVENT_LIMIT);
  item.searchIndex = buildSearchIndex(item);
  render();
}

function handleSseEnd(message) {
  const item = state.items.find(candidate => candidate.id === `sse:${message.sourceId}`);
  if (!item) return;
  appendBounded(item.timeline, { at: message.at, direction: message.type === "sse-error" ? "error" : "close", data: message.type }, STREAM_EVENT_LIMIT);
  if (message.type === "sse-close" || message.readyState === 2) item.duration = Math.max(0, message.at - item.startedAt);
  if (message.type === "sse-error" && message.readyState === 2) item.error = "EventSource closed after an error.";
  item.searchIndex = buildSearchIndex(item);
  render();
}

function addItem(item, renderAfter = true) {
  const evictedItems = prependBounded(state.items, item, ITEM_LIMIT);
  for (const evicted of evictedItems) {
    for (const [key, activeItem] of state.ws) {
      if (activeItem === evicted) state.ws.delete(key);
    }
  }
  state.selectedId ||= item.id;
  if (renderAfter) render();
}
function clear({ clearBuffer = false } = {}) {
  if (clearBuffer) {
    port.postMessage({
      type: "clear-tab-buffer",
      tabId: inspectedTabId
    });
  }
  state.items = [];
  state.ws.clear();
  state.http.clear();
  state.diagnostics = { background: 0, network: 0, har: 0 };
  state.selectedId = null;
  render({ resetScroll: true });
}
function selected() { return state.items.find(x => x.id === state.selectedId); }
function getRequestContent(request) {
  return new Promise(resolve => {
    request.getContent((content, encoding) => {
      if (encoding === "base64") {
        try { resolve(atob(content || "")); } catch { resolve(content || ""); }
        return;
      }
      resolve(content || "");
    });
  });
}
function decodeHarContent(content = {}) {
  if (!content.text) return "";
  if (content.encoding === "base64") {
    try { return atob(content.text); } catch { return content.text; }
  }
  return content.text;
}
function findMatchingHttpRequest(url, method, requestBody, startedAt) {
  return findClosestHttpRecord(state.http.values(), {
    url,
    method,
    requestBody,
    startedAt,
  });
}
function pruneHttpRecords() {
  const cutoff = Date.now() - 60000;
  for (const [requestId, record] of state.http) {
    if (record.startedAt < cutoff) state.http.delete(requestId);
  }
}
function mergeTimeline(current = [], next = []) {
  const seen = new Set();
  return [...current, ...next].filter(entry => {
    const key = `${entry.at}:${entry.direction}:${entry.data?.summary || boundedJson(entry.data)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeTimelineData(value, rawLength) {
  const text = typeof value === "string" ? value : boundedJson(value, Number.MAX_SAFE_INTEGER);
  const size = Number.isInteger(rawLength) ? rawLength : text.length;
  if (size <= TIMELINE_DATA_LIMIT) return value;
  return {
    summary: `Payload omitted from timeline (${size.toLocaleString()} characters).`,
    size,
    preview: text.slice(0, 1000)
  };
}
function visibleItems() {
  return filterItems(state.items, {
    search: els.search.value,
    type: els.typeFilter.value,
    errorsOnly: els.errorsOnly.checked
  });
}

function render({ resetScroll = false } = {}) {
  const items = visibleItems();
  if (!items.some(item => item.id === state.selectedId)) state.selectedId = items[0]?.id ?? null;
  const counts = getOperationCounts(state.items);
  const scrollTop = resetScroll ? 0 : els.requestListWrap.scrollTop;

  els.captureNumber.textContent = state.items.length;
  els.requestCount.textContent = `${items.length}/${state.items.length}`;
  els.queryCount.textContent = counts.query;
  els.mutationCount.textContent = counts.mutation;
  els.subscriptionCount.textContent = counts.subscription;
  els.unknownCount.textContent = counts.unknown;
  els.errorCount.textContent = counts.errors;
  els.resetFilters.disabled = !els.search.value && els.typeFilter.value === "all" && !els.errorsOnly.checked;
  els.clear.disabled = state.items.length === 0;
  els.exportAll.disabled = items.length === 0;
  els.exportAllSensitive.disabled = items.length === 0;
  els.graphiqlUseSelected.disabled = !isReplayableItem(selected());

  for (const button of els.typeSegments.querySelectorAll("[data-type-filter]")) {
    const active = button.dataset.typeFilter === els.typeFilter.value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const button of document.querySelectorAll("[data-summary-filter]")) {
    const active = button.dataset.summaryFilter === els.typeFilter.value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  els.empty.hidden = items.length > 0;
  renderEmptyState();
  els.requests.replaceChildren(...items.map(item => {
    const div = document.createElement("div");
    const error = isErrorItem(item);
    const selectedRow = item.id === state.selectedId;
    div.className = `request${item.id === state.selectedId ? " selected" : ""}${error ? " error" : ""}`;
    div.role = "option";
    div.tabIndex = selectedRow ? 0 : -1;
    div.dataset.requestId = item.id;
    div.setAttribute("aria-selected", String(selectedRow));
    div.innerHTML = `
      <span class="badge ${badgeType(item)}">${escapeHtml(badgeLabel(item))}</span>
      <span class="request-main">
        <span class="operation" title="${escapeHtml(item.operationName)}">${escapeHtml(item.operationName)}</span>
        <span class="endpoint" title="${escapeHtml(item.url)}">${escapeHtml(shortUrl(item.url))}</span>
      </span>
      <span class="request-meta">
        <span class="request-status">${escapeHtml(operationStatusLabel(item))}</span>
        <span>${escapeHtml(formatDuration(item.duration))}</span>
        <span class="request-time" data-started-at="${escapeHtml(String(item.startedAt))}">${escapeHtml(formatRelativeTime(item.startedAt))}</span>
      </span>`;
    div.onclick = () => selectRequest(item.id);
    div.onkeydown = event => handleRequestKeydown(event, items, item.id);
    return div;
  }));
  els.requestListWrap.scrollTop = scrollTop;
  renderDetail();
}

function selectRequest(itemId) {
  state.selectedId = itemId;
  for (const request of els.requests.children) {
    const selected = request.dataset.requestId === itemId;
    request.classList.toggle("selected", selected);
    request.setAttribute("aria-selected", String(selected));
    request.tabIndex = selected ? 0 : -1;
  }
  renderDetail();
}

function renderEmptyState() {
  if (els.empty.hidden) return;
  const icon = document.createElement("img");
  icon.className = "empty-icon";
  icon.src = "../icons/icon48.png";
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  const title = document.createElement("strong");
  const message = document.createElement("span");
  const { background, network, har } = state.diagnostics;
  if (state.items.length) {
    title.textContent = "No matching operations";
    message.textContent = `${state.items.length} captured · background ${background} · network ${network} · HAR ${har}`;
  } else if (background || network || har) {
    title.textContent = "Traffic detected";
    message.textContent = `No request payload is ready yet · background ${background} · network ${network} · HAR ${har}`;
  } else {
    title.textContent = "No GraphQL traffic yet";
    message.textContent = "Run an operation or reload the inspected page.";
  }
  els.empty.replaceChildren(icon, title, message);
}

function renderDetail() {
  const item = selected();
  els.noSelection.hidden = Boolean(item);
  els.detail.hidden = !item;
  if (!item) return;

  const error = isErrorItem(item);
  const responsePending = item.phase === "start"
    || (item.status === undefined && !item.error && item.duration === null);
  const statusLabel = operationStatusLabel(item);
  const replayable = isReplayableItem(item);
  els.detailType.className = `badge ${badgeType(item)}`;
  els.detailType.textContent = badgeLabel(item);
  els.detailName.textContent = item.operationName;
  els.detailEndpoint.textContent = item.url;
  els.detailEndpoint.title = item.url;
  els.detailPersisted.hidden = !item.persisted;
  els.detailMeta.textContent = `${item.operationType} • ${item.method} • ${statusLabel} • ${item.url}${item.batchSize > 1 ? ` • batch ${item.batchIndex + 1}/${item.batchSize}` : ""}`;
  els.detailStatus.textContent = statusLabel;
  els.detailStatus.classList.toggle("error", error);
  els.detailDuration.textContent = formatDuration(item.duration);
  els.responseState.textContent = responsePending
    ? "Waiting for response"
    : statusLabel === "failed"
      ? "Request failed"
      : error
        ? "Response contains errors"
        : "OK";
  els.responseState.classList.toggle("error", error);
  els.copyResponse.disabled = responsePending;
  els.openGraphiql.disabled = !replayable;
  els.copyCurl.disabled = item.source !== "http";
  els.copyCurlSensitive.disabled = item.source !== "http";
  els.copyFetch.disabled = item.source !== "http";
  renderCode(els.queryView, item.query ? formatGraphQLQuery(item.query) : (item.persisted ? item.extensions : "No query text captured."));
  renderCode(els.variablesView, item.variables ?? {});
  const hasExtensions = item.extensions && Object.keys(item.extensions).length > 0;
  els.extensionsSection.hidden = !hasExtensions;
  if (hasExtensions) renderCode(els.extensionsView, item.extensions);
  const response = item.response || (item.error ? { error: item.error } : "No response captured.");
  renderObjectTree(els.responseView, response);
  renderRawCode(els.responseRawView, item.responseRaw || response);
  renderCode(els.headersView, {
    request: headersToObject(item.requestHeaders),
    response: headersToObject(item.responseHeaders)
  });
  renderTimingSummary(item);
  renderRawCode(els.timelineView, item.timeline || [{ at: item.startedAt, duration: item.duration }]);
}

function renderTimingSummary(item) {
  const cards = [
    ["Started", formatAbsoluteTime(item.startedAt)],
    ["Duration", formatDuration(item.duration)],
    ["Transport", item.method || item.source?.toUpperCase() || "Unknown"],
    ["Capture source", item.captureSources?.join(" + ") || item.captureSource || item.source || "Unknown"]
  ];
  els.timingSummary.replaceChildren(...cards.map(([label, value]) => {
    const card = document.createElement("div");
    card.className = "timing-card";
    const name = document.createElement("span");
    name.textContent = label;
    const detail = document.createElement("strong");
    detail.textContent = value;
    detail.title = value;
    card.append(name, detail);
    return card;
  }));
}

function handleRequestKeydown(event, items, itemId) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectRequest(itemId);
    focusSelectedRequest();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = items.findIndex(item => item.id === itemId);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : Math.min(items.length - 1, Math.max(0, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
  selectRequest(items[nextIndex]?.id ?? itemId);
  focusSelectedRequest();
}

function focusSelectedRequest() {
  queueMicrotask(() => {
    const request = Array.from(els.requests.children).find(element => element.dataset.requestId === state.selectedId);
    request?.focus();
  });
}

function updateRelativeTimes() {
  for (const element of document.querySelectorAll("[data-started-at]")) {
    element.textContent = formatRelativeTime(Number(element.dataset.startedAt));
  }
}

function setMode(mode) {
  const graphiql = mode === "graphiql";
  els.modeInspector.classList.toggle("active", !graphiql);
  els.modeGraphiql.classList.toggle("active", graphiql);
  els.modeInspector.setAttribute("aria-selected", String(!graphiql));
  els.modeGraphiql.setAttribute("aria-selected", String(graphiql));
  els.modeInspector.tabIndex = graphiql ? -1 : 0;
  els.modeGraphiql.tabIndex = graphiql ? 0 : -1;
  els.inspectorView.hidden = graphiql;
  els.graphiqlView.hidden = !graphiql;
  els.inspectorActions.hidden = graphiql;
  if (graphiql && selected()) populateGraphiqlFromSelected(false);
}

function populateGraphiqlFromSelected(overwrite = true) {
  const item = selected();
  if (!isReplayableItem(item)) return;
  if (overwrite || !els.graphiqlEndpoint.value) els.graphiqlEndpoint.value = item.url;
  if (overwrite || !els.graphiqlQuery.value) els.graphiqlQuery.value = formatGraphQLQuery(item.query || "");
  if (overwrite || !els.graphiqlVariables.value) els.graphiqlVariables.value = formatJson(item.variables || {});
  if (overwrite || !els.graphiqlOperationName.value) els.graphiqlOperationName.value = inferOperationName(item.query);
  if (overwrite || !els.graphiqlHeaders.value) {
    els.graphiqlHeaders.value = formatJson(requestHeadersForReplay(
      item.requestHeaders,
      { includeJsonContentType: String(item.method).toUpperCase() !== "GET" },
    ));
  }
}

function sendGraphiqlRequest() {
  const startedAt = performance.now();
  const url = els.graphiqlEndpoint.value.trim();
  const query = els.graphiqlQuery.value.trim();
  if (!url || !query) {
    renderGraphiqlError("Endpoint and query are required.");
    return;
  }
  let variables;
  let headers;
  const method = els.graphiqlMethod.value;
  try {
    variables = parseOptionalJson(els.graphiqlVariables.value, "Variables");
    const parsedHeaders = parseOptionalJson(els.graphiqlHeaders.value, "Headers");
    headers = requestHeadersForReplay(
      Object.entries(parsedHeaders).map(([name, value]) => ({ name, value })),
      { includeJsonContentType: method !== "GET" },
    );
  } catch (error) {
    renderGraphiqlError(error.message);
    return;
  }

  setGraphiqlSending(true);
  state.graphiqlLastResponse = "";
  els.graphiqlCopyResponse.disabled = true;
  els.graphiqlResponse.classList.remove("graphiql-response-empty");
  els.graphiqlStatus.textContent = "Sending…";
  els.graphiqlStatus.className = "";
  renderObjectTree(els.graphiqlResponse, {});
  renderCode(els.graphiqlResponseRaw, "");
  renderCode(els.graphiqlResponseHeaders, {});

  const payload = {
    url,
    method,
    query,
    variables,
    operationName: els.graphiqlOperationName.value.trim() || undefined,
    headers
  };
  const graphiqlRequestId = crypto.randomUUID();
  const timeout = setTimeout(() => {
    if (!state.graphiql.has(graphiqlRequestId)) return;
    state.graphiql.delete(graphiqlRequestId);
    renderGraphiqlError({
      message: "No GraphQLi response was received from the inspected page.",
      detail: "The page script did not report a result. Refresh the inspected page and check that the extension bridge has not been invalidated."
    });
  }, 10000);
  timeout.unref?.();
  state.graphiql.set(graphiqlRequestId, { startedAt, timeout });

  const executionPayload = { graphiqlRequestId, ...payload };
  const expression = `(${executeGraphiqlFetch.toString()})(${JSON.stringify(executionPayload)})`;
  chrome.devtools.inspectedWindow.eval(expression, (_, exceptionInfo) => {
    if (exceptionInfo?.isException) {
      const pending = state.graphiql.get(graphiqlRequestId);
      if (pending) clearTimeout(pending.timeout);
      state.graphiql.delete(graphiqlRequestId);
      renderGraphiqlError({
        message: "Unable to send GraphQLi request to the inspected page.",
        detail: exceptionInfo.value || exceptionInfo.description || "DevTools evaluation failed."
      });
    }
  });
}

function executeGraphiqlFetch(payload) {
  const startedAt = Date.now();
  const emit = result => window.postMessage({
    source: "private-graphql-inspector",
    type: "graphiql-result",
    graphiqlRequestId: payload.graphiqlRequestId,
    duration: Date.now() - startedAt,
    at: Date.now(),
    ...result
  }, "*");

  (async () => {
    try {
      const requestBody = {
        query: payload.query,
        variables: payload.variables && Object.keys(payload.variables).length ? payload.variables : undefined,
        operationName: payload.operationName || undefined
      };
      const init = {
        method: payload.method,
        credentials: "include",
        headers: payload.headers || {}
      };
      let url = payload.url;
      if (payload.method === "GET") {
        const target = new URL(url, location.href);
        target.searchParams.set("query", payload.query);
        if (requestBody.operationName) target.searchParams.set("operationName", requestBody.operationName);
        if (requestBody.variables) target.searchParams.set("variables", JSON.stringify(requestBody.variables));
        url = target.href;
      } else {
        init.body = JSON.stringify(requestBody);
      }
      const fetchImpl = window.__PRIVATE_GRAPHQL_INSPECTOR_NATIVE_FETCH__ || window.fetch.bind(window);
      const response = await fetchImpl(url, init);
      const responseText = await response.text();
      const text = responseText.slice(0, 1_000_000);
      emit({
        ok: true,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        text
      });
    } catch (error) {
      emit({
        ok: false,
        method: payload.method,
        url: payload.url,
        error: {
          name: error?.name || "Error",
          message: error?.message || String(error),
          stack: error?.stack || ""
        }
      });
    }
  })();
}

function handleGraphiqlResult(message) {
  const pending = state.graphiql.get(message.graphiqlRequestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  state.graphiql.delete(message.graphiqlRequestId);
  if (!message.ok) {
    renderGraphiqlError({
      message: message.error?.message || "GraphQLi request failed.",
      name: message.error?.name,
      method: message.method,
      url: message.url,
      stack: message.error?.stack,
      duration: message.duration
    });
    return;
  }
  const parsed = safeJsonParse(message.text) ?? message.text;
  state.graphiqlLastResponse = message.text || "";
  els.graphiqlCopyResponse.disabled = !state.graphiqlLastResponse;
  setGraphiqlSending(false);
  els.graphiqlStatus.textContent = `${message.status} ${message.statusText || ""} • ${message.duration ?? Math.round(performance.now() - pending.startedAt)} ms`;
  els.graphiqlStatus.className = message.status >= 400 ? "error" : "success";
  renderObjectTree(els.graphiqlResponse, parsed || "No response body.");
  renderRawCode(els.graphiqlResponseRaw, message.text || "No response body.");
  renderCode(els.graphiqlResponseHeaders, { url: message.url, ...message.headers });
}

function renderGraphiqlError(error) {
  const details = typeof error === "string" ? { message: error } : error;
  state.graphiqlLastResponse = JSON.stringify({ error: details }, null, 2);
  els.graphiqlCopyResponse.disabled = false;
  els.graphiqlResponse.classList.remove("graphiql-response-empty");
  setGraphiqlSending(false);
  els.graphiqlStatus.textContent = "Error";
  els.graphiqlStatus.className = "error";
  renderObjectTree(els.graphiqlResponse, { error: details });
  renderCode(els.graphiqlResponseRaw, { error: details });
  renderCode(els.graphiqlResponseHeaders, {});
}

function setGraphiqlSending(sending) {
  els.graphiqlSend.disabled = sending;
  els.graphiqlSendLabel.textContent = sending ? "Sending…" : "Send request";
}

let toastTimer;
async function copy(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("Unable to copy to the clipboard", true);
  }
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("error", error);
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 1800);
  toastTimer.unref?.();
}

function closeActionMenu() {
  const menu = els.copyCurl.closest("details");
  if (menu) menu.open = false;
}

function confirmSensitiveExport() {
  return confirm(
    "This export can contain cookies, authorisation tokens and private application data. Continue?"
  );
}

function downloadOperations(items) {
  downloadJson(
    `graphql-inspector-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,
    items
  );
}

els.search.oninput = () => render({ resetScroll: true });
els.typeFilter.onchange = () => render({ resetScroll: true });
els.errorsOnly.onchange = () => render({ resetScroll: true });
els.preserve.onchange = () => { state.preserve = els.preserve.checked; chrome.storage.local.set({ preserve: state.preserve }); };
els.resetFilters.onclick = () => { els.search.value = ""; els.typeFilter.value = "all"; els.errorsOnly.checked = false; render({ resetScroll: true }); };
els.clear.onclick = () => clear({ clearBuffer: true });
els.exportAll.onclick = () => {
  downloadOperations(sanitiseOperationsForExport(visibleItems()));
  els.exportAll.closest("details").open = false;
  showToast("Exported without credential headers");
};
els.exportAllSensitive.onclick = () => {
  if (!confirmSensitiveExport()) return;
  downloadOperations(visibleItems());
  els.exportAllSensitive.closest("details").open = false;
};
els.copyCurl.onclick = () => { if (selected()) copy(toCurl(selected()), "cURL copied"); closeActionMenu(); };
els.copyCurlSensitive.onclick = () => {
  if (selected() && confirmSensitiveExport()) {
    copy(toCurl(selected(), { includeSensitiveHeaders: true }), "cURL with credentials copied");
  }
  closeActionMenu();
};
els.copyFetch.onclick = () => { if (selected()) copy(toFetch(selected()), "Fetch request copied"); closeActionMenu(); };
els.copyJson.onclick = () => {
  if (selected()) {
    copy(
      JSON.stringify(sanitiseOperationsForExport([selected()])[0], null, 2),
      "Redacted operation JSON copied"
    );
  }
  closeActionMenu();
};
els.copyResponse.onclick = () => {
  const item = selected();
  if (!item) return;
  const response =
    item.responseRaw ||
    JSON.stringify(
      item.response ?? (item.error ? { error: item.error } : ""),
      null,
      2,
    );
  copy(response, "Response copied");
};
els.openGraphiql.onclick = () => {
  populateGraphiqlFromSelected(true);
  setMode("graphiql");
  closeActionMenu();
};
els.modeInspector.onclick = () => setMode("inspector");
els.modeGraphiql.onclick = () => setMode("graphiql");
els.modeInspector.parentElement.onkeydown = handleTablistKeydown;
els.graphiqlUseSelected.onclick = () => populateGraphiqlFromSelected(true);
els.graphiqlSend.onclick = sendGraphiqlRequest;
els.graphiqlView.onkeydown = event => {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey) || els.graphiqlSend.disabled) return;
  event.preventDefault();
  sendGraphiqlRequest();
};
els.graphiqlCopyResponse.onclick = () => {
  if (state.graphiqlLastResponse) copy(state.graphiqlLastResponse, "GraphQLi response copied");
};
els.typeSegments.onclick = event => {
  const button = event.target.closest("[data-type-filter]");
  if (!button) return;
  els.typeFilter.value = button.dataset.typeFilter;
  render({ resetScroll: true });
};
for (const button of document.querySelectorAll("[data-summary-filter]")) {
  button.onclick = () => {
    els.typeFilter.value = els.typeFilter.value === button.dataset.summaryFilter
      ? "all"
      : button.dataset.summaryFilter;
    render({ resetScroll: true });
  };
}
els.responseViewToggle.onclick = event => {
  const button = event.target.closest("[data-response-view]");
  if (!button) return;
  const raw = button.dataset.responseView === "raw";
  els.responseView.hidden = raw;
  els.responseRawView.hidden = !raw;
  for (const viewButton of els.responseViewToggle.querySelectorAll("button")) {
    const active = viewButton === button;
    viewButton.classList.toggle("active", active);
    viewButton.setAttribute("aria-pressed", String(active));
  }
};
els.graphiqlInputTabs.onclick = event => {
  const button = event.target.closest("[data-graphiql-input-tab]");
  if (!button) return;
  for (const tab of els.graphiqlInputTabs.querySelectorAll("button")) {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of els.graphiqlView.querySelectorAll(".input-tab-panel")) {
    panel.hidden = panel.id !== `graphiql-input-${button.dataset.graphiqlInputTab}`;
  }
};
els.graphiqlInputTabs.onkeydown = handleTablistKeydown;
els.tabs.onclick = event => {
  const button = event.target.closest("button[data-tab]"); if (!button) return;
  for (const b of els.tabs.querySelectorAll("button")) {
    const active = b === button;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
    b.tabIndex = active ? 0 : -1;
  }
  for (const panel of els.detail.querySelectorAll(".tab-panel")) panel.hidden = panel.id !== `tab-${button.dataset.tab}`;
};
els.tabs.onkeydown = handleTablistKeydown;
els.graphiqlTabs.onclick = event => {
  const button = event.target.closest("button[data-graphiql-tab]"); if (!button) return;
  for (const b of els.graphiqlTabs.querySelectorAll("button")) {
    const active = b === button;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
    b.tabIndex = active ? 0 : -1;
  }
  for (const panel of els.graphiqlView.querySelectorAll(".tab-panel")) panel.hidden = panel.id !== `graphiql-tab-${button.dataset.graphiqlTab}`;
};
els.graphiqlTabs.onkeydown = handleTablistKeydown;
document.addEventListener("keydown", event => {
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (event.key === "/" && !editing && !els.inspectorView.hidden) {
    event.preventDefault();
    els.search.focus();
    return;
  }
  if (event.key === "Escape" && document.activeElement === els.search && els.search.value) {
    els.search.value = "";
    render({ resetScroll: true });
  }
});
render();
