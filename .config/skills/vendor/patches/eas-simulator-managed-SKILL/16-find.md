npx --yes eas-cli@latest simulator:control --id <id> --json                # action catalog: descriptions, argument order, properties
npx --yes eas-cli@latest simulator:control app.launch --help --id <id>     # usage for one action
npx --yes eas-cli@latest simulator:control screenshot.capture --output ./screen.png --id <id>   # no open app needed
npx --yes eas-cli@latest simulator:control app.launch dev.example.app --id <id>                 # restart the app
npx --yes eas-cli@latest simulator:control app.openUrl dev.example.app 'myapp://profile/42' --id <id>   # deep link, no restart
npx --yes eas-cli@latest simulator:control appearance.set dark --id <id>
npx --yes eas-cli@latest simulator:control location.set 37.3349 -122.0090 --id <id>
