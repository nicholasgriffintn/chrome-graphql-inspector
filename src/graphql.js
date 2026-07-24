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
    else if (isGraphQLDocument(body)) body = { query: body };
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
    operationType: inferOperationType(query, operationName),
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

export function inferOperationType(query = "", operationName = "") {
  const stripped = searchableGraphQLDocument(query).trim();
  if (stripped.startsWith("{")) return "query";
  const namedMatch = operationName && !/^Operation \d+$/.test(operationName)
    ? stripped.match(new RegExp(`\\b(query|mutation|subscription)\\s+${escapeRegExp(operationName)}\\b`, "i"))
    : null;
  const match = namedMatch || stripped.match(/\b(query|mutation|subscription)\b/i);
  if (match) return match[1].toLowerCase();
  const nameSuffix = String(operationName).match(/(query|mutation|subscription)$/i);
  if (nameSuffix) return nameSuffix[1].toLowerCase();
  return "unknown";
}

export function inferOperationTypeFromHeaders(headers = []) {
  const header = headers.find(candidate => {
    const { name, value } = candidate || {};
    return (
      /(?:^|[-_.])operation[-_.]?type$/i.test(String(name)) &&
      /^(query|mutation|subscription)$/i.test(String(value).trim())
    );
  });
  return header ? String(header.value).trim().toLowerCase() : "unknown";
}

export function inferOperationName(query = "") {
  const stripped = searchableGraphQLDocument(query);
  const match = stripped.match(/\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/);
  return match?.[1] || "";
}

export function looksGraphQL({ url = "", method = "", postData = "", responseText = "" }) {
  const body = typeof postData === "string" ? postData : JSON.stringify(postData || "");
  const parsedBody = safeJsonParse(body);
  if (hasGraphQLPayloadShape(parsedBody) || (parsedBody === null && isGraphQLDocument(body))) return true;
  if (/(^|&)(query|operationName|extensions)=/.test(body)) {
    const params = Object.fromEntries(new URLSearchParams(body));
    if (hasGraphQLPayloadShape(params)) return true;
  }
  if (String(method).toUpperCase() === "GET") {
    try {
      const params = Object.fromEntries(new URL(url, "https://example.invalid").searchParams);
      if (hasGraphQLPayloadShape(params)) return true;
    } catch {
      // Ignore URLs that cannot contain a GraphQL query.
    }
  }
  return hasGraphQLResponseShape(responseText);
}

function hasGraphQLPayloadShape(value) {
  const entries = Array.isArray(value) ? value : [value];
  return entries.some(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const query = typeof item.query === "string" ? decodeParam(item.query) : "";
    if (query && isGraphQLDocument(query)) return true;
    if (typeof item.operationName === "string" && item.operationName.trim()) return true;
    const extensions = typeof item.extensions === "string"
      ? safeJsonParse(decodeParam(item.extensions))
      : item.extensions;
    return Boolean(extensions?.persistedQuery);
  });
}

function isGraphQLDocument(value) {
  const document = searchableGraphQLDocument(value).trim();
  if (!document.includes("{")) return false;
  if (document.startsWith("{")) return true;
  if (/^(query|mutation|subscription)\b/i.test(document)) return true;
  return /^fragment\b/i.test(document) && /\b(query|mutation|subscription)\b/i.test(document);
}

function searchableGraphQLDocument(value) {
  return String(value || "")
    .replace(/"""[\s\S]*?"""/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/#[^\n\r]*/g, " ");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function formatGraphQLQuery(query) {
  const text = String(query || "").trim();
  if (!text) return "";
  let formatted = "";
  let indent = 0;
  let inString = false;
  let quote = "";
  let escaping = false;
  const writeIndent = () => { formatted += "  ".repeat(Math.max(indent, 0)); };
  const trimLineEnd = () => { formatted = formatted.replace(/[ \t]+$/g, ""); };
  const newline = () => {
    trimLineEnd();
    if (!formatted.endsWith("\n")) formatted += "\n";
    writeIndent();
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      formatted += character;
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === quote) inString = false;
      continue;
    }
    if (character === "\"" || character === "'") {
      inString = true;
      quote = character;
      formatted += character;
      continue;
    }
    if (/\s/.test(character)) {
      if (!/[\s({[]$/.test(formatted)) formatted += " ";
      continue;
    }
    if (character === "{") {
      trimLineEnd();
      formatted += " {";
      indent += 1;
      newline();
      continue;
    }
    if (character === "}") {
      indent -= 1;
      newline();
      formatted += "}";
      if (text.slice(index + 1).trim()) newline();
      continue;
    }
    if (character === ",") {
      formatted += ", ";
      continue;
    }
    formatted += character;
  }
  return formatted.trim();
}

export function hasGraphQLErrors(response) {
  const inspect = value => Boolean(value && typeof value === "object" && Array.isArray(value.errors) && value.errors.length);
  if (Array.isArray(response)) return response.some(inspect);
  return inspect(response);
}
