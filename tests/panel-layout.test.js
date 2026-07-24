import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const projectRoot = new URL("../", import.meta.url);
const panelHtml = readFileSync(new URL("src/panel.html", projectRoot), "utf8");
const panelCss = readFileSync(new URL("src/panel.css", projectRoot), "utf8");
const summaryMarkup = panelHtml.match(/<footer class="operation-summary"[\s\S]*?<\/footer>/)?.[0] ?? "";

test("capture summary keeps every count, marker and label in one metric", () => {
  assert.equal(summaryMarkup.match(/class="summary-value"/g)?.length, 5);
  assert.equal(summaryMarkup.match(/class="summary-label"/g)?.length, 5);
  assert.match(summaryMarkup, /summary-value[^>]*>[\s\S]*?id="queryCount"[\s\S]*?query-dot/);
  assert.match(summaryMarkup, /summary-value[^>]*>[\s\S]*?id="mutationCount"[\s\S]*?mutation-dot/);
  assert.match(summaryMarkup, /summary-value[^>]*>[\s\S]*?id="subscriptionCount"[\s\S]*?subscription-dot/);
  assert.match(summaryMarkup, /summary-value[^>]*>[\s\S]*?id="unknownCount"[\s\S]*?unknown-dot/);
  assert.match(summaryMarkup, /summary-value[^>]*>[\s\S]*?id="errorCount"[\s\S]*?error-dot/);
});

test("capture summary uses bounded grid cells without detached markers", () => {
  assert.match(panelCss, /\.operation-summary\s*{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(panelCss, /\.operation-summary button,\s*\.error-summary\s*{[^}]*display:\s*grid;/s);
  assert.match(panelCss, /\.operation-summary button:not\(:last-child\)\s*{[^}]*border-right:/s);
  assert.doesNotMatch(panelCss, /\.operation-summary i\s*{[^}]*position:\s*absolute;/s);
});
