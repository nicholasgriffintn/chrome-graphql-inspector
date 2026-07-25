import test from "node:test";
import assert from "node:assert/strict";

import { appendBounded, prependBounded } from "../src/collections.js";

test("bounded collections discard their oldest entries", () => {
  const newestFirst = ["second", "first"];
  assert.deepEqual(prependBounded(newestFirst, "third", 2), ["first"]);
  assert.deepEqual(newestFirst, ["third", "second"]);

  const oldestFirst = ["first", "second"];
  assert.deepEqual(appendBounded(oldestFirst, "third", 2), ["first"]);
  assert.deepEqual(oldestFirst, ["second", "third"]);
});
