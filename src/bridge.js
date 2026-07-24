let active = true;

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
  sendMessage(message);
}

window.addEventListener("message", handleMessage);

sendMessage({ source: "private-graphql-inspector", type: "content-ready", at: Date.now() });
