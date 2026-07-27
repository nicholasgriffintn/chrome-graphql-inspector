import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const projectRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", projectRoot), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("package.json", projectRoot), "utf8"));

test("release metadata stays aligned", () => {
  assert.equal(manifest.version, packageJson.version);
  assert.match(packageJson.scripts.package, /zip -FS -r/);
});

test("page instrumentation is not statically injected by default", () => {
  assert.ok(manifest.permissions.includes("scripting"));
  assert.equal(
    manifest.content_scripts.some(script => script.js.includes("src/page-hook.js")),
    false,
  );
});

test("the toolbar action explains how to open the DevTools panel", () => {
  assert.equal(manifest.action.default_popup, "src/popup.html");
  const popup = readFileSync(new URL(manifest.action.default_popup, projectRoot), "utf8");
  assert.match(popup, /GraphQL Inspector lives in DevTools/);
  assert.match(popup, /id="backgroundCapture"/);
  assert.match(popup, /type="module" src="popup\.js"/);
  assert.match(popup, /\.\.\/icons\/icon48\.png/);
});
