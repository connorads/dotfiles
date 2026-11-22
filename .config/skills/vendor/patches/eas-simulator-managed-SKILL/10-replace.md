#    agent-device uses the installed managed binary.
eas simulator:exec agent-device open <app-or-url> --platform ios
eas simulator:exec agent-device snapshot -i          # interactive UI tree → @e1, @e2 refs
eas simulator:exec agent-device press @e2            # tap a ref (use 'press' or 'click')
eas simulator:exec agent-device screenshot ./shot.png
