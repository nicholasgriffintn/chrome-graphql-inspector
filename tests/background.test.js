import test from "node:test";
import assert from "node:assert/strict";

test("removing a tab releases its buffered requests and pending records", async () => {
  const listeners = {};
  const captureStates = [];
  globalThis.chrome = {
    runtime: {
      onConnect: { addListener: listener => { listeners.connect = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } }
    },
    tabs: {
      sendMessage: (tabId, message) => captureStates.push({ tabId, ...message }),
      onRemoved: { addListener: listener => { listeners.tabRemoved = listener; } }
    },
    webRequest: {
      onBeforeRequest: { addListener: listener => { listeners.beforeRequest = listener; } },
      onBeforeSendHeaders: { addListener: listener => { listeners.beforeHeaders = listener; } }
    }
  };

  await import(`../src/background.js?cleanup=${Date.now()}`);
  const panel = createPanelPort();
  listeners.connect(panel.port);
  panel.receive({ type: "register", tabId: 7 });
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
  assert.deepEqual(captureStates[0], { tabId: 7, type: "CAPTURE_STATE_CHANGED", enabled: true });
  listeners.tabRemoved(7);
  assert.deepEqual(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().bufferedTabs, []);
  assert.equal(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().pendingRequests, 0);

  delete globalThis.chrome;
  delete globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__;
});

test("clearing a panel releases buffered requests before it reconnects", async () => {
  const listeners = {};
  const captureStates = [];
  globalThis.chrome = {
    runtime: {
      onConnect: { addListener: listener => { listeners.connect = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } }
    },
    tabs: {
      sendMessage: (tabId, message) => captureStates.push({ tabId, ...message }),
      onRemoved: { addListener: listener => { listeners.tabRemoved = listener; } }
    },
    webRequest: {
      onBeforeRequest: { addListener: listener => { listeners.beforeRequest = listener; } },
      onBeforeSendHeaders: { addListener: listener => { listeners.beforeHeaders = listener; } }
    }
  };

  await import(`../src/background.js?clear=${Date.now()}`);
  const firstPort = createPanelPort();
  listeners.connect(firstPort.port);
  firstPort.receive({ type: "register", tabId: 7 });
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

  assert.equal(firstPort.posted.length, 1);

  firstPort.receive({ type: "clear-tab-buffer", tabId: 7 });

  const reconnectedPort = createPanelPort();
  listeners.connect(reconnectedPort.port);
  reconnectedPort.receive({ type: "register", tabId: 7 });
  assert.equal(reconnectedPort.posted.length, 0);
  assert.equal(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().pendingRequests, 0);
  firstPort.disconnect();
  reconnectedPort.disconnect();
  assert.deepEqual(captureStates.at(-1), { tabId: 7, type: "CAPTURE_STATE_CHANGED", enabled: false });

  delete globalThis.chrome;
  delete globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__;
});

test("requests are ignored while no inspector panel is connected", async () => {
  const listeners = {};
  globalThis.chrome = {
    runtime: {
      onConnect: { addListener: listener => { listeners.connect = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } }
    },
    tabs: {
      sendMessage() {},
      onRemoved: { addListener: listener => { listeners.tabRemoved = listener; } }
    },
    webRequest: {
      onBeforeRequest: { addListener: listener => { listeners.beforeRequest = listener; } },
      onBeforeSendHeaders: { addListener: listener => { listeners.beforeHeaders = listener; } }
    }
  };

  await import(`../src/background.js?inactive=${Date.now()}`);
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

  assert.deepEqual(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().bufferedTabs, []);
  assert.equal(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().pendingRequests, 0);
  assert.equal("recentRequests" in globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__(), false);
  assert.equal("beforeRequestCount" in globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__(), false);

  delete globalThis.chrome;
  delete globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__;
});

function createPanelPort() {
  let messageListener;
  let disconnectListener;
  const posted = [];
  return {
    posted,
    port: {
      name: "graphql-panel",
      onMessage: { addListener: listener => { messageListener = listener; } },
      onDisconnect: { addListener: listener => { disconnectListener = listener; } },
      postMessage: message => posted.push(message)
    },
    receive(message) {
      messageListener(message);
    },
    disconnect() {
      disconnectListener();
    }
  };
}
