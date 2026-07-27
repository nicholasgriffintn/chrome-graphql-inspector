type DownloadButtonProps = {
  compact?: boolean;
};

const CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/graphql-inspector/diokgfkmhochccjmgkhpmmjgimeofchp";

export function DownloadButton({ compact = false }: DownloadButtonProps) {
  return (
    <div
      className={compact ? "download-control download-control--compact" : "download-control"}
    >
      <a
        className={compact ? "button button--compact" : "button"}
        href={CHROME_WEB_STORE_URL}
      >
        <span>{compact ? "Install" : "Add to Chrome"}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="M6 14 14 6m0 0H7m7 0v7" />
        </svg>
      </a>
      <details className="download-menu">
        <summary aria-label="More download options">
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m6 8 4 4 4-4" />
          </svg>
        </summary>
        <div className="download-menu__panel">
          <a href="/graphql-inspector.zip" download>
            <span>Download ZIP</span>
            <small>Install it manually</small>
          </a>
        </div>
      </details>
    </div>
  );
}
