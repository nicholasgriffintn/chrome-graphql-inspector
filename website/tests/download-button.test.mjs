import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the install action uses the Chrome Web Store with a ZIP fallback", async () => {
  const [button, installation, readme] = await Promise.all([
    readFile(new URL("../src/components/DownloadButton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/Installation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../README.md", import.meta.url), "utf8"),
  ]);
  const storeUrl =
    /https:\/\/chromewebstore[.]google[.]com\/detail\/graphql-inspector\/diokgfkmhochccjmgkhpmmjgimeofchp/;

  assert.match(button, storeUrl);
  assert.match(button, /<details className="download-menu">/);
  assert.match(button, /href="\/graphql-inspector[.]zip" download/);
  assert.match(installation, /Chrome Web Store/);
  assert.match(readme, storeUrl);
});
