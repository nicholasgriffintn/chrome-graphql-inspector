import { parseGraphQLPayload, looksGraphQL, parseMultipart, formatJson, hasGraphQLErrors, safeJsonParse } from "./graphql.js";
import { toCurl, toFetch, downloadJson } from "./exports.js";

const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
const TREE_CHILD_LIMIT = 200;
const RAW_PREVIEW_LIMIT = 200000;
const SEARCH_FIELD_LIMIT = 50000;
const TIMELINE_DATA_LIMIT = 10000;
const state = { items: [], selectedId: null, ws: new Map(), http: new Map(), graphiql: new Map(), preserve: false, diagnostics: { background: 0, network: 0, har: 0 } };
const $ = id => document.getElementById(id);
const els = Object.fromEntries([
  "modeInspector","modeGraphiql","inspectorView","graphiqlView",
  "search","typeFilter","errorsOnly","preserve","requestCount","resetFilters","clear","exportAll","requests","empty","noSelection","detail","detailName","detailMeta","queryView","variablesView","responseView","responseRawView","headersView","timelineView","copyCurl","copyFetch","copyJson","tabs",
  "graphiqlEndpoint","graphiqlMethod","graphiqlUseSelected","graphiqlSend","graphiqlOperationName","graphiqlQuery","graphiqlVariables","graphiqlHeaders","graphiqlStatus","graphiqlTabs","graphiqlResponse","graphiqlResponseRaw","graphiqlResponseHeaders"
].map(id => [id, $(id)]));

const port = chrome.runtime.connect({ name: "graphql-panel" });
port.postMessage({ type: "register", tabId: inspectedTabId });
port.onMessage.addListener(handleStreamEvent);

chrome.storage.local.get({ preserve: false }).then(({ preserve }) => { state.preserve = preserve; els.preserve.checked = preserve; });
chrome.devtools.network.onNavigated.addListener(() => { if (!state.preserve) clear(); });
chrome.devtools.network.onRequestFinished.addListener(captureRequest);
loadHarEntries();

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
      });
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
  if (message.type === "sse-message") {
    const parsed = safeJsonParse(message.data) ?? message.data;
    const id = `sse:${message.sourceId}`;
    let item = state.items.find(x => x.id === id);
    if (!item) {
      item = { id, source: "sse", url: message.url, method: "SSE", status: 200, startedAt: message.at, duration: null, operationName: "SSE subscription", operationType: "subscription", query: "", variables: {}, requestHeaders: [], responseHeaders: [], response: [], timeline: [] };
      addItem(item);
    }
    item.response.push(parsed); item.timeline.push({ at: message.at, direction: "in", data: summarizeTimelineData(parsed) }); render();
  }
}

function handleHttpEvent(message) {
  const postData = message.requestBody || "";
  const responseText = message.responseText || "";
  if (!looksGraphQL({ url: message.url, method: message.method, postData, responseText })) return;
  const requestId = message.source === "private-graphql-inspector" ? `hook:${message.requestId}` : message.requestId;
  if (message.source === "background") state.diagnostics.background += 1;
  pruneHttpRecords();
  state.http.set(requestId, {
    requestId,
    url: message.url,
    method: message.method,
    requestBody: postData,
    requestHeaders: message.requestHeaders || [],
    startedAt: message.startedAt || message.at
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
    source: message.source === "background" ? "background" : "hook"
  });
}

function addHttpItems(event) {
  const postData = event.requestBody || "";
  const responseText = event.responseText || "";
  const payloads = parseGraphQLPayload(postData, event.url);
  if (!payloads.length) payloads.push({ query: "", operationName: "GraphQL request", operationType: "unknown", variables: {}, extensions: {} });
  const responseHeaders = event.responseHeaders || [];
  const contentType = responseHeaders.find(h => h.name.toLowerCase() === "content-type")?.value || "";
  const multipart = parseMultipart(responseText, contentType);
  const parsedResponse = multipart ?? safeJsonParse(responseText) ?? responseText;

  payloads.forEach((payload, batchIndex) => {
    const id = `http:${event.requestId}:${batchIndex}`;
    const existing = state.items.find(item => item.id === id);
    const item = {
      id,
      source: "http",
      batchIndex,
      batchSize: payloads.length,
      captureSource: event.source,
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
      ...payload
    };
    item.searchIndex = buildSearchIndex(item);
    if (existing) {
      Object.assign(existing, item, { timeline: mergeTimeline(existing.timeline, item.timeline) });
      render();
    } else {
      addItem(item);
    }
  });
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
  item.timeline.push({ at: message.at, direction: message.direction, data: summarizeTimelineData(frame) });
  if (message.direction === "in" && ["next", "data", "error"].includes(type)) item.response.push(frame.payload ?? frame);
  if (["complete", "stop"].includes(type)) item.duration = message.at - item.startedAt;
  render();
}

function addItem(item) { state.items.unshift(item); state.selectedId ||= item.id; render(); }
function clear() { state.items = []; state.ws.clear(); state.http.clear(); state.diagnostics = { background: 0, network: 0, har: 0 }; state.selectedId = null; render(); }
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
  return Array.from(state.http.values()).find(record =>
    record.url === url &&
    record.method === method &&
    (!record.requestBody || !requestBody || record.requestBody === requestBody) &&
    Math.abs(record.startedAt - startedAt) < 10000
  );
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
function hasCapturedHttpRequest(url, method, requestBody, startedAt) {
  return state.items.some(item =>
    item.source === "http" &&
    item.url === url &&
    item.method === method &&
    (!item.requestBody || !requestBody || item.requestBody === requestBody) &&
    Math.abs(item.startedAt - startedAt) < 10000
  );
}
function visibleItems() {
  const search = els.search.value.trim().toLowerCase();
  return state.items.filter(item => {
    if (els.typeFilter.value !== "all" && item.operationType !== els.typeFilter.value) return false;
    if (els.errorsOnly.checked && !(item.status >= 400 || hasGraphQLErrors(item.response))) return false;
    if (!search) return true;
    item.searchIndex ||= buildSearchIndex(item);
    return item.searchIndex.includes(search);
  });
}

function buildSearchIndex(item) {
  return [
    item.operationName,
    item.operationType,
    item.method,
    item.status,
    item.url,
    item.query,
    boundedJson(item.variables),
    boundedJson(item.extensions),
    boundedText(item.responseRaw),
    boundedJson(item.response)
  ].filter(value => value !== undefined && value !== null && value !== "").join("\n").toLowerCase();
}

function boundedJson(value, limit = SEARCH_FIELD_LIMIT) {
  try { return boundedText(JSON.stringify(value), limit); } catch { return ""; }
}

function boundedText(value, limit = SEARCH_FIELD_LIMIT) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > limit ? text.slice(0, limit) : text;
}

function render() {
  const items = visibleItems();
  els.requestCount.textContent = `${items.length}/${state.items.length}`;
  els.empty.hidden = items.length > 0;
  els.empty.textContent = emptyMessage();
  els.requests.replaceChildren(...items.map(item => {
    const div = document.createElement("div");
    div.className = `request row${item.id === state.selectedId ? " selected" : ""}`;
    div.role = "option";
    div.tabIndex = 0;
    div.setAttribute("aria-selected", item.id === state.selectedId ? "true" : "false");
    const error = item.status >= 400 || hasGraphQLErrors(item.response);
    const badgeClass = badgeType(item);
    div.innerHTML = `<span class="status ${error ? "error" : ""}">${escapeHtml(String(item.status ?? "—"))}</span><span class="operation" title="${escapeHtml(item.operationName)}">${escapeHtml(item.operationName)}</span><span class="badge ${badgeClass}">${escapeHtml(item.operationType)}</span><span>${item.duration == null ? "live" : `${Math.round(item.duration)} ms`}</span><span class="endpoint" title="${escapeHtml(item.url)}">${escapeHtml(shortUrl(item.url))}</span>`;
    div.onclick = () => { state.selectedId = item.id; render(); };
    return div;
  }));
  renderDetail();
}

function emptyMessage() {
  const { background, network, har } = state.diagnostics;
  if (state.items.length) {
    return `${state.items.length} GraphQL request${state.items.length === 1 ? "" : "s"} captured, but none match the current search/filter settings. Use Reset filters to show them. Capture events seen: background ${background}, network ${network}, HAR ${har}.`;
  }
  if (background || network || har) {
    return `GraphQL-like traffic was observed, but no request payloads could be rendered yet. Capture events seen: background ${background}, network ${network}, HAR ${har}.`;
  }
  return "Run a GraphQL operation with DevTools open. If requests already exist in the Network tab, reload this extension and reopen DevTools so webRequest and HAR capture can initialise.";
}

function renderDetail() {
  const item = selected(); els.noSelection.hidden = Boolean(item); els.detail.hidden = !item; if (!item) return;
  els.detailName.textContent = item.operationName;
  els.detailMeta.textContent = `${item.operationType} • ${item.method} • ${item.status ?? "pending"} • ${item.url}${item.batchSize > 1 ? ` • batch ${item.batchIndex + 1}/${item.batchSize}` : ""}`;
  renderCode(els.queryView, item.query ? formatGraphQLQuery(item.query) : (item.persisted ? item.extensions : "No query text captured."));
  renderCode(els.variablesView, item.variables ?? {});
  renderObjectTree(els.responseView, item.response || "No response captured.");
  renderRawCode(els.responseRawView, item.responseRaw || item.response || "No response captured.");
  renderCode(els.headersView, { request: Object.fromEntries((item.requestHeaders || []).map(h => [h.name, h.value])), response: Object.fromEntries((item.responseHeaders || []).map(h => [h.name, h.value])) });
  renderRawCode(els.timelineView, item.timeline || [{ at: item.startedAt, duration: item.duration }]);
}

function setMode(mode) {
  const graphiql = mode === "graphiql";
  els.modeInspector.classList.toggle("active", !graphiql);
  els.modeGraphiql.classList.toggle("active", graphiql);
  els.inspectorView.hidden = graphiql;
  els.graphiqlView.hidden = !graphiql;
  for (const control of [els.search, els.typeFilter, els.errorsOnly, els.preserve, els.requestCount, els.resetFilters, els.clear, els.exportAll]) {
    (control.closest("label") || control).hidden = graphiql;
  }
  if (graphiql && selected()) populateGraphiqlFromSelected(false);
}

function populateGraphiqlFromSelected(overwrite = true) {
  const item = selected();
  if (!item) return;
  if (overwrite || !els.graphiqlEndpoint.value) els.graphiqlEndpoint.value = item.url;
  if (overwrite || !els.graphiqlQuery.value) els.graphiqlQuery.value = formatGraphQLQuery(item.query || "");
  if (overwrite || !els.graphiqlVariables.value) els.graphiqlVariables.value = formatJson(item.variables || {});
  if (overwrite || !els.graphiqlHeaders.value) {
    const headers = Object.fromEntries((item.requestHeaders || [])
      .filter(header => !/^content-length$/i.test(header.name))
      .map(header => [header.name, header.value]));
    els.graphiqlHeaders.value = formatJson({ "content-type": "application/json", ...headers });
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
  try {
    variables = parseOptionalJson(els.graphiqlVariables.value, "Variables");
    headers = { "content-type": "application/json", ...parseOptionalJson(els.graphiqlHeaders.value, "Headers") };
  } catch (error) {
    renderGraphiqlError(error.message);
    return;
  }

  els.graphiqlStatus.textContent = "Sending...";
  renderObjectTree(els.graphiqlResponse, {});
  renderCode(els.graphiqlResponseRaw, "");
  renderCode(els.graphiqlResponseHeaders, {});

  const payload = {
    url,
    method: els.graphiqlMethod.value,
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
      const text = await response.text();
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
  els.graphiqlStatus.textContent = `${message.status} ${message.statusText || ""} • ${message.duration ?? Math.round(performance.now() - pending.startedAt)} ms`;
  renderObjectTree(els.graphiqlResponse, parsed || "No response body.");
  renderRawCode(els.graphiqlResponseRaw, message.text || "No response body.");
  renderCode(els.graphiqlResponseHeaders, { url: message.url, ...message.headers });
}

function parseOptionalJson(value, label) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = safeJsonParse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
  return parsed;
}

function renderGraphiqlError(error) {
  const details = typeof error === "string" ? { message: error } : error;
  els.graphiqlStatus.textContent = "Error";
  renderObjectTree(els.graphiqlResponse, { error: details });
  renderCode(els.graphiqlResponseRaw, { error: details });
  renderCode(els.graphiqlResponseHeaders, {});
}

function shortUrl(value) { try { const u = new URL(value); return `${u.host}${u.pathname}`; } catch { return value; } }
function escapeHtml(value) { return value.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function badgeType(item) { return item.persisted ? "persisted" : ["query", "mutation", "subscription"].includes(item.operationType) ? item.operationType : "unknown"; }
function renderCode(element, value) {
  const formatted = formatJson(value) || String(value ?? "");
  element.innerHTML = isJsonLike(formatted) ? highlightJson(formatted) : escapeHtml(formatted);
}
function renderRawCode(element, value) {
  const raw = typeof value === "string" ? value : formatJson(value);
  if (raw.length > RAW_PREVIEW_LIMIT) {
    const preview = raw.slice(0, RAW_PREVIEW_LIMIT);
    element.textContent = `${preview}\n\n... truncated preview: showing ${RAW_PREVIEW_LIMIT.toLocaleString()} of ${raw.length.toLocaleString()} characters. Use Export or Copy JSON for the full payload.`;
    return;
  }
  renderCode(element, value);
}
function formatGraphQLQuery(query) {
  const text = String(query || "").trim();
  if (!text) return "";
  let formatted = "";
  let indent = 0;
  let inString = false;
  let quote = "";
  let escaping = false;
  const writeIndent = () => { formatted += "  ".repeat(Math.max(indent, 0)); };
  const trimLineEnd = () => { formatted = formatted.replace(/[ \t]+$/g, ""); };
  const newline = () => {
    trimLineEnd();
    if (!formatted.endsWith("\n")) formatted += "\n";
    writeIndent();
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      formatted += char;
      if (escaping) escaping = false;
      else if (char === "\\") escaping = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      formatted += char;
      continue;
    }
    if (/\s/.test(char)) {
      if (!/[\s({[]$/.test(formatted)) formatted += " ";
      continue;
    }
    if (char === "{") {
      trimLineEnd();
      formatted += " {";
      indent += 1;
      newline();
      continue;
    }
    if (char === "}") {
      indent -= 1;
      newline();
      formatted += "}";
      if (text.slice(i + 1).trim()) newline();
      continue;
    }
    if (char === ",") {
      formatted += ", ";
      continue;
    }
    formatted += char;
  }
  return formatted.trim();
}
function renderObjectTree(element, value) {
  element.replaceChildren();
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  if (!parsed || typeof parsed !== "object") {
    const empty = document.createElement("pre");
    renderCode(empty, value);
    element.append(empty);
    return;
  }
  element.append(createTreeNode(parsed, "root", true));
}
function createTreeNode(value, label = "", root = false) {
  if (!value || typeof value !== "object") return createPrimitiveNode(label, value);
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  const details = document.createElement("details");
  details.className = "tree-node";
  details.open = root;
  const summary = document.createElement("summary");
  summary.append(createLabel(label, value, entries.length, root));
  details.append(summary);
  if (root) appendTreeChildren(details, entries);
  else details.addEventListener("toggle", () => {
    if (details.open && !details.dataset.loaded) appendTreeChildren(details, entries);
  }, { once: true });
  return details;
}
function appendTreeChildren(details, entries, showAll = false) {
  details.dataset.loaded = "true";
  Array.from(details.children).find(child => child.classList.contains("tree-children"))?.remove();
  const children = document.createElement("div");
  children.className = "tree-children";
  const visibleEntries = showAll ? entries : entries.slice(0, TREE_CHILD_LIMIT);
  for (const [key, child] of visibleEntries) children.append(createTreeNode(child, key));
  if (!showAll && entries.length > TREE_CHILD_LIMIT) {
    const button = document.createElement("button");
    button.className = "tree-more";
    button.type = "button";
    button.textContent = `Show ${entries.length - TREE_CHILD_LIMIT} more`;
    button.onclick = event => {
      event.stopPropagation();
      appendTreeChildren(details, entries, true);
    };
    children.append(button);
  }
  details.append(children);
}
function createPrimitiveNode(label, value) {
  const row = document.createElement("div");
  row.className = "tree-leaf";
  row.append(createKey(label), document.createTextNode(": "));
  const span = document.createElement("span");
  span.className = `json-${value === null ? "null" : typeof value}`;
  span.textContent = value === null ? "null" : JSON.stringify(value);
  row.append(span);
  return row;
}
function createLabel(label, value, size, root) {
  const fragment = document.createDocumentFragment();
  if (!root) fragment.append(createKey(label), document.createTextNode(": "));
  fragment.append(document.createTextNode(Array.isArray(value) ? "[" : "{"));
  const count = document.createElement("span");
  count.className = "tree-count";
  count.textContent = ` ${size} ${size === 1 ? "item" : "items"} `;
  fragment.append(count, document.createTextNode(Array.isArray(value) ? "]" : "}"));
  return fragment;
}
function createKey(value) {
  const key = document.createElement("span");
  key.className = "json-key";
  key.textContent = typeof value === "number" || /^\d+$/.test(String(value)) ? String(value) : `"${value}"`;
  return key;
}
function isJsonLike(value) { return /^[\s]*[{[]/.test(value); }
function highlightJson(value) {
  return escapeHtml(value).replace(/(&quot;(?:\\.|[^\\])*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, (match, string, colon, boolean) => {
    if (string) return colon ? `<span class="json-key">${string}</span>${colon}` : `<span class="json-string">${string}</span>`;
    if (boolean) return `<span class="json-boolean">${boolean}</span>`;
    if (match === "null") return `<span class="json-null">null</span>`;
    return `<span class="json-number">${match}</span>`;
  });
}
async function copy(text) { await navigator.clipboard.writeText(text); }

els.search.oninput = render; els.typeFilter.onchange = render; els.errorsOnly.onchange = render;
els.preserve.onchange = () => { state.preserve = els.preserve.checked; chrome.storage.local.set({ preserve: state.preserve }); };
els.resetFilters.onclick = () => { els.search.value = ""; els.typeFilter.value = "all"; els.errorsOnly.checked = false; render(); };
els.clear.onclick = clear;
els.exportAll.onclick = () => downloadJson(`graphql-inspector-${new Date().toISOString().replace(/[:.]/g,"-")}.json`, visibleItems());
els.copyCurl.onclick = () => selected() && copy(toCurl(selected()));
els.copyFetch.onclick = () => selected() && copy(toFetch(selected()));
els.copyJson.onclick = () => selected() && copy(JSON.stringify(selected(), null, 2));
els.modeInspector.onclick = () => setMode("inspector");
els.modeGraphiql.onclick = () => setMode("graphiql");
els.graphiqlUseSelected.onclick = () => populateGraphiqlFromSelected(true);
els.graphiqlSend.onclick = sendGraphiqlRequest;
els.tabs.onclick = event => {
  const button = event.target.closest("button[data-tab]"); if (!button) return;
  for (const b of els.tabs.querySelectorAll("button")) b.classList.toggle("active", b === button);
  for (const panel of els.detail.querySelectorAll(".tab-panel")) panel.hidden = panel.id !== `tab-${button.dataset.tab}`;
};
els.graphiqlTabs.onclick = event => {
  const button = event.target.closest("button[data-graphiql-tab]"); if (!button) return;
  for (const b of els.graphiqlTabs.querySelectorAll("button")) b.classList.toggle("active", b === button);
  for (const panel of els.graphiqlView.querySelectorAll(".tab-panel")) panel.hidden = panel.id !== `graphiql-tab-${button.dataset.graphiqlTab}`;
};
render();
