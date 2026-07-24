export function safeJsonParse(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function parseGraphQLPayload(raw, url = "") {
  let body = raw;
  if (typeof body === "string") {
    const multipart = parseMultipartRequestBody(body);
    if (multipart) body = multipart;
  }
  if (typeof body === "string") {
    const parsed = safeJsonParse(body);
    if (parsed !== null) body = parsed;
    else if (/(^|&)(query|operationName|variables|extensions)=/.test(body)) body = Object.fromEntries(new URLSearchParams(body));
  }
  if (!body && url) {
    try {
      const u = new URL(url, "https://example.invalid");
      body = Object.fromEntries(u.searchParams.entries());
    } catch {
      // Ignore invalid/relative URLs with no parsable query string.
    }
  }
  const entries = Array.isArray(body) ? body : [body];
  return entries.filter(Boolean).map((item, index) => normalizePayload(decodePayloadParams(item), index));
}

function normalizePayload(item, index) {
  const extensions = typeof item.extensions === "string" ? safeJsonParse(decodeParam(item.extensions)) : item.extensions;
  const variables = typeof item.variables === "string" ? (safeJsonParse(decodeParam(item.variables)) ?? decodeParam(item.variables)) : item.variables;
  const query = typeof item.query === "string" ? decodeParam(item.query) : "";
  const operationName = item.operationName || inferOperationName(query) || persistedName(extensions) || `Operation ${index + 1}`;
  return {
    query,
    operationName,
    operationType: inferOperationType(query),
    variables: variables ?? {},
    extensions: extensions ?? {},
    persisted: Boolean(extensions?.persistedQuery)
  };
}

function decodePayloadParams(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === "string" ? decodeParam(value) : value]));
}

function decodeParam(value) {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(current.replace(/\+/g, " "));
      if (decoded === current) return decoded;
      current = decoded;
    } catch {
      return current;
    }
  }
  return current;
}

function parseMultipartRequestBody(text) {
  if (!/name="operations"/.test(text)) return null;
  const operationsStart = text.indexOf('name="operations"');
  const bodyStart = text.indexOf("\r\n\r\n", operationsStart);
  const lineEnding = bodyStart === -1 ? "\n\n" : "\r\n\r\n";
  const fallbackBodyStart = bodyStart === -1 ? text.indexOf("\n\n", operationsStart) : bodyStart;
  if (fallbackBodyStart === -1) return null;
  const valueStart = fallbackBodyStart + lineEnding.length;
  const boundaryStart = text.indexOf("\r\n--", valueStart);
  const fallbackBoundaryStart = boundaryStart === -1 ? text.indexOf("\n--", valueStart) : boundaryStart;
  const value = text.slice(valueStart, fallbackBoundaryStart === -1 ? undefined : fallbackBoundaryStart).trim();
  return safeJsonParse(value);
}

function persistedName(extensions) {
  const hash = extensions?.persistedQuery?.sha256Hash;
  return hash ? `Persisted ${hash.slice(0, 8)}` : "";
}

export function inferOperationType(query = "") {
  const stripped = query.replace(/#[^\n\r]*/g, "").trim();
  const match = stripped.match(/^(query|mutation|subscription)\b/i);
  if (match) return match[1].toLowerCase();
  if (stripped.startsWith("{")) return "query";
  return "unknown";
}

export function inferOperationName(query = "") {
  const stripped = query.replace(/#[^\n\r]*/g, "");
  const match = stripped.match(/\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/);
  return match?.[1] || "";
}

export function looksGraphQL({ url = "", method = "", postData = "", responseText = "" }) {
  const body = typeof postData === "string" ? postData : JSON.stringify(postData || "");
  if (/\b(query|mutation|subscription)\b|"?operationName"?|persistedQuery/.test(body)) return true;
  return (method === "GET" && /[?&](query|operationName|extensions)=/.test(url)) || hasGraphQLResponseShape(responseText);
}

function hasGraphQLResponseShape(responseText) {
  const response = safeJsonParse(responseText);
  const entries = Array.isArray(response) ? response : [response];
  return entries.some(item => (
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && (Object.hasOwn(item, "data") || Object.hasOwn(item, "errors"))
  ));
}

export function parseMultipart(text, contentType = "") {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean)?.trim();
  if (!boundary || !text) return null;
  const parts = text.split(`--${boundary}`).map(p => p.trim()).filter(p => p && p !== "--");
  return parts.map(part => {
    const body = part.split(/\r?\n\r?\n/).slice(1).join("\n\n");
    return safeJsonParse(body) ?? body;
  });
}

export function formatJson(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") {
    const parsed = safeJsonParse(value);
    if (parsed !== null) return JSON.stringify(parsed, null, 2);
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function hasGraphQLErrors(response) {
  const inspect = value => Boolean(value && typeof value === "object" && Array.isArray(value.errors) && value.errors.length);
  if (Array.isArray(response)) return response.some(inspect);
  return inspect(response);
}
