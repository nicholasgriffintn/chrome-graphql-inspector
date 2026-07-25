import { DownloadButton } from "./DownloadButton.tsx";
import { ReleaseProvenance } from "./ReleaseProvenance.tsx";

const steps = [
  {
    title: "Unzip the download",
    description: "Keep the extracted folder somewhere you will not delete.",
  },
  {
    title: "Open Chrome extensions",
    description: "Visit chrome://extensions and enable Developer mode.",
  },
  {
    title: "Load the folder",
    description: "Select Load unpacked, then choose the extracted folder.",
  },
  {
    title: "Open the GraphQL panel",
    description: "Open DevTools on a page and reload if no requests appear.",
  },
] as const;

export function Installation() {
  return (
    <section className="installation content" id="install" aria-labelledby="install-title">
      <div className="section-heading section-heading--install">
        <h2 id="install-title">Four simple steps.</h2>
        <DownloadButton />
        <ReleaseProvenance />
      </div>
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="steps__number">0{index + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
