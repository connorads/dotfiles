# 3. Stop the session and reset the dotenv. Omit --id to target the dotenv session.
eas simulator:stop
printf '# managed by eas-cli\n' > .env.eas-simulator
