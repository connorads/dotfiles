# 3. Stop the session and reset the dotenv. Omit --id to target the dotenv session.
npx --yes eas-cli@latest simulator:stop
printf '# managed by eas-cli\n' > .env.eas-simulator
