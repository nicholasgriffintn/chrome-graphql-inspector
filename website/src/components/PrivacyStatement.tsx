const privacyPoints = [
  "No analytics or telemetry",
  "No accounts or advertising",
  "No captured traffic written to storage",
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
        <h2 id="privacy-title">Your traffic stays on your device.</h2>
        <p>
          Captured requests live temporarily in extension memory. GraphQLi
          only sends a request when you choose to send it, directly from the
          page you are inspecting.
        </p>
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

