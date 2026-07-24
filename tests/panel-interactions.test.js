import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panelScript = readFileSync(new URL("../src/panel.js", import.meta.url), "utf8");

function sourceBetween(start, end) {
  const startIndex = panelScript.indexOf(start);
  const endIndex = panelScript.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, start);
  assert.notEqual(endIndex, -1, end);
  return panelScript.slice(startIndex, endIndex);
}

test("selecting a captured request does not rebuild the scrollable list", () => {
  const renderSource = sourceBetween("function render()", "function renderEmptyState()");
  const selectionSource = sourceBetween("function selectRequest(", "function renderEmptyState()");
  const keyboardSource = sourceBetween("function handleRequestKeydown(", "function focusSelectedRequest()");

  assert.match(renderSource, /div\.onclick = \(\) => selectRequest\(item\.id\)/);
  assert.match(selectionSource, /classList\.toggle\("selected", selected\)/);
  assert.match(selectionSource, /setAttribute\("aria-selected", String\(selected\)\)/);
  assert.match(selectionSource, /renderDetail\(\)/);
  assert.doesNotMatch(selectionSource, /\brender\(\)/);
  assert.doesNotMatch(keyboardSource, /\brender\(\)/);
});
