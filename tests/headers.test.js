import test from "node:test";
import assert from "node:assert/strict";
import { headersToObject, isSensitiveHeaderName, requestHeadersForReplay } from "../src/headers.js";
import { sanitiseOperationsForExport, toCurl, toFetch } from "../src/exports.js";

test("replay headers retain application metadata but remove browser-managed values", () => {
  assert.deepEqual(requestHeadersForReplay([
    { name: "Content-Type", value: "application/graphql" },
    { name: "Content-Length", value: "128" },
    { name: "Cookie", value: "session=secret" },
    { name: "Origin", value: "https://example.test" },
    { name: "Sec-Fetch-Site", value: "same-origin" },
    { name: "X-Client-Version", value: "42" },
    { name: "Authorization", value: "Bearer token" }
  ]), {
    "content-type": "application/json",
    "x-client-version": "42",
    "authorization": "Bearer token"
  });
});

test("copied fetch requests use page credentials without forbidden headers", () => {
  const output = toFetch({
    url: "https://api.example.test/graphql",
    method: "POST",
    requestHeaders: [
      { name: "Cookie", value: "session=secret" },
      { name: "Authorization", value: "Bearer secret-token" },
      { name: "Content-Length", value: "99" },
      { name: "X-Client-Version", value: "42" }
    ],
    requestBody: "{\"query\":\"{ viewer { id } }\"}"
  });

  assert.match(output, /"credentials": "include"/);
  assert.match(output, /"x-client-version": "42"/);
  assert.doesNotMatch(output, /session=secret|secret-token|authorization|Content-Length/i);
});

test("copied GET requests omit JSON headers and request bodies", () => {
  const output = toFetch({
    url: "https://api.example.test/graphql?query=%7Bviewer%7Bid%7D%7D",
    method: "GET",
    requestHeaders: [{ name: "Cookie", value: "session=secret" }],
    requestBody: "query={viewer{id}}",
  });

  assert.doesNotMatch(output, /content-type|session=secret|"body"/i);
});

test("default exports remove captured credentials without changing useful headers", () => {
  const operation = {
    requestHeaders: [
      { name: "Authorization", value: "Bearer secret-token" },
      { name: "Cookie", value: "session=secret-cookie" },
      { name: "X-Client-Version", value: "42" },
    ],
    responseHeaders: [
      { name: "Set-Cookie", value: "session=rotated-secret" },
      { name: "Content-Type", value: "application/json" },
    ],
    requestBody: '{"query":"query Viewer { viewer { id } }"}',
    url: "https://api.example.test/graphql",
    method: "POST",
  };

  const curl = toCurl(operation);
  const exported = sanitiseOperationsForExport([operation]);

  assert.doesNotMatch(curl, /secret-token|secret-cookie|authorization|cookie/i);
  assert.match(curl, /X-Client-Version: 42/);
  assert.deepEqual(exported[0].requestHeaders, [
    { name: "X-Client-Version", value: "42" },
  ]);
  assert.deepEqual(exported[0].responseHeaders, [
    { name: "Content-Type", value: "application/json" },
  ]);
  assert.equal(operation.requestHeaders.length, 3);
});

test("credential classifier covers common custom token and secret headers", () => {
  for (const name of [
    "X-Access-Token",
    "X-Client-Secret",
    "Session-Token",
    "X-Csrf-Token",
    "X-API-Key",
    "X-Secret-Key",
  ]) {
    assert.equal(isSensitiveHeaderName(name), true, name);
  }
  assert.equal(isSensitiveHeaderName("X-Client-Version"), false);
});

test("header inspection preserves repeated values", () => {
  assert.deepEqual(headersToObject([
    { name: "set-cookie", value: "first=1" },
    { name: "set-cookie", value: "second=2" },
    { name: "content-type", value: "application/json" },
    null
  ]), {
    "set-cookie": ["first=1", "second=2"],
    "content-type": "application/json"
  });
});

test("header conversion ignores prototype mutation keys", () => {
  const headers = [
    { name: "__proto__", value: "polluted" },
    { name: "constructor", value: "polluted" },
    { name: "x-safe", value: "safe" },
  ];

  assert.deepEqual(headersToObject(headers), { "x-safe": "safe" });
  assert.deepEqual(requestHeadersForReplay(headers), {
    "content-type": "application/json",
    "x-safe": "safe",
  });
  assert.equal({}.polluted, undefined);
});
