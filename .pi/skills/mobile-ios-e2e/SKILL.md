---
name: mobile-ios-e2e
description: Build, install and drive the balu mobile app (Expo, apps/mobile) on iOS simulators for e2e, smoke and layout checks - iPhone, iPad and the foldable iPhone Duo. Use before any iOS build, simulator boot, Maestro flow or simulator screenshot in this repo. Carries the commands that never return, simulator isolation, the iOS UI helper, Duo fold/rotate handling and cleanup.
---

# balu mobile: iOS e2e

Sibling of `mobile-android-e2e` (same structure, same rules). Read this file fully before the
first command. Helpers: `tools/e2e/ios/ui.py` (hierarchy, taps, swipes, typing, keyboard) and
`tools/e2e/ios/login.py` (login form). Backend: `tools/e2e/README.md` sections 2-3.

## 0. This skill improves itself - you are expected to update it

Every agent that uses this skill is also its maintainer. Before you end your run, update
this file when a command hung, failed or behaved differently than written; when something
needed more than one attempt (write down what worked); when an *(unverified)* entry turned
out right or wrong (remove the marker or correct it); or when you found a faster or safer
way (replace the old step, do not append a variant).

- Only verified facts; guesses are marked *(unverified)*. Short: symptom, cause, what to do.
  Date each entry (`2026-11-05`). Edit the section it belongs to, no changelog at the bottom;
  keep the file under ~250 lines.
- **This repository is public, history included** (see `AGENTS.md`). Never write secrets,
  passwords, raw log lines with typed text, people's names, host names, LAN IPs, device
  names, serials or UDIDs, personal simulator names, or absolute home paths. Use
  placeholders (`<udid>`, `<your-sim>`) and say how to find the value.
- Mention the skill edit in your final report (one line).

## 1. Rule zero: every command must return

| Command | Why it hangs | Use instead |
|---|---|---|
| `npx expo run:ios` | Stays attached to `simctl log stream` after install + launch | `xcodebuild ... build` (section 4), then `simctl install` + `launch` |
| `npx expo start` / Metro | Dev server | Background with a log file and `&`, record the PID |
| `xcrun simctl spawn <udid> log stream` | Streams forever | `log show --last 2m --predicate 'process == "Balu"'` |
| `xcrun simctl io <udid> recordVideo` | Runs until interrupted (0-byte files on Xcode 27.2) | Screenshots |
| `xcrun simctl bootstatus <udid>` without `-b` | Waits forever on a sim nobody boots | `timeout 300 xcrun simctl bootstatus <udid> -b` |
| `maestro test` without a timeout | Can wait on an element forever | the helpers bound every Maestro call (90-180 s) |
| `duoctl ... tap --label` / `elements` | Needs the AXe CLI (not installed): "needs the AXe CLI" (2026-11-06) | point taps (section 6) |

Wrap anything that waits on a device in `timeout`. Long but finite commands (`pod install`,
`xcodebuild`, first build 10-20 min) run in the foreground with a bash timeout up to 2400 s;
never background them and end your turn, never `sleep`-poll.

## 2. Preflight

```sh
xcodebuild -version              # 27.2 verified 2026-11-05; Duo needs the 27.1+ SDK; the app needs Expo SDK 58+
xcrun simctl list runtimes       # two iOS 27.2 entries exist; the Duo needs the second (section 3)
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

- **The iPhone Duo needs the second iOS 27.2 runtime build.** `iPhone-Duo` on
  `SimRuntime.iOS-27-2` fails with "Incompatible device" (2026-11-06); it works on
  `com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4`.
- Cover: a classic iPhone (must look unchanged), the largest iPhone, an iPad 13", the Duo.
  Other agents' simulators share the list (some with names like "duo ..."): act only on
  the UDID you created.
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
git checkout package.json                       # prebuild rewrites it
```

`ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (Apple Silicon) builds only the host architecture; without
it the build takes about twice as long. One build serves every simulator of the same
architecture: install the same `.app` on the iPad and the Duo. A prebuilt `.app` from the same
commit set may be reused: check its README and install it instead of rebuilding (done 2026-11-06).
`ios/` is gitignored: remove it at the end if you created it (if it existed before, leave it).

**Second worktree (baseline, 2026-11-06):** symlinked `node_modules` make Metro fail with
`Unable to resolve module ./../../../...`. Copy instead: `cp -cR <main>/node_modules ./` and
`cp -cR <main>/apps/mobile/node_modules apps/mobile/` (APFS clones, seconds). Remove the
copies at cleanup.

## 5. Driving the UI

### 5.1 Backend and onboarding

- Port: `curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/healthz` (000 =
  free). `lsof` was unreliable (2026-11-06). `stack.sh up` refuses a port that answers.
  `BALU_E2E_PROJECT=<project> BALU_E2E_PORT=<port> tools/e2e/stack.sh up`, then the same two
  variables with `python3 tools/e2e/api.py setup --tasks 6` (409 = reused accounts, expected).
  **Every later `stack.sh psql` needs the same two variables** or it hits the wrong stack.
- The simulator shares the host network: the server URL is `http://localhost:<port>`.
- Fresh install (2026-11-05/06): "Connect to your server" -> type the URL -> Continue -> for
  `http://` "Continue without encryption" -> "Welcome back" login form. Then
  `tools/e2e/ios/login.py --udid "$UDID" owner`: exit 0 and `login submitted as owner` is the
  pass, and Today is reached. The "Save Password?" sheet: `ui.py tap '^Not Now$'`.
- **Duo cover URL entry (2026-11-06):** the keyboard can stay up over the Continue button, and
  a first Continue showed "That doesn't look like a valid URL" (the text had not landed).
  What worked: tap the field, `erase 40`, `type`, `key enter`, then Continue. Check the next
  screen before going on.
- login.py selects the inputs by their labels (`auth.email`/`auth.password`: "Email"/"Password",
  German "E-Mail"/"Passwort") and refuses to type unless the login heading is shown. It waits
  for the keyboard to drop before the password tap and aborts safely with a hardware keyboard.
  Verified: iPhone 17 portrait English and German ("Anmelden"), iPad 13" and iPhone 17 Pro Max
  portrait (English), Duo cover (English).
- If login.py aborts after typing the email, a rerun says "inputs not empty": relaunch the app
  (the form resets) or `ui.py erase N`. The password goes through a temporary flow file deleted
  after the run, never through argv or stdout. Throwaway e2e accounts only.
- Cold start: `xcrun simctl terminate "$UDID" com.blaumedia.balu`, then `launch`: lands on
  Today with the session kept (portrait, verified 2026-11-05).

### 5.2 Helper and Maestro

The helpers kill Maestro's process group on SIGINT, SIGTERM and SIGHUP; a SIGKILL of the
helper leaves the Maestro JVM and its temp dir behind.

Maestro writes typed text (`inputText`, so also passwords) verbatim into `~/.maestro/tests/`.
`ui.py` and `login.py` pass `--test-output-dir`, `--debug-output` and `--flatten-debug-output`
to a private `mktemp -d` (0700) removed after the call; do the same if you call `maestro test`
directly. Every `list`/`has`/`tap`/`screen-size`/`login.py` call adds a hierarchy-only folder
there (about 20 KB). Never delete folders by "what is new" or by timestamp: other agents run
Maestro too.

`tools/e2e/ios/ui.py --udid "$UDID" <cmd>`:

| Command | Use |
|---|---|
| `list [--full] [--all]` | visible nodes `[x1,y1][x2,y2] 'label'`; each prints twice (`awk 'NR%2==1'`); `--all` adds unlabelled nodes |
| `has REGEX` / `tap REGEX [--nth N]` | match on the label, tap the centre. `NOT FOUND` = nothing tapped |
| `point X Y` / `swipe X1 Y1 X2 Y2 [MS]` | absolute points (402 x 874 pt on iPhone 17) |
| `type TEXT\|-` / `erase N` / `key NAME` / `hide-keyboard` | focused field; `key enter` submits quick add and dismisses a single-line keyboard. Typed text is visible in `ps` and transcripts: **never pass secrets** (`type -` reads stdin). Text with `${` is rejected |
| `shot OUT.png` / `screen-size` | simctl screenshot (cite the path) / points |

- `maestro hierarchy` gives labels, bounds, enabled, selected and focused, but **no class
  names**. Select by label or geometry. A rail item's label can be an SF symbol name when not
  selected (2026-11-06, Duo rail: `favorite`, `calendar`, `hdr`).
- **The keyboard covers buttons.** `hide-keyboard` before tapping anything below y ~546 on
  iPhone. On the Duo `hide-keyboard` sometimes left the keyboard up; `key enter` worked.
- Maestro's `swipeLeft`/`swipeRight` take no start/end: use `swipe`.
- Deep link: `xcrun simctl openurl "$UDID" 'balu://settings'`; the "Open in Balu?" dialog:
  `ui.py tap '^Open$'`.

### 5.3 Gestures and flows (verified 2026-11-05/06)

- **Left edge back swipe:** `ui.py swipe 3 500 330 500` pops a pushed screen. Mid-screen swipes
  do not pop. Rows: left swipe opens Schedule; right swipe completes the task.
- **Dismiss a bottom sheet:** tap the dimmed strip above the sheet: iPhone 17 `point 200 65`;
  Duo cover `point 200 30` (`point 200 65` hit the sheet header). Stay below the status bar
  (y < 54 on iPhone never reaches the app). A downward swipe did not close the detail sheet.
- **Drafts survive a scrim close** (notes and title; iPhone 17, iPhone 17 Pro Max, iPad 13"
  portrait, Duo cover and landscape; 2026-11-06): type, close with the scrim, check
  `stack.sh psql -c "select title, notes from tasks where ..."`.
- **Tab labels differ by build:** classic bar `Upcoming, tab, 2 of 4`; NativeTabs `Upcoming`.
  Anchor on the prefix (`'^Upcoming'`) and check `list` after each tap: a missed tap silently
  leaves the old screen.
- **Date picker (verified Duo cover 2026-11-06):** the row `Deadline, None` -> tap
  `Deadline, Pick a date` -> `Date Picker` node -> day label (`Thursday, 12. November`). DB:
  `2026-11-12`. The row then reads `Deadline, Clear` (its label changes with the date; match it
  fresh). `^Deadline, Clear` -> DB NULL (verified). Reminder: `Remind me, Pick a date` opens a
  wheel (day, hour, minute); not completed (2026-11-06).
- **Attachments:** `xcrun simctl addmedia "$UDID" /tmp/<name>.png`, then task detail -> "Add
  attachment" -> "Photo" (limited Photos picker; tap the newest item). DB:
  `select filename, content_type, size_bytes from attachments where task_id = (...) and not is_deleted`.
- **Long-press drag (reorder):** not reproduced with a Maestro `swipe` (2026-11-05).
  `duoctl long-press` returns before any move, so there is no hold-and-drag on the Duo either
  (2026-11-06). Do not claim a drag PASS without a working method.

## 6. iPhone Duo

Verified 2026-11-06 on a Duo from section 3 (runtime build 19-4), `duoctl` 0.2.1 (on PATH).

- Displays (points): cover 466 x 678 (portrait), inner 669 x 951 portrait / 951 x 669 landscape.
- **duoctl:** always pass `-d <udid>` (else it wants "the only booted iPhone Duo").
  `state` (JSON: hingeAngle, activeScreen cover|inner, orientation, sizePoints); `open`,
  `close`, `half` (hinge 180 / 0 / 90; `--duration 1` animates); `rotate portrait|landscape`
  (inner screen, works); `tap X Y`, `swipe X1 Y1 X2 Y2 [--duration]`, `long-press X Y`
  (interface points of the active screen); `screenshot PATH.png`. `--label`, `--id` and
  `elements` need the AXe CLI (not installed).
- **Timing:** wait ~20 s after boot before the first `state`; wait ~4 s after `open` or
  `rotate` before reading the screen.
- **Coordinates (verified 2026-11-06):** `ui.py list`/`tap` use one shared space where the cover
  is at (0,0)-(466,678) and the inner display is bottom-right aligned to it, origin
  `(466-w, 678-h)`: (-203,-273) in portrait and landscape. **Inner point = hierarchy point minus
  the root origin** (+203, +273 on inner). `ui.py tap` only works on the cover; on the inner
  screen use `duoctl tap` with the converted point (Upcoming tab (287, 899), FAB (619, 822),
  both checked by their effect).
- **Folded cover:** the status column and the tab rail are on the right (rail about 84 pt, x
  382-466). Content and header end at x 382. FAB right edge 362 = 466 - 84 - 20 (`insets.right
  + 20`). Quick-add input x 60-361, above the keyboard.
- **Landscape inner (951 x 669):** the system rail is on the **right** (84 pt, x 867-951). The
  detail side sheet spans x 475-867 (width 392 = 951 - 84 - 475): the left edge sits on the fold
  (spec 475 +-1; measured 475).
- **Portrait inner (669 x 951):** no rail. Quick-add and detail are 600 cards, measured edges
  x 34 and x 634 (centred). The notes editor scrolls above the keyboard.
- **Half-open (hinge 91):** the inner screen stays active, landscape, side sheet unchanged (edge
  475), no task or draft lost. The pixel diff against the open frame was large (538k px at 6%)
  while mean brightness matched; the cause is not known.
- **Fold to cover with the detail open:** `close` left the detail nodes on the cover (sheet
  kind not confirmed). `open` brings the inner screen back. Draft after fold/unfold/close:
  `E2E Task C|<typed notes>` in the DB (verified).
- **Not verified on the Duo:** rotate-live with the detail open in portrait, German, tab bar
  contrast, drag.
- **Screenshots:** if the agent is text-only, do not open PNGs; judge with numbers (section 7).

## 7. Layout checks (overlap / clipping)

Per screen, device and pose: nothing cut off, no text running out of its container, nothing
under the rail, Dynamic Island or home indicator, FAB and sheets clear of system bars, the
keyboard not covering the focused input. A classic iPhone must look as before.

Judge from the hierarchy bounds first. For edges without viewing the PNG, write a 40-line
`prof.py` in /tmp (not in the repo): `magick IN.png -crop <W>x1+0+<Y*S> -resize <WPT>x1! -depth 8
txt:-` (S = PNG width / points), then print the x positions where mean luminance steps by more
than 18. This measured card edges, rail columns and the fold line (2026-11-06).

Checked 2026-11-06 (iPhone Duo): cover Today, Upcoming, Browse, Search, Settings top, quick-add
and detail bottom sheets with notes and keyboard; inner portrait quick-add and detail cards
(600); inner landscape detail side sheet (475 edge); fold (half, close) with the detail open.
Not checked: Settings scrolled to the end, inner landscape Today and quick-add.

**Finding (2026-11-05, iPhone 17):** the "Add notes..." editor sits under the keyboard when
focused in the task detail sheet, and the sheet does not move up. The Duo scrolled the editor
above the keyboard (2026-11-06). Check again after any sheet change.

Pixel diff: `magick compare -metric AE` printed values above the pixel count here (Q16-HDRI
7.1.2). Count instead: `magick a.png b.png -compose difference -composite -colorspace gray
-threshold 6% -format '%[fx:mean*w*h]' info:`. Crop the tab bar off first (the NativeTabs glass
edge reaches about y 2200 px at 3x). `xcrun simctl status_bar <udid> list` confirms the override.

## 8. Cleanup (always, also after a failure)

```sh
xcrun simctl shutdown "$UDID"; xcrun simctl delete "$UDID"       # only YOUR simulators
rm -rf /tmp/$ME-dd /tmp/$ME-udid
cd apps/mobile && git checkout package.json && rm -rf ios .expo  # only what you created
BALU_E2E_PROJECT=<project> BALU_E2E_PORT=<port> tools/e2e/stack.sh purge   # if you started it
```

Never `simctl shutdown all` / `delete all` / `erase all`, never quit Device Hub while other
simulators may run, never delete DerivedData you did not create, never delete `~/.maestro/tests`
folders by timestamp. Keep screenshots as evidence and cite their paths.

## 9. Not possible on this simulator set (2026-11-06)

- **iPad rotation:** `duoctl` drives only the Duo; there is no `simctl` rotation command and
  XCUIDevice is not available here. *(unverified: Device Hub rotate)*
- **iPad Split View / Slide Over:** not tried; needs Device Hub or a multitasking setup.
