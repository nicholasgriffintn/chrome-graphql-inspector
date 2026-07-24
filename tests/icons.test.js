import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const projectRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", projectRoot), "utf8"));
const devtoolsScript = readFileSync(new URL("src/devtools.js", projectRoot), "utf8");
const panelHtml = readFileSync(new URL("src/panel.html", projectRoot), "utf8");

test("provides correctly sized PNG assets for every manifest icon", () => {
  for (const [declaredSize, relativePath] of Object.entries(manifest.icons)) {
    const iconPath = new URL(relativePath, projectRoot);
    assert.equal(existsSync(iconPath), true, relativePath);
    const png = readFileSync(iconPath);
    assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), Number(declaredSize), `${relativePath} width`);
    assert.equal(png.readUInt32BE(20), Number(declaredSize), `${relativePath} height`);
  }
});

test("uses the packaged icon set for Chrome actions and the in-panel brand", () => {
  assert.deepEqual(manifest.action.default_icon, {
    16: manifest.icons["16"],
    32: manifest.icons["32"]
  });
  assert.match(devtoolsScript, new RegExp(`"${manifest.icons["32"].replace(".", "\\.")}"`));
  assert.match(panelHtml, /class="brand-icon" src="\.\.\/icons\/icon32\.png"/);
  assert.match(panelHtml, /class="empty-icon" src="\.\.\/icons\/icon48\.png"/);
  assert.equal(existsSync(new URL("icons/icon.svg", projectRoot)), true);
});
