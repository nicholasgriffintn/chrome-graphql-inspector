import test from "node:test";
import assert from "node:assert/strict";

import { createBackgroundCaptureSetting } from "../src/background-capture.js";
import {
  BACKGROUND_CAPTURE_SCRIPT,
  BACKGROUND_CAPTURE_SCRIPT_ID,
} from "../src/settings.js";

test("background capture registers a persistent document-start page hook", async () => {
  let storageListener;
  const registered = [];
  const unregistered = [];
  const changes = [];
  const changeContexts = [];
  const errors = [];
  const extensionApi = {
    storage: {
      local: { get: async () => ({ backgroundCapture: true }) },
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
      },
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async scripts => { registered.push(...scripts); },
      unregisterContentScripts: async options => { unregistered.push(options); },
    },
  };

  const setting = createBackgroundCaptureSetting({
    extensionApi,
    onChange: async (enabled, context) => {
      changes.push(enabled);
      changeContexts.push(context);
    },
    onError: error => { errors.push(error); },
  });
  await setting.ready;

  assert.equal(setting.isEnabled(), true);
  assert.deepEqual(registered, [BACKGROUND_CAPTURE_SCRIPT]);
  assert.deepEqual(changes, [true]);
  assert.deepEqual(changeContexts, [{ initial: true }]);
  assert.deepEqual(errors, []);

  storageListener({
    backgroundCapture: { oldValue: true, newValue: false },
  }, "local");
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(setting.isEnabled(), false);
  assert.deepEqual(unregistered, [{ ids: [BACKGROUND_CAPTURE_SCRIPT_ID] }]);
  assert.deepEqual(changes, [true, false]);
  assert.deepEqual(changeContexts, [{ initial: true }, { initial: false }]);
});

test("background capture remains disabled by default", async () => {
  const registered = [];
  const changes = [];
  const extensionApi = {
    storage: {
      local: { get: async defaults => defaults },
      onChanged: { addListener() {} },
    },
    scripting: {
      registerContentScripts: async scripts => { registered.push(...scripts); },
      unregisterContentScripts: async () => {},
    },
  };

  const setting = createBackgroundCaptureSetting({
    extensionApi,
    onChange: async enabled => { changes.push(enabled); },
    onError() {},
  });
  await setting.ready;

  assert.equal(setting.isEnabled(), false);
  assert.deepEqual(registered, []);
  assert.deepEqual(changes, [false]);
});

test("a registration failure is reported without silently changing the preference", async () => {
  const errors = [];
  const changes = [];
  const extensionApi = {
    storage: {
      local: { get: async () => ({ backgroundCapture: true }) },
      onChanged: { addListener() {} },
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {
        throw new Error("Registration denied");
      },
      unregisterContentScripts: async () => {},
    },
  };

  const setting = createBackgroundCaptureSetting({
    extensionApi,
    onChange: async enabled => { changes.push(enabled); },
    onError: error => { errors.push(error.message); },
  });
  await setting.ready;

  assert.equal(setting.isEnabled(), true);
  assert.deepEqual(changes, [true]);
  assert.deepEqual(errors, ["Registration denied"]);
});

test("a storage change wins over a stale startup read", async () => {
  let resolveRead;
  let storageListener;
  const changes = [];
  const extensionApi = {
    storage: {
      local: {
        get: async () => new Promise(resolve => {
          resolveRead = resolve;
        }),
      },
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
      },
    },
    scripting: {
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {},
    },
  };
  const setting = createBackgroundCaptureSetting({
    extensionApi,
    onChange: async enabled => { changes.push(enabled); },
    onError() {},
  });

  storageListener({
    backgroundCapture: { oldValue: true, newValue: false },
  }, "local");
  resolveRead({ backgroundCapture: true });
  await setting.ready;

  assert.equal(setting.isEnabled(), false);
  assert.deepEqual(changes, [false]);
});
