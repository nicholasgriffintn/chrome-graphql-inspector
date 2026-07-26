import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const privacy = await readFile(
  new URL("../src/components/PrivacyStatement.tsx", import.meta.url),
  "utf8",
);
const normalisedPrivacy = privacy.replace(/\s+/g, " ");

test("the privacy section covers captured traffic, destinations and contact", () => {
  assert.match(normalisedPrivacy, /Chrome Web Store User Data Policy/);
  assert.match(normalisedPrivacy, /Limited Use requirements/);
  assert.match(normalisedPrivacy, /local extension storage/);
  assert.match(normalisedPrivacy, /to the endpoint you chose/);
  assert.match(normalisedPrivacy, /https:\/\/nicholasgriffin[.]dev\/contact/);
});
