npx --yes eas-cli@latest simulator:exec npx agent-device@latest install dev.example.app "$APP" --platform ios
npx --yes eas-cli@latest simulator:exec npx agent-device@latest open dev.example.app --platform ios
npx --yes eas-cli@latest simulator:exec npx agent-device@latest screenshot ./shot.png
