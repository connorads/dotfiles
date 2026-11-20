npx --yes eas-cli@latest simulator:exec npx agent-device@latest install-from-source "$ART" --platform ios
npx --yes eas-cli@latest simulator:exec npx agent-device@latest open dev.example.app --platform ios
npx --yes eas-cli@latest simulator:exec npx agent-device@latest screenshot ./shot.png
