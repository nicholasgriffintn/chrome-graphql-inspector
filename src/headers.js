const BROWSER_MANAGED_HEADER = /^(?:accept-encoding|connection|content-encoding|content-length|cookie|dnt|host|origin|referer|te|trailer|transfer-encoding|upgrade|user-agent|via|proxy-|sec-)/i;
const SENSITIVE_HEADER = /^(?:authorization|cookie|set-cookie|proxy-authorization|x-api-key|api-key|x-auth-token)$/i;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function requestHeadersForReplay(
  headers = [],
  { includeJsonContentType = true } = {},
) {
  const replayHeaders = includeJsonContentType
    ? { "content-type": "application/json" }
    : {};
  for (const header of headers) {
    const name = String(header?.name || "").trim().toLowerCase();
    if (
      !name ||
      name === "content-type" ||
      BROWSER_MANAGED_HEADER.test(name) ||
      UNSAFE_OBJECT_KEYS.has(name)
    ) {
      continue;
    }
    replayHeaders[name] = String(header?.value ?? "");
  }
  return replayHeaders;
}

export function headersToObject(headers = []) {
  const result = {};
  for (const header of headers) {
    const name = String(header?.name || "").trim().toLowerCase();
    if (!name || UNSAFE_OBJECT_KEYS.has(name)) continue;
    const value = String(header?.value ?? "");
    if (!Object.hasOwn(result, name)) {
      result[name] = value;
    } else if (Array.isArray(result[name])) {
      result[name].push(value);
    } else {
      result[name] = [result[name], value];
    }
  }
  return result;
}

export function headersWithoutSensitiveValues(headers = []) {
  return headers.filter(header => {
    const name = String(header?.name || "").trim();
    return name && !SENSITIVE_HEADER.test(name);
  });
}
