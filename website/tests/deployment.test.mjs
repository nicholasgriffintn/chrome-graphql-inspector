import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("the production build contains the page and extension artefacts", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  const archive = new URL("../dist/graphql-inspector.zip", import.meta.url);
  const archiveBytes = await readFile(archive);
  const release = JSON.parse(await readFile(new URL("../dist/release.json", import.meta.url), "utf8"));
  const archiveContents = execFileSync("unzip", ["-Z1", archive.pathname], {
    encoding: "utf8",
  });

  assert.match(html, /GraphQL Inspector — Chrome DevTools extension/);
  assert.match(html, /src="[/]assets[/]index-[^"]+[.]js"/);
  assert.ok((await stat(new URL("../dist/icon.svg", import.meta.url))).size > 0);
  assert.ok((await stat(new URL("../dist/inspector.png", import.meta.url))).size > 0);
  assert.ok((await stat(archive)).size > 0);
  assert.match(archiveContents, /^manifest[.]json$/m);
  assert.match(archiveContents, /^src[/]background[.]js$/m);
  assert.match(release.version, /^\d+[.]\d+[.]\d+$/);
  assert.match(release.commit, /^[0-9a-f]{12}$/);
  assert.equal(release.sha256, createHash("sha256").update(archiveBytes).digest("hex"));
  assert.match(release.source, /github[.]com[/]nicholasgriffintn[/]chrome-graphql-inspector$/);
});
