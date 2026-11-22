npx --yes eas-cli@latest build --platform ios --profile testflight --no-wait --non-interactive
# After checking that build's result:
npx --yes eas-cli@latest submit --platform ios --profile testflight --id BUILD_ID --non-interactive
