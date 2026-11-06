---
name: mobile-ios-e2e
description: Build, install and drive the balu mobile app (Expo, apps/mobile) on iOS simulators for e2e, smoke and layout checks - iPhone, iPad and the foldable iPhone Duo. Use before any iOS build, simulator boot, Maestro flow or simulator screenshot in this repo. Carries the commands that never return, simulator isolation, the iOS UI helper, Device Hub rotation, Duo fold/rotate handling and cleanup.
---

# balu mobile: iOS e2e

Sibling of `mobile-android-e2e` (same structure, same rules). Read this file fully before the
first command. Helpers: `tools/e2e/ios/ui.py` (hierarchy, taps, swipes, typing, keyboard) and
`tools/e2e/ios/login.py` (login form). Backend: `tools/e2e/README.md` sections 2-3.

## 0. This skill is maintained by its users

Update this file in the run that finds a fact: a command hung or differed, something needed
several attempts, an *(unverified)* entry was confirmed or refuted, or a faster way exists (replace
the old step, no variants). Only verified facts, dated (`2026-11-05`). Keep under ~250 lines.

**This repository is public, history included** (see `AGENTS.md`). Never write secrets,
passwords, typed text, people's names, host names, LAN IPs, device names, serials or UDIDs,
personal simulator names, or absolute home paths. Use placeholders (`<udid>`, `<your-sim>`).
Mention the skill edit in your final report (one line).

## 1. Rule zero: every command must return

| Command | Why it hangs | Use instead |
|---|---|---|
| `npx expo run:ios` | Stays attached to `simctl log stream` after install + launch | `xcodebuild ... build` (section 4), then `simctl install` + `launch` |
| `npx expo start` / Metro | Dev server | Background with a log file and `&`, record the PID |
| `xcrun simctl spawn <udid> log stream` | Streams forever | `log show --last 2m --predicate 'process == "Balu"'` |
| `xcrun simctl io <udid> recordVideo` | Runs until interrupted (0-byte files on Xcode 27.2) | Screenshots |
| `xcrun simctl bootstatus <udid>` without `-b` | Waits forever on a sim nobody boots | `timeout 300 xcrun simctl bootstatus <udid> -b` |
| `maestro test` without a timeout | Can wait on an element forever | the helpers bound every Maestro call (90-180 s) |

Wrap anything that waits on a device in `timeout`. Long but finite commands (`pod install`,
`xcodebuild`, first build 10-20 min) run in the foreground with a bash timeout up to 2400 s.
Never `sleep`-poll; never end your turn with a background task you still need.

## 2. Preflight

```sh
xcodebuild -version              # 27.2 verified 2026-11-06; the app needs Expo SDK 58+
xcrun simctl list runtimes       # two iOS 27.2 entries; the Duo needs the second (section 3)
xcrun simctl list devicetypes | grep -i -E 'duo|ipad|iphone'
maestro --version                # 2.12.0 verified; `hierarchy` and `test --device` need it
duoctl --version                 # 0.2.1 verified 2026-11-06 (Duo only)
df -h ~ | tail -1                # ~20 GB free for a clean build
```

Xcode 27 has no Simulator.app; simulators are shown in **Device Hub**. **Quitting Device Hub
shuts down booted simulators**, including other agents' ones. Do not quit it.

## 3. Your own simulators

Never boot or reuse a simulator another agent might run. Create your own and delete it at the
end (verified 2026-11-05 with an iPhone 17 on the iOS 27.2 runtime):

```sh
ME=balu-e2e-ios-$$
UDID=$(xcrun simctl create "$ME-iphone" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-2)
echo "$UDID" > /tmp/$ME-udid           # every later call needs it
xcrun simctl boot "$UDID" && timeout 300 xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100
```

- The override did not show on the iPhone 17 or the iPad (2026-11-06): the clock was real time.
- **The iPhone Duo needs the second iOS 27.2 runtime build.** `iPhone-Duo` on
  `SimRuntime.iOS-27-2` fails with "Incompatible device" (2026-11-06); it works on
  `com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4`.
- Cover: a classic iPhone, the largest iPhone, an iPad 13", the Duo. Act only on your own UDIDs.
- **iPad:** set full-screen apps multitasking in Settings, else a resize grip shows in
  screenshots. Set language per run (`-AppleLanguages`/`-AppleLocale`) if the status bar matters.

## 4. Build and install (Release, no Metro)

```sh
cd apps/mobile
npx expo prebuild --platform ios --no-install   # clears and recreates ios/, rewrites package.json
(cd ios && timeout 2400 pod install)            # foreground; "added script phase" notes are harmless
(cd ios && timeout 2400 xcodebuild -workspace Balu.xcworkspace -scheme Balu -configuration Release \
  -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath /tmp/$ME-dd \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build) > /tmp/$ME-build.log 2>&1
grep -E '\*\* BUILD' /tmp/$ME-build.log          # "** BUILD SUCCEEDED **" (verified)
APP=/tmp/$ME-dd/Build/Products/Release-iphonesimulator/Balu.app
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" com.blaumedia.balu
git checkout package.json                       # prebuild rewrites it (skip if the orchestrator owns package.json)
```

- `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (Apple Silicon) builds only the host architecture. One build
  serves every simulator of the same architecture. A prebuilt `.app` from the same commit may be
  reused (done 2026-11-06).
- **First build can fail** with `Scanning for @ExpoModule classes didn't complete`: run the same
  `xcodebuild` again; it succeeded on the second run (2026-11-06).
- `ios/` is gitignored: remove it at the end if you created it (if it existed before, leave it).

**Old commit (store 1.6.0 = 53a64a1, 2026-11-06):**
- `xcodebuild` fails: `RNSVG-RNSVGFilters ... deployment target is set to 12.4`. Pass
  `IPHONEOS_DEPLOYMENT_TARGET=15.0` on the command line (worktree only, no code change).
- Its generated Info.plist has **no `UIApplicationSceneManifest`**: the app traps at launch on
  iOS 27.2 (SIGTRAP in `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`; report in
  `~/Library/Logs/DiagnosticReports/Balu-*.ips`). Copying HEAD's manifest into that worktree's
  Info.plist stops the crash, but the screen then stays a blank grey (sd 0.02 after 20 s) while
  HEAD renders on the same simulator. Blocked until explained (2026-11-06).
- **Second worktree:** symlinked `node_modules` make Metro fail (`Unable to resolve module`). Use
  `cp -cR <main>/node_modules ./` and `cp -cR <main>/apps/mobile/node_modules apps/mobile/`; remove at cleanup.

## 5. Driving the UI

### 5.1 Backend and onboarding

- Port: `curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/healthz` (000 =
  free). `lsof` was unreliable (2026-11-06). `stack.sh up` refuses a port that answers.
  `BALU_E2E_PROJECT=<project> BALU_E2E_PORT=<port> tools/e2e/stack.sh up`, then `api.py setup
  --tasks 6` with the same variables (409 = reused accounts, expected). **Every later `stack.sh
  psql` and login.py needs the same two variables** exported in the shell.
- The simulator shares the host network: the server URL is `http://localhost:<port>`.
- Fresh install: "Connect to your server" -> URL -> Continue -> "Continue without encryption" (http)
  -> `login.py --udid "$UDID" owner` (exit 0, `login submitted as owner`). "Save Password?": `^Not Now$`.
- **URL entry (2026-11-06):** a first Continue can show "That doesn't look like a valid URL"
  (text not landed). The field is an unlabelled box between the subtitle and Continue (iPhone 17:
  y 401-422; find it with `list --all`). Tap its centre (a point just above it does nothing),
  `erase 40`, `type`, `key enter`, then Continue. Check the next screen first.
- login.py selects the inputs by label (`Email`/`Password`, German `E-Mail`/`Passwort`) and
  refuses to type unless the login heading is shown. Verified: iPhone 17 portrait English and
  German ("Anmelden"), iPad 13", iPhone 17 Pro Max, Duo cover (English).
- login.py aborts after typing the email: "inputs not empty" on rerun. Relaunch or `ui.py erase N`.
- Cold start: `simctl terminate` then `launch` lands on Today, session kept (verified 2026-11-06).
- **Logout:** Settings bottom (`Abmelden` in German). `ui.py list` did not print it; `has`/`tap` did.

### 5.2 Helper and Maestro

Helpers kill Maestro's process group on SIGINT/SIGTERM/SIGHUP (not on SIGKILL). Maestro logs typed
text: `ui.py`/`login.py` keep its output in a private `mktemp -d`; do the same for a direct
`maestro test`. Never delete `~/.maestro/tests` folders by timestamp.

`tools/e2e/ios/ui.py --udid "$UDID" <cmd>`:

| Command | Use |
|---|---|
| `list [--full] [--all]` | visible nodes `[x1,y1][x2,y2] 'label'`; some nodes print twice (iPad portrait top bar), others once (sidebar, Duo rail): do not dedupe with `awk 'NR%2==1'`, it drops lines; `--all` adds unlabelled nodes |
| `has REGEX` / `tap REGEX [--nth N]` | match on the label, tap the centre. `NOT FOUND` = nothing tapped |
| `point X Y` / `swipe X1 Y1 X2 Y2 [MS]` | absolute points (402 x 874 pt on iPhone 17) |
| `type TEXT\|-` / `erase N` / `key NAME` / `hide-keyboard` | focused field; `key enter` submits quick add (it hung to the 120 s timeout on iPad and Duo although the text landed: wrap it in `timeout`). Typed text is visible in `ps`: **never pass secrets** (`type -` reads stdin) |
| `shot OUT.png` / `screen-size` | simctl screenshot (cite the path) / points |

- `maestro hierarchy` gives labels, bounds, enabled, selected and focused, but **no class names**.
  A rail item's label can be an SF symbol name when not selected (Duo rail: `favorite`, `calendar`,
  `hdr`; landscape iPad sidebar: `favorite`, `hdr`; 2026-11-06).
- **The keyboard covers buttons.** `hide-keyboard` before tapping anything below y ~546 on iPhone.
- Maestro's `swipeLeft`/`swipeRight` take no start/end: use `swipe`.
- Deep link: `xcrun simctl openurl "$UDID" 'balu://settings'`; the "Open in Balu?" dialog: `ui.py tap '^Open$'`.

### 5.3 Gestures and flows (verified 2026-11-05/06)

- **Left edge back swipe:** `ui.py swipe 3 500 330 500` pops a pushed screen (also dismisses
  Settings; the tab bar is hidden on pushed screens). Rows: left swipe opens Schedule; right
  swipe completes the task.
- **Dismiss a bottom sheet:** tap the dimmed strip above it: iPhone 17 `point 200 65`; Duo cover
  `point 200 30`. Stay below the status bar (y < 54 never reaches the app). Landscape iPad side
  sheet: tap the scrim left of it (`point 600 500`). A downward swipe did not close the detail sheet.
- **Drafts survive a scrim close** (notes and title, all tested devices; 2026-11-06): type, close,
  check `stack.sh psql -c "select title, notes from tasks where ..."`.
- **Tab labels differ by build:** classic bar `Upcoming, tab, 2 of 4`; NativeTabs `Upcoming`.
  Anchor on the prefix (`'^Upcoming'`) and check `list` after each tap: a missed tap silently
  leaves the old screen. Selected tab reads `Browse selected`. German: Heute, Demnächst,
  Übersicht (Browse), Suche. In the iPad sidebar and the Duo rail a row is a container labelled
  with the tab name plus a nested icon labelled with the SF symbol name (`favorite`, `hdr`): read
  the container, the symbol names are not a bug (2026-11-06).
- **Date picker (Duo cover 2026-11-06):** the row `Deadline, None` -> tap `Deadline, Pick a date`
  -> `Date Picker` node -> day label. DB: `2026-11-12`. The row then reads `Deadline, Clear`:
  `^Deadline, Clear` -> DB NULL (verified). Reminder: `Remind me, Pick a date` opens a wheel
  (day, hour, minute); not completed (2026-11-06).
- **Attachments:** `xcrun simctl addmedia "$UDID" /tmp/<name>.png`, then task detail -> "Add
  attachment" -> "Photo" (limited Photos picker; tap the newest item). DB: `select filename,
  content_type, size_bytes from attachments where task_id = (...) and not is_deleted`.
- **Long-press drag (reorder):** not reproduced with a Maestro `swipe` nor `duoctl long-press`
  (2026-11-05/06). Do not claim a drag PASS without a working method.

### 5.4 Rotating a non-Duo simulator (verified 2026-11-06, iPad Pro 13-inch, Device Hub)

- Device Hub's Device menu has no rotate item. Rotate with `keystroke (ASCII character 28) using
  command down` (Cmd+Left; 29 = Cmd+Right) sent to Device Hub via System Events. Check `ui.py screen-size`.
- Select the device first (the title stays `Devices - No Selection`). Outline rows have no names:
  `select` `row k of outline 1` with a 0.4 s delay and read `name of window 1` until it contains your
  device name. Typing the name does not select. Needs the terminal's Accessibility access. Selecting
  does not boot or shut down the device.

## 6. iPhone Duo

Verified 2026-11-06 on a Duo from section 3 (runtime build 19-4), `duoctl` 0.2.1 (on PATH).

- Displays (points): cover 466 x 678 (portrait), inner 669 x 951 portrait / 951 x 669 landscape.
- **duoctl:** always pass `-d <udid>` (else it wants "the only booted iPhone Duo").
  `state` (JSON: hingeAngle, activeScreen cover|inner, orientation, sizePoints); `open`, `close`,
  `half` (hinge 180 / 0 / 90; `--duration 1` animates); `rotate portrait|landscape` (inner screen);
  `tap X Y`, `swipe X1 Y1 X2 Y2 [--duration]`, `long-press X Y` (interface points of the active
  screen); `screenshot PATH.png`. `--label`, `--id` and `elements` need the AXe CLI (not installed).
- **Timing:** wait ~20 s after boot before the first `state`; wait ~4 s after `open` or `rotate`.
- **Coordinates:** `ui.py list`/`tap` use one shared space where the cover is at (0,0)-(466,678)
  and the inner display is bottom-right aligned, origin `(466-w, 678-h)`: (-203,-273) in portrait
  and landscape. **Inner point = hierarchy point minus the root origin** (+203, +273 on inner).
  `ui.py tap` only works on the cover; on the inner screen use `duoctl tap` with the converted
  point (Upcoming tab (287, 899), FAB (619, 822), both checked by their effect).
- **Folded cover:** status column and tab rail on the right (rail about 84 pt, x 382-466). Content
  and header end at x 382. FAB right edge 362 = 466 - 84 - 20. Quick-add input x 60-361, above the keyboard.
- **Landscape inner (951 x 669):** system rail on the **right** (84 pt, x 867-951). Detail side
  sheet spans x 475-867 (width 392): the left edge sits on the fold (measured 475).
- **Portrait inner (669 x 951):** no rail. Quick-add and detail are 600 cards, measured edges
  x 34 and x 634 (centred). The notes editor scrolls above the keyboard.
- **Half-open (hinge 91):** inner screen stays active, landscape, side sheet edge 475, no draft lost.
  Pixel diff against the open frame was large while mean brightness matched (cause unknown).
- **Fold to cover with the detail open:** `close` leaves the detail nodes on the cover; `open` brings
  the inner screen back. The draft survives (DB).
- **Not verified on the Duo:** rotate-live with detail open, German, tab bar contrast, drag.

## 7. Layout checks (overlap / clipping)

Per screen, device and pose: nothing cut off or under the rail, Dynamic Island, home indicator or
system bars; the keyboard does not cover the focused input. A classic iPhone must look as before.

Judge from the hierarchy bounds first. Images are not read by text-only agents (section 0 of the
run rules): for edges, write a short `prof.py` in /tmp (not in the repo): `magick IN.png -crop
<W>x1+0+<Y*S> -depth 8 txt:-` (S = PNG width / points), then print the x positions where the mean
of the three channels steps by more than 18 (the text format is `x,y: (r,g,b)  #hex  srgb(...)`).
This measured card edges, rail columns and the fold line.

- **iPad Pro 13-inch landscape (1376 x 1032, 2026-11-06):** side sheet left edge x 816 = window
  width minus `SIDE_SHEET_MAX_WIDTH` (560, `src/lib/layout.ts`); quick-add card 388-988 (600,
  centred); Today column 408-1248.
- **iPhone Duo (2026-11-06):** cover Today, Upcoming, Browse, Search, Settings top, quick-add and
  detail bottom sheets with notes and keyboard; inner portrait cards (600); inner landscape detail
  side sheet (475 edge); fold with the detail open. Not checked: Settings scrolled to the end.
- **Finding (2026-11-05, iPhone 17):** the "Add notes..." editor sat under the keyboard in the task
  detail sheet, and the sheet did not move up. The Duo scrolled the editor above the keyboard
  (2026-11-06). Check again after any sheet change.

## 8. Cleanup (always, also after a failure)

```sh
xcrun simctl shutdown "$UDID"; xcrun simctl delete "$UDID"       # only YOUR simulators
rm -rf /tmp/$ME-dd /tmp/$ME-udid
cd apps/mobile && git checkout package.json && rm -rf ios .expo  # only what you created
BALU_E2E_PROJECT=<project> BALU_E2E_PORT=<port> tools/e2e/stack.sh purge   # if you started it
```

Never `simctl shutdown all` / `delete all` / `erase all`, never quit Device Hub while other
simulators may run, never delete DerivedData you did not create. Keep screenshots as evidence and
cite their paths.

## 9. Not possible or not run (2026-11-06)

- **iPad Split View / Slide Over:** not driven; the Device menu's Enter Resize Mode is the only entry seen.
