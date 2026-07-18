# @balu/mobile

Balu's mobile app — Expo (SDK 57) + expo-router, sharing the exact contract and
domain logic of the web client via the workspace packages `@balu/domain`,
`@balu/nl-parser`, `@balu/sync-client`, and `@balu/api-client`.

It is **local-first**: every screen renders from an on-device replica (persisted
in SQLite), mutations apply optimistically and queue durably, and sync flushes
when online — so it works fully offline and converges when the network returns.

## What's inside

- **Onboarding** — enter your self-hosted server URL, then log in / register.
- **4 tabs** — Today (with *This Evening*), Upcoming (day/week groups), Browse
  (Inbox · Anytime · Someday · Logbook · Projects · Labels), Search.
- **Quick-add sheet** (the floating brand-gradient button) with live NL token
  pills; **task detail** bottom sheet (with a **Remind me** row); **schedule**
  sheet.
- Swipe a row **right to complete** (haptic + checkbox animation), **left to
  schedule**.
- **Search** across tasks (title + notes, open + completed via a toggle),
  projects and labels — grouped results, tap to open / navigate.
- **Local reminder notifications** (opt-in in Settings): the app mirrors each
  open task's future `reminder_at` onto the OS scheduler and fires a local
  notification; tapping it deep-links to the task. Local only — no remote push
  (see below).
- Light/dark theme from the Balu design tokens (system-follow + manual
  override); German + English throughout.

## Run it on your phone (Expo Go)

You need the docker-compose server running and your phone on the **same Wi-Fi**
as your Mac.

### 1. Start the Balu server

From the repo root:

```bash
docker compose up -d
# sanity check:
curl http://localhost:8080/healthz   # → {"status":"ok"}
```

### 2. Find your Mac's LAN IP

```bash
ipconfig getifaddr en0   # Wi-Fi (try en1 if that's empty)
# → e.g. 192.168.1.23
```

That is the address your phone can reach. `localhost` will **not** work from the
phone — it must be the LAN IP.

### 3. Install deps & start the dev server

From the repo root (pnpm workspace):

```bash
pnpm install
pnpm --filter @balu/mobile start
```

Metro prints a QR code. Install **Expo Go** from the App Store / Play Store and:

- **iOS**: scan the QR with the Camera app → opens in Expo Go.
- **Android**: scan the QR from inside the Expo Go app.

(If your phone can't reach Metro over the LAN, `pnpm --filter @balu/mobile start
--tunnel` uses a relay instead, at the cost of speed.)

### 4. Enter your server URL in the app

On first launch the app asks for the server URL. Enter:

```
http://<your-Mac-LAN-IP>:8080
```

e.g. `http://192.168.1.23:8080`. The app pings `/healthz`, then shows login /
register. Register a new account (auto-creates your personal workspace) or log
in. The URL is saved and is editable later in **Settings → Server**.

## Offline test (acceptance criterion 2)

1. Log in while online (initial full sync populates the replica).
2. Enable Airplane mode.
3. Add / complete / edit tasks — everything works instantly and is saved to the
   durable SQLite queue.
4. Force-quit and relaunch — your changes are still there (queue + replica
   persisted), the app boots from the cached session.
5. Turn networking back on — the queue flushes and converges with the web
   client.

## Reminder notifications test (Expo Go)

Local reminders are scheduled on-device from the replica — **no dev build and no
remote push server are involved**, so this works fully in Expo Go.

1. In the app, open **Settings → Notifications** and turn **Reminders** on. iOS/
   Android prompts for notification permission — allow it. (If you deny, the
   toggle stays off and a hint explains how to re-enable it in system settings.)
2. Open any task's detail sheet and set **Remind me** to ~2 minutes from now:
   type a day in the natural-language field (fires at 09:00) or use the native
   date **and time** picker for a precise moment.
3. **Background the app** (go to the home screen) or lock the phone.
4. At the reminder time a local notification appears: title = the task title,
   body = `Project · deadline`. **Tap it** — the app opens and the task's detail
   sheet is shown (deep link via expo-router).
5. Completing, deleting, or rescheduling the task re-reconciles automatically
   (the pending notification is cancelled / re-armed). Toggling **Reminders**
   off cancels every scheduled reminder.

Notes & limits:

- **Local only.** Expo Go (SDK 53+) does not support **remote push**; that is
  out of scope here. Balu's server-side channels (ntfy / email / telegram,
  contract §8) are the remote path and are configured separately. With both a
  local reminder and a server channel set up, you may receive **two**
  notifications — accepted in v1 (the Settings hint says so).
- The scheduler caps at the **next 50** upcoming reminders, soonest first (iOS
  caps pending local notifications at 64).
- Reminders are re-armed on login/boot when the permission is still granted; if
  permission was revoked in system settings, the toggle reconciles back to off.

## Caveats & notes

- **Cleartext HTTP on LAN.** Self-hosted dev servers are plain `http://`.
  - In **Expo Go**, cleartext LAN requests already work (Expo Go's own app
    permits them in dev) — no extra config needed.
  - For **standalone / dev-client builds**, `app.json` already allows it:
    iOS via `NSAppTransportSecurity.NSAllowsLocalNetworking`, Android via the
    `expo-build-properties` plugin (`usesCleartextTraffic: true`). Put a TLS
    proxy in front of Balu for production and use `https://`.
- **Native modules.** Everything used (expo-sqlite, expo-haptics, expo-crypto,
  expo-linear-gradient, react-native-svg, @react-native-community/datetimepicker,
  expo-notifications, reanimated, gesture-handler) ships inside Expo Go for SDK
  57, so no custom dev build is required to try it. `expo-notifications` is used
  for **local** scheduling only.
- **Monorepo Metro.** `metro.config.js` watches the workspace root, resolves
  from both node_modules trees, and remaps the `@balu/*` packages' `.js`
  import specifiers onto their real `.ts` source (they ship raw TypeScript).
- **`crypto.randomUUID`.** Polyfilled at startup (`src/lib/polyfills.ts`) via
  expo-crypto because the sync client needs it and Hermes doesn't provide it.
- **Not in v1** (per the plan): remote push notifications, widgets, share-sheet
  capture, drag-to-place FAB, background sync. Foreground sync (on app focus +
  every 60s) is wired; **local** reminder notifications are wired (Settings →
  Notifications).

## Verify locally

```bash
pnpm --filter @balu/mobile typecheck        # tsc --noEmit — clean
pnpm --filter @balu/mobile test             # vitest — reminder + search logic
npx expo export --platform ios              # full Metro bundle
npx expo-doctor                             # project health
```

## Layout

```
src/
  app/                     expo-router routes
    _layout.tsx            providers, boot, global sheet overlays
    index.tsx              cold-start gate → onboarding | /today
    onboarding.tsx         server URL + login/register
    (tabs)/                today · upcoming · browse · search (+ FAB)
    project/[id].tsx       project view (sections, progress ring)
    list/[list].tsx        inbox · anytime · someday · logbook
    label/[id].tsx         label-filtered list
    settings.tsx           account · appearance · notifications · server · logout
  components/              Icon, Checkbox, TaskRow, BottomSheet, Fab, …
  features/                QuickAddSheet, TaskDetailSheet, ScheduleSheet,
                           DateField, ReminderField
  lib/                     clients, boot, kv (SQLite), actions, format, haptics,
                           notifications (local scheduler), reminderPlan (pure),
                           search (pure)
  store/                   zustand app store + replica snapshot hooks
  theme/                   design tokens (TS) + ThemeProvider
  i18n/                    de / en dictionaries
test/                      vitest — reminderPlan + search (pure logic)
```

## Troubleshooting

- **"Project is incompatible with this version of Expo Go"** — the app must be on the
  same Expo SDK as the Expo Go app from the store. The store build lags new SDK
  releases by days to weeks, so this repo pins the SDK Expo Go actually supports
  (currently 56). If it happens again after an SDK bump here, update Expo Go; if Expo
  Go is behind, downgrade: set `"expo"` in `package.json` to the store-supported SDK,
  run `npx expo install --fix`, and restart with `npx expo start -c`.
- `npx expo-doctor` misdetects the project root in this pnpm monorepo (it walks up to
  the workspace lockfile) and errors with "Cannot determine the project's Expo SDK
  version" — harmless; `npx expo config` and `npx expo export` are the real checks.
