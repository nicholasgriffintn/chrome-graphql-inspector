let active = true;
const allowedMessageTypes = new Set([
  "content-ready",
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
  if (message.type !== "content-ready" && !Number.isFinite(message.at)) return;
  if (message.type.startsWith("http-request-") && (typeof message.requestId !== "string" || typeof message.url !== "string")) return;
  if (message.type.startsWith("ws-") && (typeof message.socketId !== "string" || typeof message.url !== "string")) return;
  if (message.type.startsWith("sse-") && (typeof message.sourceId !== "string" || typeof message.url !== "string")) return;
  if (message.type === "ws-frame" && typeof message.data !== "string") return;
  if (message.type === "graphiql-result" && typeof message.graphiqlRequestId !== "string") return;
  sendMessage(message);
}

window.addEventListener("message", handleMessage);

sendMessage({ source: "private-graphql-inspector", type: "content-ready", at: Date.now() });
