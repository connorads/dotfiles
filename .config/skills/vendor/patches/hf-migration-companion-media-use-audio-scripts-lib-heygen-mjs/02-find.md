  if (code === "hf_subscription_required")
    return "This needs a HyperFrames plan. Run `npx hyperframes billing subscribe --skill media-use`: it opens the page and waits.";
  if (code === "hf_usage_exhausted")
    return "Out of HyperFrames credits. Run `npx hyperframes billing add-credits --skill media-use`: it opens the page and waits.";
