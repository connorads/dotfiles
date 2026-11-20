npx --yes eas-cli@latest submit:list --platform ios --json --non-interactive \
  > "$STATUS_DIR/submissions.json" 2> "$STATUS_DIR/submissions.err"
npx --yes eas-cli@latest submit:view "$SUBMISSION_ID" --json \
  > "$STATUS_DIR/job.json" 2> "$STATUS_DIR/job.err"
npx --yes eas-cli@latest submit:status --platform ios --profile testflight --json --non-interactive \
