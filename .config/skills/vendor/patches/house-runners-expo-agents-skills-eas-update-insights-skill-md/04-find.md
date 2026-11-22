npx --yes eas-cli@latest update:list --all --json --non-interactive | jq -r '.currentPage[0].group'
