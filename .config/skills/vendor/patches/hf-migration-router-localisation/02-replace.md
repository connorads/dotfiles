} else if (cmd === "auto") {
  // Optional external upload requires explicit user authorisation for this image.
  if (process.env.HYPERFRAMES_ALLOW_IMAGE_UPLOAD !== "1") {
    console.error("Gemini image upload requires explicit user authorisation; use the local grid loop.");
    process.exit(1);
  }
  const key = process.env.GEMINI_API_KEY;
