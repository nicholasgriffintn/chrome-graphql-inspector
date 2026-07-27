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
  await new Promise(resolve => setImmediate(resolve));
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
  await new Promise(resolve => setImmediate(resolve));
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
  await new Promise(resolve => setImmediate(resolve));
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

test("closing a panel during page-hook injection cannot re-enable capture", async () => {
  const listeners = {};
  const captureStates = [];
  let releaseInjection;
  globalThis.chrome = {
    runtime: {
      onConnect: { addListener: listener => { listeners.connect = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } }
    },
    scripting: {
      executeScript() {
        return new Promise(resolve => {
          releaseInjection = resolve;
        });
      }
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

  await import(`../src/background.js?injection-race=${Date.now()}`);
  await new Promise(resolve => setImmediate(resolve));
  const panel = createPanelPort();
  listeners.connect(panel.port);
  panel.receive({ type: "register", tabId: 7 });
  await new Promise(resolve => setImmediate(resolve));
  panel.disconnect();
  releaseInjection();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(captureStates, [
    { tabId: 7, type: "CAPTURE_STATE_CHANGED", enabled: false }
  ]);

  delete globalThis.chrome;
  delete globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__;
});

test("opt-in background capture buffers traffic before the panel connects", async () => {
  const listeners = {};
  const captureStates = [];
  const registrations = [];
  const unregistrations = [];
  const injections = [];
  const sessionWrites = [];
  const sessionRemovals = [];
  let storageListener;
  let releaseSessionRestore;
  globalThis.chrome = {
    runtime: {
      onConnect: { addListener: listener => { listeners.connect = listener; } },
      onMessage: { addListener: listener => { listeners.message = listener; } }
    },
    storage: {
      local: { get: async () => ({ backgroundCapture: true }) },
      session: {
        get: async () => new Promise(resolve => {
          releaseSessionRestore = () => resolve({
            backgroundCaptureEvents: [[7, [{
              source: "page-hook",
              type: "ws-open",
              socketId: "restored-socket",
              url: "wss://api.example.test/graphql",
              at: Date.now() - 1_000,
            }]]],
          });
        }),
        set: async value => { sessionWrites.push(value); },
        remove: async key => { sessionRemovals.push(key); },
      },
      onChanged: { addListener: listener => { storageListener = listener; } },
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async scripts => { registrations.push(...scripts); },
      unregisterContentScripts: async options => { unregistrations.push(options); },
      executeScript: async options => { injections.push(options); },
    },
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: (tabId, message) => captureStates.push({ tabId, ...message }),
      onRemoved: { addListener: listener => { listeners.tabRemoved = listener; } }
    },
    webRequest: {
      onBeforeRequest: { addListener: listener => { listeners.beforeRequest = listener; } },
      onBeforeSendHeaders: { addListener: listener => { listeners.beforeHeaders = listener; } }
    }
  };

  await import(`../src/background.js?background-capture=${Date.now()}`);
  await new Promise(resolve => setImmediate(resolve));
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
  listeners.message({
    source: "private-graphql-inspector",
    type: "http-request-complete",
    requestId: "hook-request-1",
    url: "https://api.example.test/graphql",
    method: "POST",
    responseText: '{"data":{"viewer":{"id":"1"}}}',
    at: Date.now(),
  }, { tab: { id: 7 }, frameId: 0 });
  listeners.message({
    source: "private-graphql-inspector",
    type: "ws-open",
    socketId: "socket-1",
    url: "wss://api.example.test/graphql",
    at: Date.now(),
  }, { tab: { id: 7 }, frameId: 0 });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].world, "MAIN");
  assert.equal(registrations[0].runAt, "document_start");
  assert.equal(injections.length, 1);

  const panel = createPanelPort();
  listeners.connect(panel.port);
  panel.receive({ type: "register", tabId: 7 });
  assert.equal(panel.posted.length, 0);
  releaseSessionRestore();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().bufferedTabs, [
    { tabId: 7, events: 4 },
  ]);

  assert.equal(panel.posted.length, 4);
  assert.equal(panel.posted[0].socketId, "restored-socket");
  assert.equal(panel.posted[1].requestId, "request-1");
  assert.equal(panel.posted[2].responseText, '{"data":{"viewer":{"id":"1"}}}');
  assert.equal(panel.posted[3].socketId, "socket-1");
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(sessionWrites.length, 1);
  panel.disconnect();
  assert.equal(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().bufferedTabs.length, 1);

  storageListener({
    backgroundCapture: { oldValue: true, newValue: false },
  }, "local");
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(unregistrations, [
    { ids: ["graphql-inspector-background-capture"] },
  ]);
  assert.equal(injections.length, 1);
  assert.deepEqual(sessionRemovals, ["backgroundCaptureEvents"]);
  assert.deepEqual(globalThis.__PRIVATE_GRAPHQL_INSPECTOR_DIAGNOSTICS__().bufferedTabs, []);
  assert.deepEqual(captureStates.at(-1), {
    tabId: 7,
    type: "CAPTURE_STATE_CHANGED",
    enabled: false,
  });

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
