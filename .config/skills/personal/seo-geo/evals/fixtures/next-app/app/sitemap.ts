import type { MetadataRoute } from "next";
import cities from "@/data/cities.json";
import { allPosts } from "@/lib/posts";

const BASE = "https://rotaly.io";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    ...allPosts().map((p) => ({
      url: `${BASE}/blog/${p.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...cities.map((c: string) => ({
      url: `${BASE}/locations/${c.toLowerCase().replace(/ /g, "-")}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
