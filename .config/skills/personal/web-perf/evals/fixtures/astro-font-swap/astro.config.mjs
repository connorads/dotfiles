import { defineConfig } from "astro/config";

// Fully static: dist/*.html is the shipped bytes (Tier 0 verification).
export default defineConfig({
  output: "static",
});
