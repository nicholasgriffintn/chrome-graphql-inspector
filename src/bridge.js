let active = true;
const MAX_TEXT_LENGTH = 512 * 1024;
const MAX_MESSAGE_LENGTH = 1024 * 1024;
const MAX_MESSAGES_PER_SECOND = 100;
let messageWindowStartedAt = Date.now();
let messageWindowCount = 0;
const allowedMessageTypes = new Set([
  "graphiql-result",
  "http-request-start",
  "http-request-complete",
  "http-request-error",
  "ws-open",
  "ws-frame",
  "ws-close",
  "sse-open",
  "sse-message",
  "sse-close",
  "sse-error"
]);

function sendMessage(message) {
  if (!active) return;
  try {
    if (!chrome?.runtime?.id) {
      active = false;
      return;
    }
    chrome.runtime.sendMessage(message, () => {
      try {
        void chrome.runtime.lastError;
      } catch {
        active = false;
      }
    });
  } catch {
    active = false;
  }
}

function handleMessage(event) {
  if (!active) {
    window.removeEventListener("message", handleMessage);
    return;
  }
  if (event.source !== window) return;
  const message = event.data;
  if (message?.source !== "private-graphql-inspector") return;
  if (!allowedMessageTypes.has(message.type)) return;
  if (!isSafeMessageSize(message) || !withinMessageRateLimit()) return;
  if (message.type !== "content-ready" && !Number.isFinite(message.at)) return;
  if (message.type.startsWith("http-request-") && (typeof message.requestId !== "string" || typeof message.url !== "string")) return;
  if (message.type.startsWith("ws-") && (typeof message.socketId !== "string" || typeof message.url !== "string")) return;
  if (message.type.startsWith("sse-") && (typeof message.sourceId !== "string" || typeof message.url !== "string")) return;
  if (message.type === "ws-frame" && typeof message.data !== "string") return;
  if (message.type === "graphiql-result" && typeof message.graphiqlRequestId !== "string") return;
  sendMessage(message);
}

function isSafeMessageSize(message) {
  for (const field of ["data", "requestBody", "responseText", "error", "reason"]) {
    if (typeof message[field] === "string" && message[field].length > MAX_TEXT_LENGTH) return false;
  }
  if (typeof message.url === "string" && message.url.length > 8192) return false;
  try {
    return JSON.stringify(message).length <= MAX_MESSAGE_LENGTH;
  } catch {
    return false;
  }
}

function withinMessageRateLimit(now = Date.now()) {
  if (now - messageWindowStartedAt >= 1000) {
    messageWindowStartedAt = now;
    messageWindowCount = 0;
  }
  messageWindowCount += 1;
  return messageWindowCount <= MAX_MESSAGES_PER_SECOND;
}

window.addEventListener("message", handleMessage);
chrome.runtime.onMessage?.addListener(message => {
  if (
    message?.type === "CAPTURE_STATE_CHANGED"
    && typeof message.enabled === "boolean"
  ) {
    window.postMessage({
      source: "private-graphql-inspector-control",
      type: "capture-state",
      enabled: message.enabled
    }, "*");
  }
});

sendMessage({ source: "private-graphql-inspector", type: "content-ready", at: Date.now() });
