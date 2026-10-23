function font() {
  const dst = "/tmp/locate-font.ttf";
  if (!existsSync(dst)) {
    for (const c of [
      "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
      "/System/Library/Fonts/Supplemental/Arial.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]) {
      if (existsSync(c)) {
        copyFileSync(c, dst);
        break;
      }
    }
  }
  return dst;
}
