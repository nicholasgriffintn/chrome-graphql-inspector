import test from "node:test";
import assert from "node:assert/strict";
import {
  badgeLabel,
  badgeType,
  escapeHtml,
  filterItems,
  formatDuration,
  formatRelativeTime,
  getOperationCounts,
  highlightJson,
  isErrorItem,
  parseOptionalJson,
  shortUrl
} from "../src/panel-model.js";

const items = [
  {
    operationName: "Viewer",
    operationType: "query",
    method: "POST",
    status: 200,
    url: "https://api.example.test/graphql",
    query: "query Viewer { viewer { id } }",
    variables: {},
    response: { data: { viewer: { id: "1" } } }
  },
  {
    operationName: "SaveViewer",
    operationType: "mutation",
    method: "POST",
    status: 200,
    url: "https://api.example.test/graphql",
    query: "mutation SaveViewer { saveViewer { id } }",
    variables: {},
    response: { errors: [{ message: "Not allowed" }] }
  },
  {
    operationName: "Updates",
    operationType: "subscription",
    method: "WS",
    status: 101,
    url: "wss://api.example.test/graphql",
    query: "subscription Updates { updates { id } }",
    variables: {},
    response: []
  },
  {
    operationName: "Persisted 12345678",
    operationType: "unknown",
    method: "GET",
    status: 500,
    url: "https://api.example.test/graphql",
    persisted: true,
    variables: {},
    extensions: { persistedQuery: { sha256Hash: "12345678" } },
    response: {}
  }
];

test("filters operations by type, errors and full-text search", () => {
  assert.deepEqual(filterItems(items, { type: "query" }).map(item => item.operationName), ["Viewer"]);
  assert.deepEqual(filterItems(items, { errorsOnly: true }).map(item => item.operationName), ["SaveViewer", "Persisted 12345678"]);
  assert.deepEqual(filterItems(items, { search: "not allowed" }).map(item => item.operationName), ["SaveViewer"]);
  assert.deepEqual(filterItems(items, { search: "WSS://API.EXAMPLE.TEST" }).map(item => item.operationName), ["Updates"]);
});

test("counts every operation type and GraphQL errors", () => {
  assert.deepEqual(getOperationCounts(items), {
    query: 1,
    mutation: 1,
    subscription: 1,
    unknown: 1,
    errors: 2
  });
  assert.equal(isErrorItem(items[0]), false);
  assert.equal(isErrorItem(items[1]), true);
  assert.equal(isErrorItem(items[3]), true);
});

test("formats live, short and long request durations", () => {
  assert.equal(formatDuration(null), "live");
  assert.equal(formatDuration(142.4), "142ms");
  assert.equal(formatDuration(1420), "1.4s");
  assert.equal(formatDuration(12500), "13s");
});

test("formats relative capture times without future or invalid values leaking into the UI", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(formatRelativeTime(now - 2000, now), "now");
  assert.equal(formatRelativeTime(now - 49000, now), "49s ago");
  assert.equal(formatRelativeTime(now - 120000, now), "2m ago");
  assert.equal(formatRelativeTime(now - 7200000, now), "2h ago");
  assert.equal(formatRelativeTime(now + 10000, now), "now");
  assert.equal(formatRelativeTime("invalid", now), "unknown");
});

test("uses concise endpoints and distinguishes persisted operations", () => {
  const persistedQuery = { ...items[3], operationType: "query" };
  assert.equal(shortUrl("https://api.example.test/graphql?query=Viewer"), "api.example.test/graphql");
  assert.equal(shortUrl("not a URL"), "not a URL");
  assert.equal(badgeType(items[3]), "unknown");
  assert.equal(badgeLabel(items[3]), "other");
  assert.equal(badgeType(persistedQuery), "query");
  assert.equal(badgeLabel(persistedQuery), "query");
  assert.equal(badgeLabel({ operationType: "unknown" }), "other");
});

test("escapes dynamic request labels before inserting them into row markup", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(escapeHtml(42), "42");
  assert.equal(highlightJson('{"value":"<script>"}').includes("<script>"), false);
});

test("accepts optional JSON objects and rejects invalid GraphQLi editor values", () => {
  assert.deepEqual(parseOptionalJson("", "Variables"), {});
  assert.deepEqual(parseOptionalJson('{"id":"1"}', "Variables"), { id: "1" });
  assert.throws(() => parseOptionalJson("[]", "Variables"), /Variables must be a JSON object/);
  assert.throws(() => parseOptionalJson("{", "Headers"), /Headers must be a JSON object/);
});
