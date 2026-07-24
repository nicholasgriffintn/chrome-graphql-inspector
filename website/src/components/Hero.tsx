import { DownloadButton } from "./DownloadButton.tsx";

export function Hero() {
  return (
    <section className="hero content" aria-labelledby="hero-title">
      <div className="hero__status reveal">
        <span className="status-dot" />
        Chrome DevTools · Manifest V3
      </div>
      <h1 className="hero__title reveal reveal--one" id="hero-title">
        See what your application is <em>asking for.</em>
      </h1>
      <p className="hero__intro reveal reveal--two">
        GraphQL Inspector captures the operations moving through a page and
        makes them readable—queries, variables, responses, headers and
        subscription events, all in one focused DevTools panel.
      </p>
      <div className="hero__actions reveal reveal--three">
        <DownloadButton />
        <a className="text-link" href="#install">
          Installation guide
          <span aria-hidden="true">↓</span>
        </a>
      </div>
      <dl className="hero__facts reveal reveal--three">
        <div>
          <dt>Runs locally</dt>
          <dd>No account required</dd>
        </div>
        <div>
          <dt>Built for Chromium</dt>
          <dd>Chrome, Edge, Brave &amp; Arc</dd>
        </div>
        <div>
          <dt>Open source</dt>
          <dd>MIT licensed</dd>
        </div>
      </dl>
    </section>
  );
}

