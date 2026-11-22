npx --yes eas-cli@latest build --platform ios --profile testflight --no-wait --non-interactive
# Record the returned build ID; verify its result and source revision.
npx --yes eas-cli@latest submit --platform ios --profile testflight --id BUILD_ID --non-interactive
