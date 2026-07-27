import { DownloadButton } from "./DownloadButton.tsx";
import { ReleaseProvenance } from "./ReleaseProvenance.tsx";

const steps = [
  {
    title: "Add it to Chrome",
    description: "Install GraphQL Inspector from the Chrome Web Store.",
  },
  {
    title: "Open the GraphQL panel",
    description: "Open DevTools and reload, or enable optional Background capture from the toolbar popup.",
  },
] as const;

export function Installation() {
  return (
    <section className="installation content" id="install" aria-labelledby="install-title">
      <div className="section-heading section-heading--install">
        <h2 id="install-title">Two simple steps.</h2>
        <p>
          Install GraphQL Inspector from the Chrome Web Store, or use the
          download menu for a ZIP you can load manually.
        </p>
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
