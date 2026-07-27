import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const popupHtml = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");

test("the toolbar popup persists the optional background-capture preference", async () => {
  const dom = new JSDOM(popupHtml, { url: "https://extension.test" });
  const writes = [];
  let storageListener;
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ backgroundCapture: true }),
        set: async value => { writes.push(value); },
      },
      onChanged: {
        addListener(listener) {
          storageListener = listener;
        },
      },
    },
  };

  try {
    await import(`../src/popup.js?test=${Date.now()}`);
    await new Promise(resolve => setImmediate(resolve));

    const toggle = document.getElementById("backgroundCapture");
    const status = document.getElementById("captureStatus");
    assert.equal(toggle.checked, true);
    assert.match(status.textContent, /^On/);

    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event("change"));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes, [{ backgroundCapture: false }]);
    assert.match(status.textContent, /^Off/);

    storageListener({
      backgroundCapture: { oldValue: false, newValue: true },
    }, "local");
    assert.equal(toggle.checked, true);
  } finally {
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

test("the toolbar popup restores the previous value when saving fails", async () => {
  const dom = new JSDOM(popupHtml, { url: "https://extension.test" });
  globalThis.document = dom.window.document;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ backgroundCapture: false }),
        set: async () => {
          throw new Error("Storage unavailable");
        },
      },
      onChanged: { addListener() {} },
    },
  };

  try {
    await import(`../src/popup.js?failure=${Date.now()}`);
    await new Promise(resolve => setImmediate(resolve));

    const toggle = document.getElementById("backgroundCapture");
    toggle.checked = true;
    toggle.dispatchEvent(new dom.window.Event("change"));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(toggle.checked, false);
    assert.equal(toggle.disabled, false);
    assert.match(
      document.getElementById("captureStatus").textContent,
      /could not be saved/,
    );
  } finally {
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});
