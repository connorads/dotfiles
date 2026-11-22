eas build --platform ios --profile testflight --no-wait --non-interactive
# After checking that build's result:
eas submit --platform ios --profile testflight --id BUILD_ID --non-interactive
