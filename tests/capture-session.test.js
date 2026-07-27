import test from "node:test";
import assert from "node:assert/strict";

import { createCaptureSession } from "../src/capture-session.js";

test("capture sessions restore memory-backed events and throttle persistence", async () => {
  const writes = [];
  const buffer = {
    restore(snapshot) {
      this.value = snapshot;
    },
    snapshot() {
      return this.value;
    },
    value: [],
  };
  const session = createCaptureSession({
    storage: {
      get: async () => ({ events: [[7, [{ id: "restored" }]]] }),
      set: async value => { writes.push(value); },
      remove: async () => {},
    },
    key: "events",
    buffer,
    isEnabled: () => true,
    onError() {},
    persistDelay: 0,
  });

  await session.restore();
  session.schedulePersist();
  session.schedulePersist();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(buffer.value, [[7, [{ id: "restored" }]]]);
  assert.deepEqual(writes, [{ events: [[7, [{ id: "restored" }]]] }]);
});

test("capture sessions clear stale events while disabled", async () => {
  const removals = [];
  const session = createCaptureSession({
    storage: {
      get: async () => ({ events: [] }),
      set: async () => {},
      remove: async key => { removals.push(key); },
    },
    key: "events",
    buffer: { restore() {}, snapshot: () => [] },
    isEnabled: () => false,
    onError() {},
  });

  await session.restore();
  session.schedulePersist();

  assert.deepEqual(removals, ["events"]);
});

test("capture sessions report storage failures without rejecting startup", async () => {
  const errors = [];
  const session = createCaptureSession({
    storage: {
      get: async () => {
        throw new Error("Session unavailable");
      },
      set: async () => {},
      remove: async () => {},
    },
    key: "events",
    buffer: { restore() {}, snapshot: () => [] },
    isEnabled: () => true,
    onError: error => { errors.push(error); },
  });

  await session.restore();

  assert.deepEqual(errors, ["restore: Session unavailable"]);
});
