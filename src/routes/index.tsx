import { createFileRoute } from "@tanstack/react-router";
import { SixfoldApp } from "@/sixfold/SixfoldApp";
import sixfoldCss from "@/sixfold/sixfold.css?url";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sixfold — Six-Sided Market Psychology Lab" },
      { name: "description", content: "Live Deriv digit research workbench: Over/Under, Even/Odd, Matches/Differs analysis." },
      { property: "og:title", content: "Sixfold — Six-Sided Market Psychology Lab" },
      { property: "og:description", content: "Live Deriv digit research workbench across six contract perspectives." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap" },
      { rel: "stylesheet", href: sixfoldCss },
    ],
  }),
  component: SixfoldApp,
});
