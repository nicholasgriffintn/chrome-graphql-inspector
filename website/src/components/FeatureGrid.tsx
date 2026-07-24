const features = [
  {
    number: "01",
    title: "Capture every shape",
    description:
      "Queries, mutations, subscriptions, batches and persisted operations are separated and labelled as they arrive.",
  },
  {
    number: "02",
    title: "Find the signal",
    description:
      "Filter by operation type, search requests and responses, or show only traffic containing GraphQL errors.",
  },
  {
    number: "03",
    title: "Inspect the full exchange",
    description:
      "Move between formatted documents, variables, headers, responses and event timelines without leaving the panel.",
  },
  {
    number: "04",
    title: "Replay with GraphQLi",
    description:
      "Open a captured operation in the built-in client, edit it and send it again from the inspected page.",
  },
  {
    number: "05",
    title: "Resolve persisted queries",
    description:
      "See persisted-query details and map hashes back to their source documents when debugging production traffic.",
  },
  {
    number: "06",
    title: "Take it with you",
    description:
      "Copy a request as cURL, fetch or JSON when the next step belongs in a terminal, test or bug report.",
  },
] as const;

export function FeatureGrid() {
  return (
    <section className="features content" id="features" aria-labelledby="features-title">
      <div className="section-heading">
        <h2 id="features-title">A clearer network trace.</h2>
      </div>
      <div className="feature-grid">
        {features.map((feature) => (
          <article className="feature-card" key={feature.number}>
            <span className="feature-card__number">{feature.number}</span>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

