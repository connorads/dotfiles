function font() {
  for (const file of [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  ]) if (existsSync(file)) return file;
  throw new Error("No supported local font. Provision a font through the local tool workflow.");
}
