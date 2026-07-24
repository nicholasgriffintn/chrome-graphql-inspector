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
});
