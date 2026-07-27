(() => {
  const existingController = window.__PRIVATE_GRAPHQL_INSPECTOR__;
  if (existingController?.setEnabled) return;

  const MAX_CAPTURE_BYTES = 512 * 1024;
  const native = {
    fetch: window.fetch,
    XMLHttpRequest: window.XMLHttpRequest,
    WebSocket: window.WebSocket,
    EventSource: window.EventSource,
  };
  const installed = {};
  let captureEnabled = false;

  const boundedText = value => {
    const text = typeof value === "string" ? value : String(value ?? "");
    return text.length > MAX_CAPTURE_BYTES ? text.slice(0, MAX_CAPTURE_BYTES) : text;
  };
  const emit = payload => window.postMessage({
    source: "private-graphql-inspector",
    trust: "page",
    ...payload,
  }, "*");
  const likelyGraphql = value => typeof value === "string" && (
    /\b(query|mutation|subscription)\b/.test(value)
    || /"operationName"|persistedQuery|"type"\s*:\s*"(?:connection_init|connection_ack|subscribe|start|next|data|error|complete|stop|ka|ping|pong)"/.test(value)
  );
  const headersToArray = headers => {
    try {
      return Array.from(headers || [], ([name, value]) => ({ name, value }));
    } catch {
      return [];
    }
  };
  const xhrHeadersToArray = text => text.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const index = line.indexOf(":");
    return index === -1
      ? { name: line, value: "" }
      : { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
  });
  const likelyGraphqlHttpBody = value => likelyGraphql(value)
    || /(^|&)(query|operationName|extensions)=/.test(value);
  const likelyGraphqlUrl = value => {
    try {
      const url = new URL(value, location.href);
      return /(?:^|\/)graphql(?:\/|$)/i.test(url.pathname)
        || url.searchParams.has("query")
        || url.searchParams.has("operationName")
        || url.searchParams.has("extensions");
    } catch {
      return /(?:^|\/)graphql(?:[/?#]|$)|[?&](query|operationName|extensions)=/i.test(value);
    }
  };
  const shouldCaptureHttp = (url, body) => likelyGraphqlUrl(url) || likelyGraphqlHttpBody(body);

  async function readBoundedBody(owner) {
    let clone;
    try {
      clone = owner.clone();
    } catch {
      return "";
    }
    const reader = clone.body?.getReader?.();
    if (!reader) {
      try {
        return boundedText(await clone.text());
      } catch {
        return "";
      }
    }

    const decoder = new TextDecoder();
    let bytesRead = 0;
    let text = "";
    try {
      while (bytesRead < MAX_CAPTURE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        const remaining = MAX_CAPTURE_BYTES - bytesRead;
        const chunk = bytes.byteLength > remaining ? bytes.subarray(0, remaining) : bytes;
        bytesRead += chunk.byteLength;
        text += decoder.decode(chunk, { stream: bytesRead < MAX_CAPTURE_BYTES });
        if (chunk.byteLength < bytes.byteLength) break;
      }
      text += decoder.decode();
    } catch {
      return boundedText(text);
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }
    return boundedText(text);
  }

  function installFetch() {
    if (!native.fetch || installed.fetch) return;
    Object.defineProperty(window, "__PRIVATE_GRAPHQL_INSPECTOR_NATIVE_FETCH__", {
      configurable: true,
      value: (url, init) => native.fetch.call(window, url, init),
    });
    installed.fetch = function instrumentedFetch(input, init) {
      let request;
      try {
        request = new Request(input, init);
      } catch (error) {
        return Promise.reject(error);
      }
      const requestId = crypto.randomUUID();
      const startedAt = Date.now();
      const bodyPromise = readBoundedBody(request);

      bodyPromise.then(requestBody => {
        if (!captureEnabled || !shouldCaptureHttp(request.url, requestBody)) return;
        emit({
          type: "http-request-start",
          requestId,
          url: request.url,
          method: request.method,
          requestHeaders: headersToArray(request.headers),
          requestBody,
          at: startedAt,
        });
      });

      return native.fetch.call(this, request).then(response => {
        void bodyPromise.then(async requestBody => {
          if (!captureEnabled || !shouldCaptureHttp(request.url, requestBody)) return;
          const responseText = await readBoundedBody(response);
          if (!captureEnabled) return;
          emit({
            type: "http-request-complete",
            requestId,
            url: request.url,
            method: request.method,
            status: response.status,
            requestHeaders: headersToArray(request.headers),
            responseHeaders: headersToArray(response.headers),
            requestBody,
            responseText,
            at: Date.now(),
            startedAt,
          });
        });
        return response;
      }, error => {
        void bodyPromise.then(requestBody => {
          if (captureEnabled && shouldCaptureHttp(request.url, requestBody)) {
            emit({
              type: "http-request-error",
              requestId,
              url: request.url,
              method: request.method,
              requestHeaders: headersToArray(request.headers),
              requestBody,
              error: error?.message || String(error),
              at: Date.now(),
              startedAt,
            });
          }
        });
        throw error;
      });
    };
    window.fetch = installed.fetch;
  }

  function installXhr() {
    if (!native.XMLHttpRequest || installed.XMLHttpRequest) return;
    installed.XMLHttpRequest = class InstrumentedXMLHttpRequest extends native.XMLHttpRequest {
      open(method, url, ...rest) {
        let endpoint = String(url);
        try {
          endpoint = new URL(endpoint, location.href).href;
        } catch {}
        this.__graphqlInspector = {
          requestId: crypto.randomUUID(),
          method: method || "GET",
          url: endpoint,
          requestHeaders: [],
        };
        return super.open(method, url, ...rest);
      }

      setRequestHeader(name, value) {
        this.__graphqlInspector?.requestHeaders.push({ name, value });
        return super.setRequestHeader(name, value);
      }

      send(body) {
        const meta = this.__graphqlInspector || {
          requestId: crypto.randomUUID(),
          method: "GET",
          url: "",
          requestHeaders: [],
        };
        const startedAt = Date.now();
        const requestBody = boundedText(typeof body === "string" ? body : "");
        if (!shouldCaptureHttp(meta.url, requestBody)) return super.send(body);
        emit({
          type: "http-request-start",
          requestId: meta.requestId,
          url: meta.url,
          method: meta.method,
          requestHeaders: meta.requestHeaders,
          requestBody,
          at: startedAt,
        });
        this.addEventListener("loadend", () => {
          if (!captureEnabled) return;
          let responseText = "";
          try {
            responseText = typeof this.responseText === "string" ? this.responseText : "";
          } catch {}
          emit({
            type: "http-request-complete",
            requestId: meta.requestId,
            url: meta.url,
            method: meta.method,
            status: this.status,
            requestHeaders: meta.requestHeaders,
            responseHeaders: xhrHeadersToArray(this.getAllResponseHeaders()),
            requestBody,
            responseText: boundedText(responseText),
            at: Date.now(),
            startedAt,
          });
        }, { once: true });
        return super.send(body);
      }
    };
    window.XMLHttpRequest = installed.XMLHttpRequest;
  }

  function installWebSocket() {
    if (!native.WebSocket || installed.WebSocket) return;
    installed.WebSocket = class InstrumentedWebSocket extends native.WebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        const socketId = crypto.randomUUID();
        const endpoint = this.url || String(url);
        this.addEventListener("open", () => {
          if (captureEnabled) emit({ type: "ws-open", socketId, url: endpoint, at: Date.now() });
        });
        this.addEventListener("message", event => {
          if (captureEnabled && typeof event.data === "string" && likelyGraphql(event.data)) {
            emit({
              type: "ws-frame",
              direction: "in",
              socketId,
              url: endpoint,
              data: boundedText(event.data),
              at: Date.now(),
            });
          }
        });
        this.addEventListener("close", event => {
          if (captureEnabled) {
            emit({
              type: "ws-close",
              socketId,
              url: endpoint,
              code: event.code,
              reason: boundedText(event.reason),
              at: Date.now(),
            });
          }
        });
        const send = this.send;
        this.send = data => {
          if (captureEnabled && typeof data === "string" && likelyGraphql(data)) {
            emit({
              type: "ws-frame",
              direction: "out",
              socketId,
              url: endpoint,
              data: boundedText(data),
              at: Date.now(),
            });
          }
          return send.call(this, data);
        };
      }
    };
    Object.defineProperties(installed.WebSocket, {
      CONNECTING: { value: native.WebSocket.CONNECTING },
      OPEN: { value: native.WebSocket.OPEN },
      CLOSING: { value: native.WebSocket.CLOSING },
      CLOSED: { value: native.WebSocket.CLOSED },
    });
    window.WebSocket = installed.WebSocket;
  }

  function installEventSource() {
    if (!native.EventSource || installed.EventSource) return;
    installed.EventSource = class InstrumentedEventSource extends native.EventSource {
      constructor(url, config) {
        super(url, config);
        const sourceId = crypto.randomUUID();
        const endpoint = this.url || String(url);
        const captureMessage = event => {
          if (captureEnabled && (likelyGraphql(event.data) || /"data"\s*:|"errors"\s*:/.test(event.data))) {
            emit({
              type: "sse-message",
              sourceId,
              url: endpoint,
              event: event.type,
              data: boundedText(event.data),
              at: Date.now(),
            });
          }
        };
        this.addEventListener("open", () => {
          if (captureEnabled) emit({ type: "sse-open", sourceId, url: endpoint, at: Date.now() });
        });
        this.addEventListener("message", captureMessage);
        this.addEventListener("next", captureMessage);
        this.addEventListener("complete", () => {
          if (captureEnabled) emit({ type: "sse-close", sourceId, url: endpoint, at: Date.now() });
        });
        this.addEventListener("error", () => {
          if (captureEnabled) {
            emit({
              type: "sse-error",
              sourceId,
              url: endpoint,
              readyState: this.readyState,
              at: Date.now(),
            });
          }
        });
      }
    };
    window.EventSource = installed.EventSource;
  }

  function install() {
    installFetch();
    installXhr();
    installWebSocket();
    installEventSource();
  }

  function restore() {
    if (window.fetch === installed.fetch) window.fetch = native.fetch;
    if (window.XMLHttpRequest === installed.XMLHttpRequest) window.XMLHttpRequest = native.XMLHttpRequest;
    if (window.WebSocket === installed.WebSocket) window.WebSocket = native.WebSocket;
    if (window.EventSource === installed.EventSource) window.EventSource = native.EventSource;
    delete installed.fetch;
    delete installed.XMLHttpRequest;
    delete installed.WebSocket;
    delete installed.EventSource;
    try {
      delete window.__PRIVATE_GRAPHQL_INSPECTOR_NATIVE_FETCH__;
    } catch {}
  }

  function setEnabled(enabled) {
    if (captureEnabled === enabled) return;
    captureEnabled = enabled;
    if (enabled) install();
    else restore();
  }

  window.__PRIVATE_GRAPHQL_INSPECTOR__ = { setEnabled };
  window.addEventListener?.("message", event => {
    const message = event.data;
    if (
      event.source === window
      && message?.source === "private-graphql-inspector-control"
      && message.type === "capture-state"
      && typeof message.enabled === "boolean"
    ) {
      setEnabled(message.enabled);
    }
  });
})();
