import { requestHeadersForReplay } from "./headers.js";

function shellQuote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }
function jsString(value) { return JSON.stringify(String(value)); }

export function toCurl(item) {
  const headers = item.requestHeaders || [];
  const args = ["curl", "-X", item.method || "POST", shellQuote(item.url)];
  for (const h of headers) args.push("-H", shellQuote(`${h.name}: ${h.value}`));
  if (item.requestBody) args.push("--data-raw", shellQuote(item.requestBody));
  return args.join(" \\\n  ");
}

export function toFetch(item) {
  const method = String(item.method || "POST").toUpperCase();
  const headers = requestHeadersForReplay(item.requestHeaders, {
    includeJsonContentType: method !== "GET" && method !== "HEAD",
  });
  const options = { method: item.method || "POST", credentials: "include", headers };
  if (item.requestBody && method !== "GET" && method !== "HEAD") {
    options.body = item.requestBody;
  }
  return `fetch(${jsString(item.url)}, ${JSON.stringify(options, null, 2)})\n  .then(response => response.json())\n  .then(console.log);`;
}

export function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
