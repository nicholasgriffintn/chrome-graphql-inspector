import { formatJson, safeJsonParse } from "./graphql.js";
import { escapeHtml, highlightJson, isJsonLike } from "./panel-model.js";

const TREE_CHILD_LIMIT = 200;
const RAW_PREVIEW_LIMIT = 200000;

export function renderCode(element, value) {
  const formatted = formatJson(value) || String(value ?? "");
  element.innerHTML = isJsonLike(formatted) ? highlightJson(formatted) : escapeHtml(formatted);
}

export function renderRawCode(element, value) {
  const raw = typeof value === "string" ? value : formatJson(value);
  if (raw.length > RAW_PREVIEW_LIMIT) {
    const preview = raw.slice(0, RAW_PREVIEW_LIMIT);
    element.textContent = `${preview}\n\n... truncated preview: showing ${RAW_PREVIEW_LIMIT.toLocaleString()} of ${raw.length.toLocaleString()} characters. Use Export or Copy JSON for the full payload.`;
    return;
  }
  renderCode(element, value);
}

export function renderObjectTree(element, value) {
  element.replaceChildren();
  const parsed = typeof value === "string" ? safeJsonParse(value) : value;
  if (!parsed || typeof parsed !== "object") {
    const empty = document.createElement("pre");
    renderCode(empty, value);
    element.append(empty);
    return;
  }
  element.append(createTreeNode(parsed, "root", true));
}

function createTreeNode(value, label = "", root = false) {
  if (!value || typeof value !== "object") return createPrimitiveNode(label, value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : Object.entries(value);
  const details = document.createElement("details");
  details.className = "tree-node";
  details.open = root;
  const summary = document.createElement("summary");
  summary.append(createLabel(label, value, entries.length, root));
  details.append(summary);
  if (root) {
    appendTreeChildren(details, entries);
  } else {
    details.addEventListener("toggle", () => {
      if (details.open && !details.dataset.loaded) appendTreeChildren(details, entries);
    }, { once: true });
  }
  return details;
}

function appendTreeChildren(details, entries, showAll = false) {
  details.dataset.loaded = "true";
  Array.from(details.children)
    .find(child => child.classList.contains("tree-children"))
    ?.remove();
  const children = document.createElement("div");
  children.className = "tree-children";
  const visibleEntries = showAll ? entries : entries.slice(0, TREE_CHILD_LIMIT);
  for (const [key, child] of visibleEntries) children.append(createTreeNode(child, key));
  if (!showAll && entries.length > TREE_CHILD_LIMIT) {
    const button = document.createElement("button");
    button.className = "tree-more";
    button.type = "button";
    button.textContent = `Show ${entries.length - TREE_CHILD_LIMIT} more`;
    button.onclick = event => {
      event.stopPropagation();
      appendTreeChildren(details, entries, true);
    };
    children.append(button);
  }
  details.append(children);
}

function createPrimitiveNode(label, value) {
  const row = document.createElement("div");
  row.className = "tree-leaf";
  row.append(createKey(label), document.createTextNode(": "));
  const span = document.createElement("span");
  span.className = `json-${value === null ? "null" : typeof value}`;
  span.textContent = value === null ? "null" : JSON.stringify(value);
  row.append(span);
  return row;
}

function createLabel(label, value, size, root) {
  const fragment = document.createDocumentFragment();
  if (!root) fragment.append(createKey(label), document.createTextNode(": "));
  fragment.append(document.createTextNode(Array.isArray(value) ? "[" : "{"));
  const count = document.createElement("span");
  count.className = "tree-count";
  count.textContent = ` ${size} ${size === 1 ? "item" : "items"} `;
  fragment.append(count, document.createTextNode(Array.isArray(value) ? "]" : "}"));
  return fragment;
}

function createKey(value) {
  const key = document.createElement("span");
  key.className = "json-key";
  key.textContent = typeof value === "number" || /^\d+$/.test(String(value))
    ? String(value)
    : `"${value}"`;
  return key;
}
