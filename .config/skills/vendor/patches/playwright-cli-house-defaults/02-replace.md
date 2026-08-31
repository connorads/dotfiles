playwright-cli list
# Close every session in this workspace, not just yours. The workspace root here is
# $HOME, so this takes other agents' sessions with it - check `playwright-cli list` first,
# and prefer `-s=<name> close` above.
playwright-cli close-all
# Forcefully kill every playwright-cli process on the machine (wider than close-all)
playwright-cli kill-all
