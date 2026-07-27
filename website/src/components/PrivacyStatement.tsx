const privacyPoints = [
  "No analytics, telemetry, advertising or accounts",
  "Background capture is disabled by default",
  "No captured traffic written to persistent storage",
  "Credential headers removed from default exports",
] as const;

export function PrivacyStatement() {
  return (
    <section className="privacy content" id="privacy" aria-labelledby="privacy-title">
      <div className="privacy__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path d="M16 3.5 27 8v7.6c0 6.1-4.5 10.5-11 12.9-6.5-2.4-11-6.8-11-12.9V8l11-4.5Z" />
          <path d="m11.5 16 3 3 6.5-7" />
        </svg>
      </div>
      <div className="privacy__copy">
        <h2 id="privacy-title">Captured traffic stays under your control.</h2>
        <div className="privacy__policy">
          <p>
            While the GraphQL DevTools panel is connected, GraphQL Inspector
            processes endpoints, request and response headers and bodies, and
            subscription events from the inspected tab. If you enable
            Background capture, this processing also occurs in open tabs
            before their DevTools panels connect. This data can contain website
            content, personal information, communications, financial details
            or authentication credentials, depending on the inspected application.
          </p>
          <p>
            Captured traffic remains temporarily in extension memory.
            Background traffic uses Chrome&apos;s memory-backed session storage
            so it can survive service-worker suspension; it is cleared when
            you disable the setting, close the tab or restart Chrome. Only the
            Preserve log and Background capture preferences are stored in
            Chrome&apos;s persistent local extension storage. Exports are user
            initiated; default exports remove recognised credential headers,
            while including them requires confirmation.
          </p>
          <p>
            GraphQLi sends a request only when you select Send request, from
            the inspected page to the endpoint you chose. Captured data is not
            sent to the developer, analytics services or other parties.
            Information received through Chrome APIs is used only for GraphQL
            Inspector&apos;s stated purpose and in accordance with the Chrome
            Web Store User Data Policy, including the Limited Use
            requirements. Last updated 27 July 2026.{" "}
            <a href="https://nicholasgriffin.dev/contact">Contact the developer</a>
            {" "}with privacy questions.
          </p>
        </div>
      </div>
      <ul>
        {privacyPoints.map((point) => (
          <li key={point}>
            <span aria-hidden="true">✓</span>
            {point}
          </li>
        ))}
      </ul>
    </section>
  );
}
