(() => {
  if (window.__PRIVATE_GRAPHQL_INSPECTOR__) return;
  window.__PRIVATE_GRAPHQL_INSPECTOR__ = true;
  const emit = payload => window.postMessage({ source: "private-graphql-inspector", ...payload }, "*");
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
  const hasGraphqlResponseShape = value => {
    try {
      const parsed = JSON.parse(value);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      return entries.some(item => (
        item
        && typeof item === "object"
        && !Array.isArray(item)
        && (Object.hasOwn(item, "data") || Object.hasOwn(item, "errors"))
      ));
    } catch {
      return false;
    }
  };
  const shouldCaptureHttp = (url, body, response = "") => likelyGraphqlHttpBody(body) || likelyGraphqlUrlParams(url) || hasGraphqlResponseShape(response);

  const NativeFetch = window.fetch;
  if (NativeFetch) {
    Object.defineProperty(window, "__PRIVATE_GRAPHQL_INSPECTOR_NATIVE_FETCH__", {
      configurable: true,
      value: (url, init) => NativeFetch.call(window, url, init)
    });

    window.fetch = function instrumentedFetch(input, init) {
      const requestId = crypto.randomUUID();
      const startedAt = Date.now();
      const request = new Request(input, init);
      const bodyPromise = request.clone().text().catch(() => "");
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
        response.clone().text().then(async responseText => {
          const requestBody = await bodyPromise;
          if (!shouldCaptureHttp(request.url, requestBody, responseText)) return;
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
            startedAt
          });
        }).catch(() => {});
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
        this.__graphqlInspector = { requestId: crypto.randomUUID(), method: method || "GET", url: String(url), requestHeaders: [] };
        return super.open(method, url, ...rest);
      }

      setRequestHeader(name, value) {
        this.__graphqlInspector?.requestHeaders.push({ name, value });
        return super.setRequestHeader(name, value);
      }

      send(body) {
        const meta = this.__graphqlInspector || { requestId: crypto.randomUUID(), method: "GET", url: "", requestHeaders: [] };
        const startedAt = Date.now();
        const requestBody = typeof body === "string" ? body : "";
        if (shouldCaptureHttp(meta.url, requestBody)) {
          emit({ type: "http-request-start", requestId: meta.requestId, url: meta.url, method: meta.method, requestHeaders: meta.requestHeaders, requestBody, at: startedAt });
        }
        this.addEventListener("loadend", () => {
          let responseText = "";
          try { responseText = typeof this.responseText === "string" ? this.responseText : ""; } catch {}
          if (!shouldCaptureHttp(meta.url, requestBody, responseText)) return;
          emit({
            type: "http-request-complete",
            requestId: meta.requestId,
            url: meta.url,
            method: meta.method,
            status: this.status,
            requestHeaders: meta.requestHeaders,
            responseHeaders: xhrHeadersToArray(this.getAllResponseHeaders()),
            requestBody,
            responseText,
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
        const endpoint = String(url);
        this.addEventListener("open", () => emit({ type: "ws-open", socketId, url: endpoint, at: Date.now() }));
        this.addEventListener("message", event => {
          if (typeof event.data === "string" && likelyGraphql(event.data)) emit({ type: "ws-frame", direction: "in", socketId, url: endpoint, data: event.data, at: Date.now() });
        });
        this.addEventListener("close", event => emit({ type: "ws-close", socketId, url: endpoint, code: event.code, reason: event.reason, at: Date.now() }));
        const send = this.send;
        this.send = data => {
          if (typeof data === "string" && likelyGraphql(data)) emit({ type: "ws-frame", direction: "out", socketId, url: endpoint, data, at: Date.now() });
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
        const endpoint = String(url);
        this.addEventListener("open", () => emit({ type: "sse-open", sourceId, url: endpoint, at: Date.now() }));
        this.addEventListener("message", event => {
          if (likelyGraphql(event.data) || /"data"\s*:|"errors"\s*:/.test(event.data)) emit({ type: "sse-message", sourceId, url: endpoint, data: event.data, at: Date.now() });
        });
        this.addEventListener("error", () => emit({ type: "sse-error", sourceId, url: endpoint, at: Date.now() }));
      }
    }
    window.EventSource = InstrumentedEventSource;
  }
})();
