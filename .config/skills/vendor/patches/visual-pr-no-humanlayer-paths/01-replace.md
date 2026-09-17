5. Publish the description:
   {{marker}}
   - Pass the body on stdin, writing no file: `gh pr edit {number} --body-file - <<'EOF'`, the body, then `EOF`. Write a file only when the user asks for one.
   - Confirm the update succeeded.
