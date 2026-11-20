eas build --platform ios --profile testflight --no-wait --non-interactive
# Record the returned build ID; verify its result and source revision.
eas submit --platform ios --profile testflight --id BUILD_ID --non-interactive
