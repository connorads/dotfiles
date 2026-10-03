import type { MetadataRoute } from "next";
import cities from "@/data/cities.json";

const BASE = "https://northgatedental.co.uk";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/` },
    ...cities.filter((c) => c.hasPremises).map((c) => ({ url: `${BASE}/locations/${c.slug}` })),
  ];
}
