import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const pageHookSource = readFileSync(new URL("../src/page-hook.js", import.meta.url), "utf8");

test("HTTP instrumentation stays inert until capture is enabled", async () => {
  let requestConstructions = 0;
  const input = { url: "https://example.test/rest" };
  const response = { ok: true };
  const window = {
    fetch: async value => {
      assert.equal(value, input);
      return response;
    },
    postMessage: () => {},
    addEventListener: () => {},
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    EventSource: undefined
  };
  class TrackedRequest {
    constructor() {
      requestConstructions += 1;
    }
  }

  vm.runInNewContext(pageHookSource, {
    window,
    Request: TrackedRequest,
    location: { href: "https://example.test/" },
    crypto: { randomUUID: () => "request-id" },
    URL,
    URLSearchParams,
    JSON,
    Date,
    Object,
    Array,
    Promise
  });

  assert.equal(await window.fetch(input), response);
  assert.equal(requestConstructions, 0);
});

test("the fetch wrapper preserves promise rejection semantics for invalid requests", async () => {
  let messageListener;
  const window = {
    fetch: () => Promise.resolve(),
    postMessage: () => {},
    addEventListener: (type, listener) => {
      if (type === "message") messageListener = listener;
    },
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    EventSource: undefined
  };
  class InvalidRequest {
    constructor() {
      throw new TypeError("Invalid request");
    }
  }

  vm.runInNewContext(pageHookSource, {
    window,
    Request: InvalidRequest,
    location: { href: "https://example.test/" },
    crypto: { randomUUID: () => "request-id" },
    URL,
    URLSearchParams,
    JSON,
    Date,
    Object,
    Array,
    Promise
  });
  messageListener({
    source: window,
    data: {
      source: "private-graphql-inspector-control",
      type: "capture-state",
      enabled: true
    }
  });

  let request;
  assert.doesNotThrow(() => { request = window.fetch("https://example.test/graphql"); });
  await assert.rejects(request, /Invalid request/);
});

test("EventSource captures GraphQL next events and completion", () => {
  const emitted = [];
  let messageListener;
  class FakeEventSource {
    constructor(url) {
      this.url = new URL(url, "https://example.test/page").href;
      this.readyState = 1;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    dispatch(type, event = {}) {
      this.listeners.get(type)?.({ type, ...event });
    }
  }
  const window = {
    fetch: undefined,
    postMessage: message => emitted.push(message),
    addEventListener: (type, listener) => {
      if (type === "message") messageListener = listener;
    },
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    EventSource: FakeEventSource,
  };

  vm.runInNewContext(pageHookSource, {
    window,
    location: { href: "https://example.test/page" },
    crypto: { randomUUID: () => "source-id" },
    URL,
    URLSearchParams,
    JSON,
    Date,
    Object,
    Array,
  });

  const source = new window.EventSource("/graphql");
  source.dispatch("next", { data: '{"data":{"viewer":{"id":"1"}}}' });
  source.dispatch("complete");
  assert.deepEqual(emitted, []);

  messageListener({
    source: window,
    data: {
      source: "private-graphql-inspector-control",
      type: "capture-state",
      enabled: true
    }
  });
  source.dispatch("next", { data: '{"data":{"viewer":{"id":"1"}}}' });
  source.dispatch("complete");

  assert.deepEqual(
    emitted.map(message => ({
      type: message.type,
      event: message.event,
      sourceId: message.sourceId,
      url: message.url,
    })),
    [
      {
        type: "sse-message",
        event: "next",
        sourceId: "source-id",
        url: "https://example.test/graphql",
      },
      {
        type: "sse-close",
        event: undefined,
        sourceId: "source-id",
        url: "https://example.test/graphql",
      },
    ],
  );
});

test("captured page payloads are bounded before crossing the page bridge", async () => {
  const emitted = [];
  let messageListener;
  const oversizedQuery = `query Viewer { viewer { id } }${"x".repeat(1_100_000)}`;
  const response = {
    status: 200,
    headers: [],
    clone: () => ({ text: async () => '{"data":{"viewer":{"id":"1"}}}' })
  };
  const window = {
    fetch: async () => response,
    postMessage: message => emitted.push(message),
    addEventListener: (type, listener) => {
      if (type === "message") messageListener = listener;
    },
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    EventSource: undefined
  };
  class FakeRequest {
    constructor() {
      this.url = "https://example.test/graphql";
      this.method = "POST";
      this.headers = [];
    }

    clone() {
      return { text: async () => oversizedQuery };
    }
  }

  vm.runInNewContext(pageHookSource, {
    window,
    Request: FakeRequest,
    location: { href: "https://example.test/" },
    crypto: { randomUUID: () => "request-id" },
    URL,
    URLSearchParams,
    JSON,
    Date,
    Object,
    Array,
    Promise
  });
  messageListener({
    source: window,
    data: {
      source: "private-graphql-inspector-control",
      type: "capture-state",
      enabled: true
    }
  });

  await window.fetch("https://example.test/graphql");
  await new Promise(resolve => setImmediate(resolve));

  const complete = emitted.find(message => message.type === "http-request-complete");
  assert.ok(complete);
  assert.ok(complete.requestBody.length <= 1_000_000);
});
