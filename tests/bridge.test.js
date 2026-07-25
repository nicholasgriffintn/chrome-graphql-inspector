import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const bridgeSource = readFileSync(new URL("../src/bridge.js", import.meta.url), "utf8");

test("the page bridge forwards only recognised inspector events", () => {
  const listeners = {};
  const sent = [];
  const window = {
    addEventListener: (type, listener) => { listeners[type] = listener; },
    removeEventListener: () => {}
  };
  const chrome = {
    runtime: {
      id: "extension-id",
      lastError: undefined,
      onMessage: { addListener: listener => { listeners.runtimeMessage = listener; } },
      sendMessage: (message, callback) => {
        sent.push(message);
        callback();
      }
    }
  };
  vm.runInNewContext(bridgeSource, { window, chrome, Date });
  assert.equal(sent.length, 1);

  listeners.message({
    source: window,
    data: { source: "private-graphql-inspector", type: "unrecognised-event", responseText: "forged" }
  });
  assert.equal(sent.length, 1);

  listeners.message({
    source: window,
    data: { source: "private-graphql-inspector", type: "ws-frame", socketId: 42, data: {} }
  });
  assert.equal(sent.length, 1);

  listeners.message({
    source: window,
    data: {
      source: "private-graphql-inspector",
      type: "ws-frame",
      socketId: "socket-1",
      url: "wss://example.test/graphql",
      data: "{\"type\":\"next\"}",
      at: Date.now()
    }
  });
  assert.equal(sent.length, 2);

  listeners.message({
    source: window,
    data: {
      source: "private-graphql-inspector",
      type: "ws-frame",
      socketId: "socket-1",
      url: "wss://example.test/graphql",
      data: "x".repeat(1_000_001),
      at: Date.now()
    }
  });
  assert.equal(sent.length, 2);
});

test("the bridge relays capture state from the extension to the page hook", () => {
  const listeners = {};
  const posted = [];
  const window = {
    addEventListener: (type, listener) => { listeners[type] = listener; },
    removeEventListener: () => {},
    postMessage: message => posted.push(message)
  };
  const chrome = {
    runtime: {
      id: "extension-id",
      lastError: undefined,
      onMessage: { addListener: listener => { listeners.runtimeMessage = listener; } },
      sendMessage: (_message, callback) => callback()
    }
  };
  vm.runInNewContext(bridgeSource, { window, chrome, Date, JSON });

  listeners.runtimeMessage({ type: "CAPTURE_STATE_CHANGED", enabled: true });

  assert.deepEqual({ ...posted[0] }, {
    source: "private-graphql-inspector-control",
    type: "capture-state",
    enabled: true
  });
});
