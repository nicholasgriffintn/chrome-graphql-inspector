import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const pageHookSource = readFileSync(new URL("../src/page-hook.js", import.meta.url), "utf8");

test("the fetch wrapper preserves promise rejection semantics for invalid requests", async () => {
  const window = {
    fetch: () => Promise.resolve(),
    postMessage: () => {},
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

  let request;
  assert.doesNotThrow(() => { request = window.fetch("https://example.test/graphql"); });
  await assert.rejects(request, /Invalid request/);
});

test("EventSource captures GraphQL next events and completion", () => {
  const emitted = [];
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
