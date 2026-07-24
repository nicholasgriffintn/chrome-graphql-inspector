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
  const renderSource = sourceBetween("function render(", "function renderEmptyState()");
  const selectionSource = sourceBetween("function selectRequest(", "function renderEmptyState()");
  const keyboardSource = sourceBetween("function handleRequestKeydown(", "function focusSelectedRequest()");

  assert.match(renderSource, /div\.onclick = \(\) => selectRequest\(item\.id\)/);
  assert.match(selectionSource, /classList\.toggle\("selected", selected\)/);
  assert.match(selectionSource, /setAttribute\("aria-selected", String\(selected\)\)/);
  assert.match(selectionSource, /request\.tabIndex = selected \? 0 : -1/);
  assert.match(selectionSource, /renderDetail\(\)/);
  assert.doesNotMatch(selectionSource, /\brender\(\)/);
  assert.doesNotMatch(keyboardSource, /\brender\(\)/);
});

test("GraphQLi supports keyboard sending without bypassing the disabled state", () => {
  assert.match(panelScript, /els\.graphiqlView\.onkeydown = event =>/);
  assert.match(panelScript, /event\.(?:metaKey|ctrlKey)/);
  assert.match(panelScript, /\|\| els\.graphiqlSend\.disabled/);
  assert.match(panelScript, /sendGraphiqlRequest\(\)/);
});

test("GraphQLi filters replay headers and avoids a default JSON header for GET", () => {
  const sendSource = sourceBetween(
    "function sendGraphiqlRequest()",
    "function executeGraphiqlFetch(",
  );

  assert.match(sendSource, /requestHeadersForReplay/);
  assert.match(sendSource, /includeJsonContentType:\s*method !== "GET"/);
});

test("copying a failed response falls back to its transport error", () => {
  const copyResponseSource = sourceBetween(
    "els.copyResponse.onclick",
    "els.openGraphiql.onclick",
  );

  assert.match(copyResponseSource, /item\.error/);
  assert.match(copyResponseSource, /JSON\.stringify/);
});
