import { hasGraphQLErrors, safeJsonParse } from "./graphql.js";

const SEARCH_FIELD_LIMIT = 50000;

export function isErrorItem(item) {
  return Number(item?.status) >= 400 || hasGraphQLErrors(item?.response);
}

export function getOperationCounts(items) {
  return items.reduce((counts, item) => {
    const type = ["query", "mutation", "subscription"].includes(item.operationType)
      ? item.operationType
      : "unknown";
    counts[type] += 1;
    if (isErrorItem(item)) counts.errors += 1;
    return counts;
  }, { query: 0, mutation: 0, subscription: 0, unknown: 0, errors: 0 });
}

export function filterItems(items, { search = "", type = "all", errorsOnly = false } = {}) {
  const needle = search.trim().toLowerCase();
  return items.filter(item => {
    if (type !== "all" && item.operationType !== type) return false;
    if (errorsOnly && !isErrorItem(item)) return false;
    if (!needle) return true;
    item.searchIndex ||= buildSearchIndex(item);
    return item.searchIndex.includes(needle);
  });
}

export function parseOptionalJson(value, label) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = safeJsonParse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

export function buildSearchIndex(item) {
  return [
    item.operationName,
    item.operationType,
    item.method,
    item.status,
    item.url,
    item.query,
    boundedJson(item.variables),
    boundedJson(item.extensions),
    boundedText(item.responseRaw),
    boundedJson(item.response)
  ].filter(value => value !== undefined && value !== null && value !== "")
    .join("\n")
    .toLowerCase();
}

export function boundedJson(value, limit = SEARCH_FIELD_LIMIT) {
  try {
    return boundedText(JSON.stringify(value), limit);
  } catch {
    return "";
  }
}

export function boundedText(value, limit = SEARCH_FIELD_LIMIT) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > limit ? text.slice(0, limit) : text;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[character]
  ));
}

export function isJsonLike(value) {
  return /^[\s]*[{[]/.test(value);
}

export function highlightJson(value) {
  return escapeHtml(value).replace(
    /(&quot;(?:\\.|[^\\])*?&quot;)(\s*:)?|\b(true|false)\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi,
    (match, string, colon, boolean) => {
      if (string) return colon ? `<span class="json-key">${string}</span>${colon}` : `<span class="json-string">${string}</span>`;
      if (boolean) return `<span class="json-boolean">${boolean}</span>`;
      if (match === "null") return '<span class="json-null">null</span>';
      return `<span class="json-number">${match}</span>`;
    }
  );
}

export function formatDuration(duration) {
  if (duration === null || duration === undefined) return "live";
  const milliseconds = Math.max(0, Number(duration) || 0);
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 10000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.round(milliseconds / 1000)}s`;
}

export function formatRelativeTime(startedAt, now = Date.now()) {
  if (startedAt === null || startedAt === "") return "unknown";
  const timestamp = Number(startedAt);
  if (!Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatAbsoluteTime(startedAt) {
  if (startedAt === null || startedAt === "") return "Unknown";
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3
  });
}

export function shortUrl(value) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}`;
  } catch {
    return value;
  }
}

export function badgeType(item) {
  return ["query", "mutation", "subscription"].includes(item.operationType)
    ? item.operationType
    : "unknown";
}

export function badgeLabel(item) {
  return ["query", "mutation", "subscription"].includes(item.operationType)
    ? item.operationType
    : "other";
}
