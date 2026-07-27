import test from "node:test";
import assert from "node:assert/strict";

import { createCaptureBuffer } from "../src/capture-buffer.js";

test("capture buffers evict the oldest unpinned tab", () => {
  const evicted = [];
  const buffer = createCaptureBuffer({
    maxTabs: 2,
    maxItemsPerTab: 10,
    maxBytesPerTab: 10_000,
    maxTotalBytes: 20_000,
    isPinned: tabId => tabId === 1,
    onEvict: tabId => { evicted.push(tabId); },
  });

  buffer.append(1, { type: "pinned" });
  buffer.append(2, { type: "first-background" });
  buffer.append(3, { type: "second-background" });
  buffer.append(4, { type: "third-background" });

  assert.deepEqual([...buffer.keys()], [1, 3, 4]);
  assert.equal(buffer.get(2), undefined);
  assert.deepEqual(evicted, [2]);
});

test("capture buffers enforce an aggregate byte limit across background tabs", () => {
  const buffer = createCaptureBuffer({
    maxTabs: 10,
    maxItemsPerTab: 10,
    maxBytesPerTab: 10_000,
    maxTotalBytes: 180,
  });

  buffer.append(1, { data: "a".repeat(100) });
  buffer.append(2, { data: "b".repeat(100) });

  assert.equal(buffer.get(1), undefined);
  assert.equal(buffer.get(2).length, 1);
});

test("capture buffers restore validated session events before newer events", () => {
  const buffer = createCaptureBuffer({
    maxTabs: 10,
    maxItemsPerTab: 10,
    maxBytesPerTab: 10_000,
    maxTotalBytes: 20_000,
  });
  buffer.append(1, { id: "new" });

  buffer.restore([
    [1, [{ id: "old" }]],
    ["invalid-tab", [{ id: "ignored" }]],
    [2, "invalid-events"],
  ]);

  assert.deepEqual(buffer.snapshot(), [
    [1, [{ id: "old" }, { id: "new" }]],
  ]);
});
