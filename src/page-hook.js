(() => {
  if (window.__PRIVATE_GRAPHQL_INSPECTOR__) return;
  window.__PRIVATE_GRAPHQL_INSPECTOR__ = true;
  let captureEnabled = false;
  const MAX_CAPTURE_TEXT_LENGTH = 1_000_000;
  const boundedText = value => {
    const text = typeof value === "string" ? value : String(value ?? "");
    return text.length > MAX_CAPTURE_TEXT_LENGTH ? text.slice(0, MAX_CAPTURE_TEXT_LENGTH) : text;
  };
  const emit = payload => window.postMessage({ source: "private-graphql-inspector", ...payload }, "*");
  window.addEventListener?.("message", event => {
    const message = event.data;
    if (
      event.source === window
      && message?.source === "private-graphql-inspector-control"
      && message.type === "capture-state"
      && typeof message.enabled === "boolean"
    ) {
      captureEnabled = message.enabled;
    }
  });
  const likelyGraphql = value => typeof value === "string" && (/\b(query|mutation|subscription)\b/.test(value) || /"operationName"|persistedQuery|"type"\s*:\s*"(?:connection_init|connection_ack|subscribe|start|next|data|error|complete|stop|ka|ping|pong)"/.test(value));
  const headersToArray = headers => {
    try { return Array.from(headers || [], ([name, value]) => ({ name, value })); } catch { return []; }
  };
  const xhrHeadersToArray = text => text.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const index = line.indexOf(":");
    return index === -1 ? { name: line, value: "" } : { name: line.slice(0, index).trim(), value: line.slice(index + 1).trim() };
  });
  const likelyGraphqlHttpBody = value => likelyGraphql(value) || /(^|&)(query|operationName|extensions)=/.test(value);
  const likelyGraphqlUrlParams = value => {
    try {
      const params = new URL(value, location.href).searchParams;
      return params.has("query") || params.has("operationName") || params.has("extensions");
    } catch {
      return /[?&](query|operationName|extensions)=/.test(value);
    }
  };
  const shouldCaptureHttp = (url, body) => likelyGraphqlHttpBody(body) || likelyGraphqlUrlParams(url);

  const NativeFetch = window.fetch;
  if (NativeFetch) {
    Object.defineProperty(window, "__PRIVATE_GRAPHQL_INSPECTOR_NATIVE_FETCH__", {
      configurable: true,
      value: (url, init) => NativeFetch.call(window, url, init)
    });

    window.fetch = function instrumentedFetch(input, init) {
      if (!captureEnabled) return NativeFetch.call(this, input, init);
      const requestId = crypto.randomUUID();
      const startedAt = Date.now();
      let request;
      try {
        request = new Request(input, init);
      } catch (error) {
        return Promise.reject(error);
      }
      const bodyPromise = request.clone().text().then(boundedText).catch(() => "");
      bodyPromise.then(body => {
        if (shouldCaptureHttp(request.url, body)) {
          emit({
            type: "http-request-start",
            requestId,
            url: request.url,
            method: request.method,
            requestHeaders: headersToArray(request.headers),
            requestBody: body,
            at: startedAt
          });
        }
      });
      return NativeFetch.call(this, request).then(response => {
        bodyPromise.then(requestBody => {
          if (!shouldCaptureHttp(request.url, requestBody)) return;
          let responseClone;
          try {
            responseClone = response.clone();
          } catch {
            return;
          }
          responseClone.text().then(responseText => {
            emit({
              type: "http-request-complete",
              requestId,
              url: request.url,
              method: request.method,
              status: response.status,
              requestHeaders: headersToArray(request.headers),
              responseHeaders: headersToArray(response.headers),
              requestBody,
              responseText: boundedText(responseText),
              at: Date.now(),
              startedAt
            });
          }).catch(() => {});
        });
        return response;
      }, error => {
        bodyPromise.then(body => {
          if (shouldCaptureHttp(request.url, body)) {
            emit({
              type: "http-request-error",
              requestId,
              url: request.url,
              method: request.method,
              requestHeaders: headersToArray(request.headers),
              requestBody: body,
              error: error?.message || String(error),
              at: Date.now(),
              startedAt
            });
          }
        });
        throw error;
      });
    };
  }

  const NativeXMLHttpRequest = window.XMLHttpRequest;
  if (NativeXMLHttpRequest) {
    class InstrumentedXMLHttpRequest extends NativeXMLHttpRequest {
      open(method, url, ...rest) {
        let endpoint = String(url);
        try { endpoint = new URL(endpoint, location.href).href; } catch {}
        this.__graphqlInspector = { requestId: crypto.randomUUID(), method: method || "GET", url: endpoint, requestHeaders: [] };
        return super.open(method, url, ...rest);
      }

      setRequestHeader(name, value) {
        this.__graphqlInspector?.requestHeaders.push({ name, value });
        return super.setRequestHeader(name, value);
      }

      send(body) {
        if (!captureEnabled) return super.send(body);
        const meta = this.__graphqlInspector || { requestId: crypto.randomUUID(), method: "GET", url: "", requestHeaders: [] };
        const startedAt = Date.now();
        const requestBody = boundedText(typeof body === "string" ? body : "");
        if (shouldCaptureHttp(meta.url, requestBody)) {
          emit({ type: "http-request-start", requestId: meta.requestId, url: meta.url, method: meta.method, requestHeaders: meta.requestHeaders, requestBody, at: startedAt });
        }
        this.addEventListener("loadend", () => {
          let responseText = "";
          try { responseText = typeof this.responseText === "string" ? this.responseText : ""; } catch {}
          if (!shouldCaptureHttp(meta.url, requestBody)) return;
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
            startedAt
          });
        });
        return super.send(body);
      }
    }
    window.XMLHttpRequest = InstrumentedXMLHttpRequest;
  }

  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    class InstrumentedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        const socketId = crypto.randomUUID();
        const endpoint = this.url || String(url);
        this.addEventListener("open", () => {
          if (captureEnabled) emit({ type: "ws-open", socketId, url: endpoint, at: Date.now() });
        });
        this.addEventListener("message", event => {
          if (captureEnabled && typeof event.data === "string" && likelyGraphql(event.data)) {
            emit({ type: "ws-frame", direction: "in", socketId, url: endpoint, data: boundedText(event.data), at: Date.now() });
          }
        });
        this.addEventListener("close", event => {
          if (captureEnabled) emit({ type: "ws-close", socketId, url: endpoint, code: event.code, reason: boundedText(event.reason), at: Date.now() });
        });
        const send = this.send;
        this.send = data => {
          if (captureEnabled && typeof data === "string" && likelyGraphql(data)) {
            emit({ type: "ws-frame", direction: "out", socketId, url: endpoint, data: boundedText(data), at: Date.now() });
          }
          return send.call(this, data);
        };
      }
    }
    Object.defineProperties(InstrumentedWebSocket, {
      CONNECTING: { value: NativeWebSocket.CONNECTING }, OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING }, CLOSED: { value: NativeWebSocket.CLOSED }
    });
    window.WebSocket = InstrumentedWebSocket;
  }

  const NativeEventSource = window.EventSource;
  if (NativeEventSource) {
    class InstrumentedEventSource extends NativeEventSource {
      constructor(url, config) {
        super(url, config);
        const sourceId = crypto.randomUUID();
        const endpoint = this.url || String(url);
        const captureMessage = event => {
          if (captureEnabled && (likelyGraphql(event.data) || /"data"\s*:|"errors"\s*:/.test(event.data))) {
            emit({ type: "sse-message", sourceId, url: endpoint, event: event.type, data: boundedText(event.data), at: Date.now() });
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
          if (captureEnabled) emit({ type: "sse-error", sourceId, url: endpoint, readyState: this.readyState, at: Date.now() });
        });
      }
    }
    window.EventSource = InstrumentedEventSource;
  }
})();
