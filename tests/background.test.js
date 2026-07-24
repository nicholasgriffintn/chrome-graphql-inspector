import test from "node:test";
import assert from "node:assert/strict";

test("removing a tab releases its buffered requests and pending records", async () => {
  const listeners = {};
  globalThis.chrome = {
    runtime: {
      onConnect: { addListener: listener => { listeners.connect = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } }
    },
    tabs: {
      onRemoved: { addListener: listener => { listeners.tabRemoved = listener; } }
    },
    webRequest: {
      onBeforeRequest: { addListener: listener => { listeners.beforeRequest = listener; } },
      onBeforeSendHeaders: { addListener: listener => { listeners.beforeHeaders = listener; } }
    }
  };

  await import(`../src/background.js?cleanup=${Date.now()}`);
  listeners.beforeRequest({
    requestId: "request-1",
    tabId: 7,
    url: "https://api.example.test/graphql",
    method: "POST",
    timeStamp: Date.now(),
    requestBody: {
      raw: [{ bytes: new TextEncoder().encode('{"query":"query Viewer { viewer { id } }"}').buffer }]
    }
  });

  assert.equal(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().bufferedTabs[0].tabId, 7);
  assert.equal(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().pendingRequests, 1);
  listeners.tabRemoved(7);
  assert.deepEqual(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().bufferedTabs, []);
  assert.equal(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().pendingRequests, 0);

  delete globalThis.chrome;
  delete globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__;
});
