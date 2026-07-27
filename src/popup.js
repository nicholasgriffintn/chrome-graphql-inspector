import { DEFAULT_SETTINGS } from "./settings.js";

const backgroundCapture = document.getElementById("backgroundCapture");
const captureStatus = document.getElementById("captureStatus");

function renderStatus(enabled, message = "", error = false) {
  captureStatus.textContent = message || (
    enabled
      ? "On — traffic is kept for this browser session."
      : "Off — capture starts when the GraphQL panel opens."
  );
  captureStatus.classList.toggle("error", error);
}

async function loadSetting() {
  try {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    backgroundCapture.checked = settings.backgroundCapture;
    renderStatus(settings.backgroundCapture);
  } catch {
    backgroundCapture.disabled = true;
    renderStatus(false, "The capture preference could not be loaded.", true);
  }
}

backgroundCapture.addEventListener("change", async () => {
  const enabled = backgroundCapture.checked;
  backgroundCapture.disabled = true;
  renderStatus(enabled, "Saving…");
  try {
    await chrome.storage.local.set({ backgroundCapture: enabled });
    renderStatus(enabled);
  } catch {
    backgroundCapture.checked = !enabled;
    renderStatus(!enabled, "The capture preference could not be saved.", true);
  } finally {
    backgroundCapture.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  const change = changes.backgroundCapture;
  if (areaName !== "local" || !change) return;
  backgroundCapture.checked = Boolean(change.newValue);
  renderStatus(backgroundCapture.checked);
});

void loadSetting();
