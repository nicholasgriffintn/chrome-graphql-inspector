import test from "node:test";
import assert from "node:assert/strict";

import {
  appendBounded,
  appendWithinBudget,
  prependBounded,
  prependWithinBudget,
} from "../src/collections.js";

test("bounded collections discard their oldest entries", () => {
  const newestFirst = ["second", "first"];
  assert.deepEqual(prependBounded(newestFirst, "third", 2), ["first"]);
  assert.deepEqual(newestFirst, ["third", "second"]);

  const oldestFirst = ["first", "second"];
  assert.deepEqual(appendBounded(oldestFirst, "third", 2), ["first"]);
  assert.deepEqual(oldestFirst, ["second", "third"]);
});

test("capture collections enforce count and byte budgets", () => {
  const newestFirst = [];
  prependWithinBudget(newestFirst, { id: "first", payload: "x".repeat(40) }, {
    maxItems: 10,
    maxBytes: 120,
  });
  const evicted = prependWithinBudget(newestFirst, { id: "second", payload: "x".repeat(40) }, {
    maxItems: 10,
    maxBytes: 120,
  });
  assert.deepEqual(evicted.map(item => item.id), ["first"]);
  assert.deepEqual(newestFirst.map(item => item.id), ["second"]);

  const oldestFirst = [];
  appendWithinBudget(oldestFirst, { id: "first", payload: "x".repeat(40) }, {
    maxItems: 1,
    maxBytes: 1000,
  });
  appendWithinBudget(oldestFirst, { id: "second", payload: "x".repeat(40) }, {
    maxItems: 1,
    maxBytes: 1000,
  });
  assert.deepEqual(oldestFirst.map(item => item.id), ["second"]);
});
