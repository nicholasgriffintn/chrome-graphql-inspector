export const DEFAULT_SETTINGS = Object.freeze({
  backgroundCapture: false,
});

export const BACKGROUND_CAPTURE_SCRIPT_ID = "graphql-inspector-background-capture";
export const BACKGROUND_CAPTURE_SESSION_KEY = "backgroundCaptureEvents";

export const BACKGROUND_CAPTURE_SCRIPT = Object.freeze({
  id: BACKGROUND_CAPTURE_SCRIPT_ID,
  matches: ["<all_urls>"],
  js: ["src/page-hook.js"],
  runAt: "document_start",
  world: "MAIN",
  allFrames: true,
  persistAcrossSessions: true,
});
