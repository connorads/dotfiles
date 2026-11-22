2. **Expo SDK 55 or later.** Run `pnpm exec expo-doctor` to check, and `pnpm exec expo install --fix` to update dependencies. SDK 56+ unlocks the newer `ObserveRoot` / `useObserve` API.
3. **An EAS project.** The app must have `extra.eas.projectId` set in its app config. If not, run `eas init` to create one.
