import {
  badgeLabel,
  badgeType,
  escapeHtml,
  formatDuration,
  formatRelativeTime,
  isErrorItem,
  operationStatusLabel,
  shortUrl,
} from "./panel-model.js";

const ROW_HEIGHT = 70;
const ROW_OVERSCAN = 8;
const VIRTUALISE_AFTER = 100;

export function createRequestList({
  list,
  viewport,
  onSelect,
  onKeydown,
}) {
  let renderFrame;

  function render(items, selectedId) {
    const viewportHeight = viewport.clientHeight;
    const virtualise = viewportHeight > 0 && items.length > VIRTUALISE_AFTER;
    const start = virtualise
      ? Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - ROW_OVERSCAN)
      : 0;
    const visibleCount = virtualise
      ? Math.ceil(viewportHeight / ROW_HEIGHT) + (ROW_OVERSCAN * 2)
      : items.length;
    const end = Math.min(items.length, start + visibleCount);
    const rows = items
      .slice(start, end)
      .map((item) => createRow(item, items, selectedId, onSelect, onKeydown));
    if (start > 0) rows.unshift(createSpacer(start * ROW_HEIGHT));
    if (end < items.length) rows.push(createSpacer((items.length - end) * ROW_HEIGHT));
    list.replaceChildren(...rows);
  }

  function ensureVisible(items, selectedId) {
    if (Array.from(list.children).some(row => row.dataset.requestId === selectedId)) {
      return;
    }
    const selectedIndex = items.findIndex(item => item.id === selectedId);
    if (selectedIndex === -1) return;
    viewport.scrollTop = selectedIndex * ROW_HEIGHT;
    render(items, selectedId);
  }

  function schedule(getSnapshot) {
    if (renderFrame !== undefined) return;
    const scheduleFrame = globalThis.requestAnimationFrame
      || (callback => setTimeout(callback, 0));
    renderFrame = scheduleFrame(() => {
      renderFrame = undefined;
      const { items, selectedId } = getSnapshot();
      render(items, selectedId);
    });
    renderFrame?.unref?.();
  }

  return Object.freeze({ ensureVisible, render, schedule });
}

function createRow(item, items, selectedId, onSelect, onKeydown) {
  const row = document.createElement("div");
  const error = isErrorItem(item);
  const selected = item.id === selectedId;
  row.className = `request${selected ? " selected" : ""}${error ? " error" : ""}`;
  row.role = "option";
  row.tabIndex = selected ? 0 : -1;
  row.dataset.requestId = item.id;
  row.setAttribute("aria-selected", String(selected));
  row.innerHTML = `
    <span class="badge ${badgeType(item)}">${escapeHtml(badgeLabel(item))}</span>
    <span class="request-main">
      <span class="operation" title="${escapeHtml(item.operationName)}">${escapeHtml(item.operationName)}</span>
      <span class="endpoint" title="${escapeHtml(item.url)}">${escapeHtml(shortUrl(item.url))}</span>
    </span>
    <span class="request-meta">
      <span class="request-status">${escapeHtml(operationStatusLabel(item))}</span>
      <span>${escapeHtml(formatDuration(item.duration))}</span>
      <span class="request-time" data-started-at="${escapeHtml(String(item.startedAt))}">${escapeHtml(formatRelativeTime(item.startedAt))}</span>
    </span>`;
  row.onclick = () => onSelect(item.id);
  row.onkeydown = event => onKeydown(event, items, item.id);
  return row;
}

function createSpacer(height) {
  const spacer = document.createElement("div");
  spacer.className = "request-list-spacer";
  spacer.style.height = `${height}px`;
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}
