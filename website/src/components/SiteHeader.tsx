import { Brand } from "./Brand.tsx";
import { DownloadButton } from "./DownloadButton.tsx";

export function SiteHeader() {
  return (
    <header className="site-header" id="top">
      <div className="content site-header__inner">
        <Brand />
        <nav className="site-nav" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#privacy">Privacy</a>
          <a href="#install">Install</a>
        </nav>
        <DownloadButton compact />
      </div>
    </header>
  );
}

