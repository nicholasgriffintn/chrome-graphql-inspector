import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const panelHtml = readFileSync(new URL("../src/panel.html", import.meta.url), "utf8");

function sampleHarEntries() {
  const entry = (operationName, query) => ({
    startedDateTime: new Date().toISOString(),
    time: 24,
    request: {
      method: "POST",
      url: "https://app.example.test/graphql",
      headers: [{ name: "content-type", value: "application/json" }],
      postData: { text: JSON.stringify({ operationName, query, variables: { site: "/news" } }) }
    },
    response: {
      status: 200,
      headers: [{ name: "content-type", value: "application/json" }],
      content: { text: JSON.stringify({ data: { [operationName]: { ok: true } } }) }
    }
  });
  return [
    entry("articles", "query articles { v2 { articles { totalNumberOfArticles } } }"),
    entry("getStatus", "query getStatus { status }")
  ];
}

function setupPanelDom({ harEntries = [] } = {}) {
  const evalCalls = [];
  const dom = new JSDOM(panelHtml, { url: "https://example.test" });

  const listeners = [];
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async () => {} } }
  });
  globalThis.chrome = {
    runtime: {
      connect: () => ({
        postMessage: () => {},
        onMessage: { addListener: listener => listeners.push(listener) }
      })
    },
    storage: { local: { get: async defaults => defaults, set: () => {} } },
    devtools: {
      inspectedWindow: {
        tabId: 1,
        eval: (expression, callback) => {
          evalCalls.push(expression);
          callback();
        }
      },
      network: {
        onNavigated: { addListener: () => {} },
        onRequestFinished: { addListener: () => {} },
        getHAR: callback => callback({ entries: harEntries })
      }
    }
  };

  return { listeners, evalCalls };
}

test("renders a background GraphQL HTTP event", async () => {
  const { listeners } = setupPanelDom();

  await import(`../src/panel.js?panel-smoke=${Date.now()}`);
  assert.equal(listeners.length, 1);

  listeners[0]({
    type: "http-request-start",
    source: "background",
    requestId: "request-1",
    url: "https://example.test/graphql",
    method: "POST",
    requestHeaders: [],
    requestBody: JSON.stringify({ operationName: "SmokeQuery", query: "query SmokeQuery{viewer{id}}" }),
    startedAt: Date.now()
  });

  assert.equal(document.getElementById("requests").children.length, 1);
  assert.equal(document.getElementById("empty").hidden, true);
  assert.match(document.getElementById("requests").textContent, /SmokeQuery/);
  assert.match(document.getElementById("queryView").textContent, /viewer \{\n\s+id/);
});

test("page-hook captures cannot overwrite a trusted completed response", async () => {
  const { listeners } = setupPanelDom();
  const startedAt = Date.now();
  const requestBody = JSON.stringify({
    operationName: "TrustedQuery",
    query: "query TrustedQuery { viewer { id } }"
  });

  await import(`../src/panel.js?trusted-capture=${Date.now()}`);
  listeners[0]({
    type: "http-request-complete",
    source: "background",
    requestId: "trusted-request",
    url: "https://example.test/graphql",
    method: "POST",
    status: 200,
    requestHeaders: [],
    responseHeaders: [{ name: "content-type", value: "application/json" }],
    requestBody,
    responseText: '{"data":{"source":"trusted"}}',
    startedAt,
    at: startedAt + 10
  });
  listeners[0]({
    type: "http-request-complete",
    source: "page-hook",
    requestId: "forged-request",
    url: "https://example.test/graphql",
    method: "POST",
    status: 200,
    requestHeaders: [],
    responseHeaders: [{ name: "content-type", value: "application/json" }],
    requestBody,
    responseText: '{"data":{"source":"forged"}}',
    startedAt: startedAt + 1,
    at: startedAt + 11
  });

  assert.match(document.getElementById("responseRawView").textContent, /trusted/);
  assert.doesNotMatch(document.getElementById("responseRawView").textContent, /forged/);
});

test("renders GraphQL requests from HAR backfill", async () => {
  setupPanelDom({ harEntries: sampleHarEntries() });

  await import(`../src/panel.js?har-smoke=${Date.now()}`);

  assert.equal(document.getElementById("requests").children.length, 2);
  assert.equal(document.getElementById("empty").hidden, true);
  assert.equal(document.getElementById("noSelection").hidden, true);
  assert.equal(document.getElementById("requestCount").textContent, "2/2");
  assert.equal(document.getElementById("captureNumber").textContent, "2");
  assert.equal(document.getElementById("queryCount").textContent, "2");
  assert.equal(document.getElementById("mutationCount").textContent, "0");
  assert.match(document.getElementById("requests").textContent, /articles/);
  assert.match(document.getElementById("requests").textContent, /getStatus/);
  assert.equal(document.querySelectorAll("#requests .badge.query").length, 2);

  document.querySelector(".request").click();
  assert.ok(document.getElementById("variablesView").querySelector(".json-key"));
  assert.ok(document.getElementById("responseView").querySelector(".json-key"));
  assert.ok(document.getElementById("responseView").querySelector("details"));
  assert.ok(document.getElementById("responseRawView").querySelector(".json-key"));
});

test("supports segmented filters and keyboard request navigation", async () => {
  setupPanelDom({ harEntries: sampleHarEntries() });

  await import(`../src/panel.js?navigation=${Date.now()}`);

  const queryFilter = document.querySelector('[data-type-filter="query"]');
  queryFilter.click();
  assert.equal(document.getElementById("typeFilter").value, "query");
  assert.equal(queryFilter.getAttribute("aria-pressed"), "true");

  const selected = document.querySelector(".request.selected");
  selected.dispatchEvent(new selected.ownerDocument.defaultView.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  await Promise.resolve();

  assert.equal(document.querySelector(".request.selected"), document.querySelector(".request"));
  assert.equal(document.querySelector(".request.selected").getAttribute("aria-selected"), "true");
});

test("reset filters reveals captured GraphQL requests", async () => {
  setupPanelDom({ harEntries: sampleHarEntries() });

  await import(`../src/panel.js?filter-smoke=${Date.now()}`);

  document.getElementById("typeFilter").value = "mutation";
  document.getElementById("typeFilter").onchange();

  assert.equal(document.getElementById("requests").children.length, 0);
  assert.equal(document.getElementById("requestCount").textContent, "0/2");
  assert.match(document.getElementById("empty").textContent, /No matching operations/);
  assert.match(document.getElementById("empty").textContent, /2 captured/);

  document.getElementById("resetFilters").onclick();

  assert.equal(document.getElementById("requests").children.length, 2);
  assert.equal(document.getElementById("requestCount").textContent, "2/2");
});

test("GraphQLi sends a page-context request and renders the response", async () => {
  const { listeners, evalCalls } = setupPanelDom();

  await import(`../src/panel.js?graphiql-smoke=${Date.now()}`);

  document.getElementById("modeGraphiql").onclick();
  assert.equal(document.getElementById("inspectorView").hidden, true);
  assert.equal(document.getElementById("inspectorActions").hidden, true);
  assert.equal(document.getElementById("modeGraphiql").getAttribute("aria-selected"), "true");
  document.querySelector('[data-graphiql-input-tab="headers"]').click();
  assert.equal(document.getElementById("graphiql-input-variables").hidden, true);
  assert.equal(document.getElementById("graphiql-input-headers").hidden, false);
  document.getElementById("graphiqlEndpoint").value = "https://example.test/graphql";
  document.getElementById("graphiqlQuery").value = "query Hello { hello }";
  document.getElementById("graphiqlVariables").value = "{}";
  document.getElementById("graphiqlHeaders").value = "{}";
  document.getElementById("graphiqlSend").onclick();

  assert.equal(evalCalls.length, 1);
  assert.match(evalCalls[0], /query Hello/);
  assert.match(evalCalls[0], /__PRIVATE_GRAPHQL_INSPECTOR_NATIVE_FETCH__/);
  const graphiqlRequestId = evalCalls[0].match(/"graphiqlRequestId":"([^"]+)"/)[1];
  listeners[0]({
    type: "graphiql-result",
    graphiqlRequestId,
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://example.test/graphql",
    headers: { "content-type": "application/json" },
    text: JSON.stringify({ data: { hello: "world" } }),
    duration: 12
  });
  assert.match(document.getElementById("graphiqlStatus").textContent, /200 OK/);
  assert.equal(document.getElementById("graphiqlCopyResponse").disabled, false);
  assert.match(document.getElementById("graphiqlResponseRaw").textContent, /hello/);
  assert.ok(document.getElementById("graphiqlResponse").querySelector("details"));
  assert.ok(document.getElementById("graphiqlResponseRaw").querySelector(".json-key"));
});

test("GraphQLi renders page-hook failure details", async () => {
  const { listeners, evalCalls } = setupPanelDom();

  await import(`../src/panel.js?graphiql-error=${Date.now()}`);

  document.getElementById("modeGraphiql").onclick();
  document.getElementById("graphiqlEndpoint").value = "https://example.test/graphql";
  document.getElementById("graphiqlQuery").value = "query Hello { hello }";
  document.getElementById("graphiqlVariables").value = "{}";
  document.getElementById("graphiqlHeaders").value = "{}";
  document.getElementById("graphiqlSend").onclick();

  const graphiqlRequestId = evalCalls[0].match(/"graphiqlRequestId":"([^"]+)"/)[1];
  listeners[0]({
    type: "graphiql-result",
    graphiqlRequestId,
    ok: false,
    method: "POST",
    url: "https://example.test/graphql",
    error: { name: "TypeError", message: "Failed to fetch", stack: "TypeError: Failed to fetch" },
    duration: 8
  });

  assert.equal(document.getElementById("graphiqlStatus").textContent, "Error");
  assert.match(document.getElementById("graphiqlResponseRaw").textContent, /Failed to fetch/);
  assert.match(document.getElementById("graphiqlResponseRaw").textContent, /https:\/\/example\.test\/graphql/);
  assert.match(document.getElementById("graphiqlResponseRaw").textContent, /TypeError/);
});

test("large responses render bounded previews", async () => {
  const { listeners } = setupPanelDom();

  await import(`../src/panel.js?large-response=${Date.now()}`);

  const largeItems = Array.from({ length: 450 }, (_, index) => ({ id: index, title: `Article ${index}`, nested: { value: index } }));
  listeners[0]({
    type: "http-request-complete",
    source: "background",
    requestId: "large-response",
    url: "https://example.test/graphql",
    method: "POST",
    status: 200,
    requestHeaders: [],
    responseHeaders: [{ name: "content-type", value: "application/json" }],
    requestBody: JSON.stringify({ operationName: "LargeQuery", query: "query LargeQuery { articles { id title } }" }),
    responseText: JSON.stringify({ data: { articles: largeItems, filler: "x".repeat(220000) } }),
    startedAt: Date.now(),
    at: Date.now() + 20
  });

  assert.match(document.getElementById("requests").textContent, /LargeQuery/);
  assert.match(document.getElementById("responseRawView").textContent, /truncated preview/);
  assert.equal(document.getElementById("responseView").querySelectorAll(".tree-leaf").length < 250, true);
  assert.match(document.getElementById("timelineView").textContent, /Payload omitted from timeline/);
  assert.equal(document.getElementById("timelineView").textContent.includes("x".repeat(20000)), false);

  const dataNode = Array.from(document.getElementById("responseView").querySelectorAll("details"))
    .find(node => node.querySelector("summary")?.textContent.includes('"data"'));
  dataNode.open = true;
  dataNode.dispatchEvent(new dataNode.ownerDocument.defaultView.Event("toggle"));
  const articlesNode = Array.from(document.getElementById("responseView").querySelectorAll("details"))
    .find(node => node.querySelector("summary")?.textContent.includes('"articles"'));
  articlesNode.open = true;
  articlesNode.dispatchEvent(new articlesNode.ownerDocument.defaultView.Event("toggle"));

  assert.ok(document.getElementById("responseView").querySelector(".tree-more"));
});
