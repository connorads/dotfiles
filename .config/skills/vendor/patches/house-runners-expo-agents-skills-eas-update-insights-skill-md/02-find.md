| `npx --yes eas-cli@latest update:list` | Discover recent update groups, their `group` IDs, and branch names |
| `npx --yes eas-cli@latest update:insights <groupId>` | Per-platform launches, failed launches, crash rate, unique users, payload size, daily breakdown |
| `npx --yes eas-cli@latest update:view <groupId> --insights` | Update group details + the same metrics appended |
| `npx --yes eas-cli@latest channel:insights --channel <name> --runtime-version <version>` | Embedded/OTA user counts, most popular updates, cumulative metrics for a channel + runtime |
