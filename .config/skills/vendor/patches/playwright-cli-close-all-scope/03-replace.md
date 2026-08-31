# Cleanup - close the sessions this task opened, not every session in the workspace
playwright-cli -s=site1 close
playwright-cli -s=site2 close
playwright-cli -s=site3 close
