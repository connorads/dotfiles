# `@raycast/api` UI + `@raycast/utils` hooks reference

Covers `@raycast/api` 1.x and `@raycast/utils` 2.x (React 19); confirm exact APIs against the installed package's types.

## Contents

- [List](#list) · [Detail](#detail) · [Form](#form) · [Grid](#grid)
- [ActionPanel + Action](#actionpanel--action) · [Navigation](#navigation) · [Feedback](#feedback)
- [Storage / Cache / Clipboard / Preferences](#storage--cache--clipboard--preferences)
- [Commands / launch / environment](#commands--launch--environment) · [MenuBarExtra](#menubarextra)
- [@raycast/utils data hooks](#raycastutils-data-hooks) · [OAuth](#oauth) · [Other utils](#other-utils)
- [Idiomatic loading / empty / error states](#idiomatic-loading--empty--error-states)

---

## List

The workhorse view. Built-in `filtering` (client-side, matches title + `keywords`) is **on by default unless you set `onSearchTextChange`** — then you own filtering (e.g. server search), and must add `throttle` if it triggers network calls.

```tsx
<List isLoading={isLoading} filtering throttle isShowingDetail={showDetail}
      searchBarPlaceholder="Search…" onSearchTextChange={setText}
      searchBarAccessory={
        <List.Dropdown tooltip="Type" storeValue onChange={setFilter}>
          <List.Dropdown.Item title="All" value="all" />
        </List.Dropdown>}
      pagination={pagination}>
  {!hasResults && !isLoading && (
    <List.EmptyView icon={Icon.MagnifyingGlass} title="No Results" description="Try another query" />
  )}
  <List.Section title="Results" subtitle={`${items.length}`}>
    <List.Item id="x" title="Item" subtitle="sub" icon={Icon.Star} keywords={["alt"]}
      accessories={[{ tag: { value: "User", color: Color.Magenta } }, { date: new Date() }]}
      detail={<List.Item.Detail markdown="# Hi" />}
      actions={<ActionPanel>{/* … */}</ActionPanel>} />
  </List.Section>
</List>
```

- `accessories` item shape: `{ text?, date?, tag?, icon?, tooltip? }`; `text`/`tag` accept `{ value, color }`. Rendered right-to-left in declared order.
- `isShowingDetail` enables the split pane; put `<List.Item.Detail markdown … metadata … />` in each item's `detail`.
- `pagination={{ hasMore, onLoadMore, pageSize }}` — usually obtained directly from a data hook.
- Gate `List.EmptyView` on `!isLoading` so it doesn't flash "No Results" during the first fetch.

## Detail

```tsx
<Detail markdown={md} navigationTitle="Title" isLoading={false}
  metadata={
    <Detail.Metadata>
      <Detail.Metadata.Label title="Height" text={`1'04"`} icon={Icon.Ruler} />
      <Detail.Metadata.TagList title="Type">
        <Detail.Metadata.TagList.Item text="Electric" color="#eed535" />
      </Detail.Metadata.TagList>
      <Detail.Metadata.Separator />
      <Detail.Metadata.Link title="Evolves to" target="https://…" text="Raichu" />
    </Detail.Metadata>}
  actions={<ActionPanel>{/* … */}</ActionPanel>} />
```

Markdown is CommonMark; local images resolve from `assets/`.

## Form

Idiomatic validation is `useForm` from `@raycast/utils` (see hooks section). Fields: `Form.TextField`, `Form.PasswordField`, `Form.TextArea` (`enableMarkdown`), `Form.Checkbox` (`label` required), `Form.DatePicker` (`type: Form.DatePicker.Type.Date|DateTime`), `Form.Dropdown` (+ `.Item {value,title,icon}`, `.Section`, `storeValue`), `Form.TagPicker` (value `string[]`), `Form.FilePicker` (`allowMultipleSelection`, value `string[]`), `Form.Separator`, `Form.Description`.

- Every data field needs `id`. **Uncontrolled** = `defaultValue`; **controlled** = `value` + `onChange`.
- `<Form>` props: `actions`, `isLoading`, `enableDrafts` (auto-saves inputs; **not** for passwords or nested-navigation forms; pair with `LaunchProps<{ draftValues }>`).
- Manual validation idiom: set `error` on `onBlur`, clear it on `onChange` — validating on every keystroke flashes errors while typing.

## Grid

Like `List` but tiled (`<Grid>`, `<Grid.Item content={…}>`, `<Grid.Section>`, `columns`, `inset`, `fit`). Same actions/search/pagination model.

## ActionPanel + Action

```tsx
<ActionPanel>
  <ActionPanel.Section>
    <Action.OpenInBrowser url={item.url} />
    <Action.CopyToClipboard title="Copy URL" content={item.url}
      shortcut={{ modifiers: ["cmd"], key: "." }} />
  </ActionPanel.Section>
  <ActionPanel.Section>
    <Action.Push title="Show Detail" target={<Detail markdown={md} />} />
    <Action title="Delete" style={Action.Style.Destructive} onAction={onDelete} />
  </ActionPanel.Section>
</ActionPanel>
```

- **First action = primary, second = secondary, auto-shortcuts.** List/Grid/Detail: primary `↵`, secondary `⌘↵`. **Form**: primary `⌘↵`, secondary `⌘⇧↵`. Order deliberately — a destructive first action means Enter deletes.
- Built-ins: `Action.CopyToClipboard` (`content`, `concealed?`), `Action.Paste`, `Action.OpenInBrowser` (`url`), `Action.Open`/`Action.OpenWith`/`Action.ShowInFinder` (`path`/`target`), `Action.Push` (`target` ReactNode — declarative navigation), `Action.SubmitForm` (`onSubmit`), `Action.Trash` (`paths`), `Action.CreateQuicklink`, `Action.CreateSnippet`, `Action.PickDate`, and the generic `<Action title onAction icon shortcut style />`.
- Custom shortcut: `shortcut={{ modifiers: ["cmd","shift"], key: "c" }}` (modifiers ⊂ `cmd|ctrl|opt|shift`).
- Group with `<ActionPanel.Section title?>`; nest with `<ActionPanel.Submenu>`.

## Navigation

Prefer declarative `Action.Push`. Imperative: `const { push, pop } = useNavigation()` — `push(<Component/>, onPop?)`, `pop()`. ESC pops automatically. **Never roll your own navigation stack** (store-review rule).

## Feedback

- **Toast**: `const toast = await showToast({ style: Toast.Style.Animated, title: "Working…" })` then mutate in place: `toast.style = Toast.Style.Success; toast.title = "Done"`. Add `primaryAction: { title, onAction, shortcut }` for a follow-up. The Animated → Success / Failure progression is the universal "do work" UX.
- **HUD**: `await showHUD("Saved 👋", { popToRootType: PopToRootType.Immediate })` — closes the window; use in no-view commands / after actions. Survives the window closing (unlike a toast).
- **Alert**: `await confirmAlert({ title, message?, primaryAction: { title, style: Alert.ActionStyle.Destructive }, rememberUserChoice? })` → `boolean`.
- **Errors**: `import { showFailureToast } from "@raycast/utils"; showFailureToast(error, { title: "Could not fetch" })` — preferred over hand-rolled failure toasts. `captureException(e)` for reporting.

## Storage / Cache / Clipboard / Preferences

- **`LocalStorage`** (async, encrypted, small): `getItem<T>`, `setItem`, `removeItem`, `allItems`, `clear`. Prefer the `useLocalStorage` hook.
- **`Cache`** (sync, string-only): `new Cache({ namespace?, capacity? })` → `get`/`set`/`has`/`remove`/`subscribe`. JSON via `JSON.stringify`/`parse`. Prefer `useCachedState`/`useCachedPromise`. **Never store secrets here.**
- **`Clipboard`**: `copy(content, { concealed? })`, `paste`, `read({ offset? 0–5 })`, `readText`. `Clipboard.Content` = `{ text } | { file } | { html, text? }`.
- **`getPreferenceValues<Preferences>()`** (sync). Pref types map: `textfield`/`password`/`dropdown` → string, `checkbox` → boolean, `appPicker` → Application, `file`/`directory` → string. `openExtensionPreferences()` / `openCommandPreferences()` to deep-link settings. Types are codegen'd into `raycast-env.d.ts` (`Preferences`, `Preferences.CommandName`, `Arguments.CommandName`).

## Commands / launch / environment

- `launchCommand({ name, type: LaunchType.UserInitiated|Background, arguments?, context? })`. Cross-extension adds `extensionName` + `ownerOrAuthorName`.
- View commands receive `props: LaunchProps<{ arguments: Arguments.X; draftValues?; launchContext? }>`.
- `updateCommandMetadata({ subtitle })` sets the root subtitle (e.g. a count); `null` clears.
- `environment` exposes `assetsPath`, `supportPath` (read/write persistence), `isDevelopment`, `commandName`, `commandMode`, `appearance`, `launchType`, `canAccess(api)` (gate Pro-only APIs like `AI`).
- System: `open(target, app?)`, `getApplications`, `getFrontmostApplication`, `showInFinder`, `trash`.

## MenuBarExtra

```tsx
<MenuBarExtra icon={Icon.Bookmark} title="3" tooltip="Bookmarks" isLoading={loading}>
  <MenuBarExtra.Section title="New">
    <MenuBarExtra.Item title="Open Raycast" icon="globe.png"
      shortcut={{ modifiers: ["cmd"], key: "o" }}
      onAction={() => open("https://raycast.com")} />
  </MenuBarExtra.Section>
</MenuBarExtra>
```

Use `onAction` (there is no `onClick`). `alternate` shows on ⌥. Background refresh via the command's `interval`.

---

## @raycast/utils data hooks

**Rule: never fetch with raw `useEffect` + `fetch` + `useState`.** These hooks give `isLoading`, auto error toasts, caching, abort, `revalidate`, and `mutate` for free. All async hooks return `AsyncState<T> & { revalidate(): void; mutate }` where `AsyncState = { isLoading, data, error }`; paginated mode adds `pagination`.

Pick:

- **`useFetch`** — a REST/JSON endpoint.
- **`useCachedPromise`** — any async fn whose result should persist to disk and show instantly next launch (stale-while-revalidate). **Default for remote/expensive calls.**
- **`usePromise`** — async fn, no disk cache (in-memory for the session).
- **`useExec`** — run a local binary, parse stdout.
- **`useSQL`** — read a local SQLite DB (returns a `permissionView` for Full Disk Access).
- **`useAI`** — Raycast AI completion (Pro only).
- **`useCachedState`** — `useState` persisted + shared across renders/commands (sync).
- **`useLocalStorage`** — durable async value: `{ value, setValue, removeValue, isLoading }`.
- **`useForm`** — form state + validation.

### useCachedPromise

```ts
const abortable = useRef<AbortController>();
const { isLoading, data, revalidate, mutate } = useCachedPromise(
  async (q: string) => (await fetch(`/api?q=${q}`, { signal: abortable.current?.signal })).json(),
  [query],                                   // args = cache key AND deps; change → refetch
  { keepPreviousData: true, initialData: [], abortable, execute: !!query }
);
```

Options: `initialData`, `keepPreviousData` (anti-flicker on search), `abortable`, `execute` (false = conditional/dependent fetch), `onError`/`onData`, `failureToastOptions`. Put changing inputs in `args`, not the fn body, or refetch won't trigger.

### mutate (optimistic writes — the canonical write pattern)

```ts
await mutate(
  updateApi(item),                                  // the async write
  { optimisticUpdate: (data) => data.map(patch),    // instant UI
    rollbackOnError: true,                           // default true
    shouldRevalidateAfter: true }                    // default true
);
```

Wrap in try/catch with `showFailureToast` — the optimistic update rolls back on throw, but the error is otherwise swallowed.

### Pagination

The fn becomes a curried `(deps) => async ({ page, cursor, lastItem }) => ({ data, hasMore, cursor? })`. Pass the returned `pagination` to `<List pagination>`, with `keepPreviousData: true`.

```ts
const { data, pagination } = useCachedPromise(
  (q: string) => async ({ page }) => {
    const r = await (await fetch(`/api?q=${q}&page=${page}`)).json();
    return { data: r.items, hasMore: page < r.totalPages };
  }, [searchText], { keepPreviousData: true });
```

`useFetch` paginates with `url: (options) => string` + `mapResult: (r) => ({ data, hasMore, cursor? })`.

### useForm

```ts
import { useForm, FormValidation } from "@raycast/utils";
const { handleSubmit, itemProps, values, setValue, reset, focus } = useForm<Values>({
  async onSubmit(values) { /* return false to keep the form open */ },
  initialValues,
  validation: {
    name: FormValidation.Required,
    password: (v) => (!v ? "Required" : v.length < 8 ? "Min 8 chars" : undefined),
  },
});
// <Action.SubmitForm onSubmit={handleSubmit} />
// <Form.TextField title="Name" {...itemProps.name} />
```

Spread `{...itemProps.field}` to wire `value`/`onChange`/`error`/`id`. Validators return a string (error) or `undefined` (ok).

### useExec / useSQL

```ts
const { isLoading, data } = useExec("/opt/homebrew/bin/brew", ["info", "--json=v2", "--installed"]);
// brew path branches on arch: cpus()[0].model.includes("Apple") ? "/opt/homebrew/bin/brew" : "/usr/local/bin/brew"

const { data, permissionView } = useSQL<Row>(dbPath, query);
if (permissionView) return permissionView;   // ALWAYS handle the Full Disk Access prompt first
```

## OAuth

Define a provider once, wrap the command/tool, read the token inside.

```ts
// api/client.ts — built-in providers: OAuthService.github/.slack/.linear/.google/.jira/.zoom/.asana …
export const service = OAuthService.github({
  scope: "repo read:user",
  personalAccessToken: getPreferenceValues<Preferences>().pat,   // optional PAT fallback
  onAuthorize({ token }) { client = new Sdk({ auth: token }); }, // build your SDK client once
});
export function getClient() { if (!client) throw new Error("not initialised"); return client; }
```

```tsx
export default withAccessToken(service)(MyCommand);            // view command
export default withAccessToken(service)(async () => { … });    // no-view command / tool
// inside, after the wrapper has run:
const { token, type } = getAccessToken();                      // type: "oauth" | "personal"
```

Custom providers: `new OAuth.PKCEClient({ redirectMethod, providerName, providerId, providerIcon })` + `new OAuthService({ client, clientId, authorizeUrl, tokenUrl, scope, onAuthorize })`. Built-ins (GitHub/Slack/Linear) need no redirect setup; Google/Jira/Zoom need your own `clientId`. **Only call `getClient()`/`getAccessToken()` inside a wrapped component/hook/tool** — at module top level they throw before auth runs.

## Other utils

`showFailureToast`, `getProgressIcon(fraction, color?)`, `getAvatarIcon(name)`, `getFavicon(url)`, `runAppleScript(script, args?, opts?)` (macOS only — guard cross-platform), `runPowerShellScript`, `createDeeplink({ command, arguments? })`, `withCache`, `useFrecencySorting`, `useStreamJSON`.

## Idiomatic loading / empty / error states

- **Loading**: pass the hook's `isLoading` into `<List>/<Detail>/<Form>`; don't block render. With `useCachedPromise`, cached data renders instantly while it revalidates.
- **Empty**: `<List.EmptyView>`, gated on `!isLoading` so "No Results" doesn't show during the first fetch.
- **Error**: `showFailureToast(error, { title })` in catch blocks; for fatal data errors render an `EmptyView`/`Detail` with the message. Throwing in a view shows Raycast's red error screen — fine for truly unexpected states, not for handled ones.
