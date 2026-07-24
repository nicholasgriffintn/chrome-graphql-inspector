import test from "node:test";
import assert from "node:assert/strict";
import { inferOperationName, inferOperationType, looksGraphQL, parseGraphQLPayload, parseMultipart, hasGraphQLErrors } from "../src/graphql.js";

test("infers operation", () => {
  assert.equal(inferOperationType("mutation SaveThing { saveThing }"), "mutation");
  assert.equal(inferOperationName("query User($id: ID!) { user(id:$id) { id } }"), "User");
  assert.equal(inferOperationType("{ viewer { id } }"), "query");
});

test("splits batches", () => {
  const result = parseGraphQLPayload(JSON.stringify([{ query: "query A { a }" }, { query: "mutation B { b }", variables: { x: 1 } }]));
  assert.equal(result.length, 2); assert.equal(result[1].operationName, "B"); assert.deepEqual(result[1].variables, { x: 1 });
});

test("handles persisted queries", () => {
  const result = parseGraphQLPayload(JSON.stringify({ operationName: "GetUser", extensions: { persistedQuery: { sha256Hash: "abcdef012345" } } }))[0];
  assert.equal(result.persisted, true); assert.equal(result.operationName, "GetUser");
});

test("parses url encoded queries", () => {
  const result = parseGraphQLPayload("operationName=GetUser&query=query%20GetUser%20%7B%20viewer%20%7B%20id%20%7D%20%7D")[0];
  assert.equal(result.operationName, "GetUser");
  assert.equal(result.operationType, "query");
});

test("parses double encoded GET query parameters", () => {
  const params = new URLSearchParams({
    operationName: encodeURIComponent("GetUser"),
    query: encodeURIComponent("query GetUser { viewer { id } }"),
    variables: encodeURIComponent(JSON.stringify({ id: "1" }))
  });
  const result = parseGraphQLPayload("", `https://example.com/api?${params}`)[0];
  assert.equal(result.operationName, "GetUser");
  assert.equal(result.operationType, "query");
  assert.deepEqual(result.variables, { id: "1" });
});

test("parses persisted GET query parameters", () => {
  const params = new URLSearchParams({
    operationName: "GetUser",
    extensions: encodeURIComponent(JSON.stringify({ persistedQuery: { sha256Hash: "abcdef012345" } }))
  });
  const result = parseGraphQLPayload("", `https://example.com/api?${params}`)[0];
  assert.equal(result.operationName, "GetUser");
  assert.equal(result.operationType, "unknown");
  assert.equal(result.persisted, true);
});

test("parses multipart upload operations", () => {
  const body = [
    "------boundary",
    "Content-Disposition: form-data; name=\"operations\"",
    "",
    "{\"operationName\":\"UploadFile\",\"variables\":{\"file\":null},\"query\":\"mutation UploadFile($file: Upload!) { upload(file: $file) { id } }\"}",
    "------boundary",
    "Content-Disposition: form-data; name=\"map\"",
    "",
    "{\"1\":[\"variables.file\"]}",
    "------boundary--",
    ""
  ].join("\r\n");
  const result = parseGraphQLPayload(body)[0];
  assert.equal(result.operationName, "UploadFile");
  assert.equal(result.operationType, "mutation");
  assert.deepEqual(result.variables, { file: null });
});

test("detects GraphQL request starts", () => {
  assert.equal(looksGraphQL({ url: "https://example.com/api", method: "POST", postData: "operationName=GetUser" }), true);
  assert.equal(looksGraphQL({ url: "https://example.com/graphql?query=query%20GetUser%20%7B%20viewer%20%7B%20id%20%7D%20%7D", method: "GET" }), true);
  assert.equal(looksGraphQL({ url: "https://example.com/gql", method: "POST", postData: JSON.stringify({ query: "{ viewer { id } }" }) }), true);
  assert.equal(looksGraphQL({ url: "https://example.com/api", method: "GET", responseText: JSON.stringify({ data: { viewer: { id: "1" } } }) }), true);
});

test("does not infer GraphQL from pathnames alone", () => {
  assert.equal(looksGraphQL({ url: "https://example.com/graphql", method: "GET" }), false);
  assert.equal(looksGraphQL({ url: "https://example.com/gql", method: "POST", postData: "" }), false);
});

test("ignores static assets with graphql in the filename", () => {
  assert.equal(looksGraphQL({
    url: "https://static.example.test/assets/graphql-client.js",
    method: "GET",
    postData: "",
    responseText: "export const query = {}; const data = {}; const errors = [];"
  }), false);
});

test("parses multipart", () => {
  const text = "--abc\r\ncontent-type: application/json\r\n\r\n{\"data\":{\"a\":1}}\r\n--abc--";
  assert.deepEqual(parseMultipart(text, "multipart/mixed; boundary=abc"), [{ data: { a: 1 } }]);
});

test("detects errors", () => { assert.equal(hasGraphQLErrors({ errors: [{ message: "bad" }] }), true); });
