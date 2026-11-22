npx --yes eas-cli@latest update:list --branch production --json --non-interactive | jq -r '.currentPage[0].group'
