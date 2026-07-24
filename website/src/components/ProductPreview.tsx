export function ProductPreview() {
  return (
    <section className="product-preview content" aria-label="Extension preview">
      <div className="product-preview__glow" />
      <div className="window">
        <div className="window__bar">
          <span className="window__lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="window__label">
            <span className="status-dot" />
            DevTools / GraphQL
          </span>
          <span className="window__meta">Local session</span>
        </div>
        <img
          src="/inspector.png"
          alt="GraphQL Inspector showing captured operations and a formatted response in Chrome DevTools"
          width="3598"
          height="1270"
        />
      </div>
      <p className="product-preview__caption">
        <span>01</span>
        Inspect the request and response together, without changing context.
      </p>
    </section>
  );
}

