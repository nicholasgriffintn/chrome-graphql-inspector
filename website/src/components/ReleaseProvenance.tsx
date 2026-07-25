import { useEffect, useState } from "react";

type ReleaseMetadata = {
  version: string;
  commit: string;
  sha256: string;
  source: string;
};

export function ReleaseProvenance() {
  const [release, setRelease] = useState<ReleaseMetadata>();

  useEffect(() => {
    fetch("/release.json")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setRelease)
      .catch(() => {});
  }, []);

  if (!release) return null;
  return (
    <p className="release-provenance">
      Version {release.version} · <a href={`${release.source}/commit/${release.commit}`}>commit {release.commit}</a>
      {" · "}SHA-256 <code title={release.sha256}>{release.sha256.slice(0, 12)}…</code>
      {" · "}<a href={release.source}>source</a>
    </p>
  );
}
