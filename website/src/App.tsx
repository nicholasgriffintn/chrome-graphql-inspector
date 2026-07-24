import { FeatureGrid } from "./components/FeatureGrid.tsx";
import { Hero } from "./components/Hero.tsx";
import { Installation } from "./components/Installation.tsx";
import { PrivacyStatement } from "./components/PrivacyStatement.tsx";
import { ProductPreview } from "./components/ProductPreview.tsx";
import { SiteFooter } from "./components/SiteFooter.tsx";
import { SiteHeader } from "./components/SiteHeader.tsx";

export function App() {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main>
        <Hero />
        <ProductPreview />
        <FeatureGrid />
        <PrivacyStatement />
        <Installation />
      </main>
      <SiteFooter />
    </div>
  );
}

