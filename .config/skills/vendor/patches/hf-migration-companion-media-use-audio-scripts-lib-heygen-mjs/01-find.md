  if (cred?.unreadable)
    throw new Error(
      `HeyGen credentials at ${cred.unreadable.file} can't be read (${cred.unreadable.code}) — fix or remove that path, then run \`npx hyperframes auth login\``,
    );
  if (cred?.expired)
    throw new Error(
      "HeyGen OAuth token expired — run `npx hyperframes auth refresh` (or `npx hyperframes auth login`)",
    );
  throw new Error(
    "no HeyGen credentials — set $HEYGEN_API_KEY, or run `npx hyperframes auth login` (writes ~/.heygen/credentials)",
  );
}
