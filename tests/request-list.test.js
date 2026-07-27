import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createRequestList } from "../src/request-list.js";

function createItem(index) {
  return {
    id: `request-${index}`,
    operationName: `Operation ${index}`,
    operationType: "query",
    url: `https://example.test/graphql?request=${index}`,
    duration: index,
    startedAt: Date.now() - index,
    status: 200,
  };
}

test("large request lists render only the visible window", () => {
  const dom = new JSDOM("<div id='viewport'><div id='list'></div></div>");
  const viewport = dom.window.document.getElementById("viewport");
  const list = dom.window.document.getElementById("list");
  Object.defineProperty(viewport, "clientHeight", { value: 700 });
  viewport.scrollTop = 3_500;
  globalThis.document = dom.window.document;

  try {
    const items = Array.from({ length: 200 }, (_, index) => createItem(index));
    const requestList = createRequestList({
      list,
      viewport,
      onSelect() {},
      onKeydown() {},
    });

    requestList.render(items, "request-50");

    const rows = list.querySelectorAll("[data-request-id]");
    assert.equal(rows.length, 26);
    assert.equal(rows[0].dataset.requestId, "request-42");
    assert.equal(rows[rows.length - 1].dataset.requestId, "request-67");
    assert.equal(list.firstElementChild.className, "request-list-spacer");
    assert.equal(list.lastElementChild.className, "request-list-spacer");
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});

test("ensuring a selected off-screen request scrolls and rerenders its row", () => {
  const dom = new JSDOM("<div id='viewport'><div id='list'></div></div>");
  const viewport = dom.window.document.getElementById("viewport");
  const list = dom.window.document.getElementById("list");
  Object.defineProperty(viewport, "clientHeight", { value: 700 });
  globalThis.document = dom.window.document;

  try {
    const items = Array.from({ length: 200 }, (_, index) => createItem(index));
    const requestList = createRequestList({
      list,
      viewport,
      onSelect() {},
      onKeydown() {},
    });
    requestList.render(items, "request-0");

    requestList.ensureVisible(items, "request-150");

    assert.equal(viewport.scrollTop, 10_500);
    assert.ok(list.querySelector("[data-request-id='request-150']"));
  } finally {
    delete globalThis.document;
    dom.window.close();
  }
});
