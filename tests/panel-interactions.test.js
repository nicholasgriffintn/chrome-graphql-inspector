import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panelScript = readFileSync(new URL("../src/panel.js", import.meta.url), "utf8");
const panelHtml = readFileSync(new URL("../src/panel.html", import.meta.url), "utf8");

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

test("credential-bearing exports require an explicit warning", () => {
  assert.match(panelHtml, /id="exportAllSensitive"/);
  assert.match(panelHtml, /id="copyCurlSensitive"/);
  assert.match(panelScript, /sanitiseOperationsForExport\(visibleItems\(\)\)/);
  assert.match(panelScript, /confirmSensitiveExport/);
  assert.match(panelScript, /includeSensitiveHeaders:\s*true/);
});

test("clear and non-preserved navigation discard the tab buffer", () => {
  assert.match(panelScript, /port\.postMessage\(\{\s*type:\s*"clear-tab-buffer"/s);
  assert.match(panelScript, /preserveReady\.then/);
  assert.match(panelScript, /els\.clear\.onclick = \(\) => clear\(\{ clearBuffer: true \}\)/);
});

test("tab controls expose their panels and support arrow-key navigation", () => {
  assert.match(panelHtml, /id="modeInspector"[^>]+aria-controls="inspectorView"/);
  assert.match(panelHtml, /data-tab="response"[^>]+aria-controls="tab-response"/);
  assert.match(panelHtml, /id="tab-response"[^>]+role="tabpanel"/);
  assert.match(panelScript, /handleTablistKeydown/);
});

test("panel capture storage is explicitly bounded", () => {
  assert.match(panelScript, /const ITEM_LIMIT = 1000/);
  assert.match(panelScript, /prependBounded\(state\.items, item, ITEM_LIMIT\)/);
  assert.match(panelScript, /const STREAM_EVENT_LIMIT = 250/);
  assert.match(panelScript, /appendBounded\(item\.timeline/);
});
