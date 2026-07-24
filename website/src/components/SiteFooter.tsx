import { Brand } from "./Brand.tsx";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="content site-footer__inner">
        <Brand />
        <p></p>
        <a
          className="github-link"
          href="https://github.com/nicholasgriffintn/chrome-graphql-inspector"
        >
          View source on GitHub
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </footer>
  );
}

