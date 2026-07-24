type DownloadButtonProps = {
  compact?: boolean;
};

export function DownloadButton({ compact = false }: DownloadButtonProps) {
  return (
    <a
      className={compact ? "button button--compact" : "button"}
      href="/graphql-inspector.zip"
      download
    >
      <span>Download extension</span>
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 15.5h12" />
      </svg>
    </a>
  );
}

