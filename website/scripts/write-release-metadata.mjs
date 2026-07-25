import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const archiveName = process.argv[2];
if (!archiveName) throw new Error("Archive filename is required");

const manifest = JSON.parse(await readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
const archive = await readFile(new URL(`../public/${archiveName}`, import.meta.url));
const commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
  cwd: new URL("../..", import.meta.url),
  encoding: "utf8"
}).trim();
const source = execFileSync("git", ["remote", "get-url", "origin"], {
  cwd: new URL("../..", import.meta.url),
  encoding: "utf8"
}).trim().replace(/\.git$/, "");

await writeFile(new URL("../public/release.json", import.meta.url), JSON.stringify({
  version: manifest.version,
  commit,
  sha256: createHash("sha256").update(archive).digest("hex"),
  source
}, null, 2));
