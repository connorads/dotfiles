  if (cred?.unreadable)
    throw new Error(
      `HeyGen credentials at ${cred.unreadable.file} can't be read (${cred.unreadable.code}) — fix or remove that path, then run \`hyperframes auth login\``,
    );
  if (cred?.foreign)
    throw new Error(
      "The saved HeyGen login belongs to another OAuth client or environment — run `hyperframes auth login`",
    );
  if (cred?.expired)
    throw new Error(
      "HeyGen OAuth token expired — run `hyperframes auth refresh` (or `hyperframes auth login`)",
    );
  throw new Error(
    "no HyperFrames credentials — set $HEYGEN_API_KEY, or run `hyperframes auth login` (writes ~/.hyperframes/credentials)",
  );
}
