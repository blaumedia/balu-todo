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
| `npx expo run:ios` | After install + launch it stays attached to `simctl log stream` forever | `xcodebuild ... build` (section 4), then `xcrun simctl install` + `xcrun simctl launch` |
| `npx expo start` / Metro | Dev server | Background with a log file and `&`, record the PID |
| `xcrun simctl spawn <udid> log stream` | Streams forever | `xcrun simctl spawn <udid> log show --last 2m --predicate 'process == "Balu"'` |
| `xcrun simctl io <udid> recordVideo` | Runs until interrupted (wrote 0-byte files on Xcode 27.2) | Screenshots |
| `xcrun simctl bootstatus <udid>` without `-b` | Waits forever on a sim nobody boots | `timeout 300 xcrun simctl bootstatus <udid> -b` (returned in seconds, 2026-11-05) |
| `maestro test` without a timeout | Can wait on an element forever | a bounded call (the helpers bound every Maestro call internally, 90-180 s) |

Wrap anything that waits on a device in `timeout` (GNU coreutils; on macOS
`gtimeout` or `timeout` from coreutils). Long but finite commands (`pod install`,
`xcodebuild`, first build 10-20 min) run in the foreground with a bash timeout up to 2400 s;
never background them and end your turn, never `sleep`-poll.

## 2. Preflight

```sh
xcodebuild -version                  # 27.2 verified 2026-11-05; Duo needs 27.1+ SDK; the app needs Expo SDK 58+
xcrun simctl list runtimes           # e.g. "iOS 27.2 - com.apple.CoreSimulator.SimRuntime.iOS-27-2"
xcrun simctl list devicetypes | grep -i -E 'duo|ipad|iphone'
maestro --version                    # 2.12.0 verified; `hierarchy` and `test --device` need it
df -h ~ | tail -1                    # ~20 GB free for a clean build
```

Xcode 27 has no Simulator.app; simulators are shown in **Device Hub**. **Quitting Device Hub
shuts down booted simulators**, including other agents' ones. Do not quit it.

## 3. Your own simulators

Never boot or reuse a simulator another agent might run. Create your own and delete it at
the end (verified 2026-11-05 with an iPhone 17 on the iOS 27.2 runtime):

```sh
ME=balu-e2e-ios-$$
UDID=$(xcrun simctl create "$ME-iphone" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-2)
echo "$UDID" > /tmp/$ME-udid                 # keep it: every later call needs it
xcrun simctl boot "$UDID" && timeout 300 xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100
```

Device types to cover for layout work (`xcrun simctl list devicetypes`): a classic iPhone
(must look unchanged), the largest iPhone, an iPad (13" for store shots), and the iPhone Duo.

**iPad:** set it to full-screen apps multitasking in Settings, else a window resize grip
shows in screenshots. Set language/locale per run (`-AppleLanguages`/`-AppleLocale` launch
args or the sim's Settings) if the status bar date matters.

## 4. Build and install (Release, no Metro)

```sh
cd apps/mobile
npx expo prebuild --platform ios --no-install   # verified 2026-11-05: clears and recreates ios/, rewrites package.json
(cd ios && timeout 2400 pod install)            # foreground; prints harmless "added script phase" notes
(cd ios && timeout 2400 xcodebuild -workspace Balu.xcworkspace -scheme Balu -configuration Release \
  -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath /tmp/$ME-dd \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build) > /tmp/$ME-build.log 2>&1
grep -E '\*\* BUILD' /tmp/$ME-build.log          # "** BUILD SUCCEEDED **" (verified)
APP=/tmp/$ME-dd/Build/Products/Release-iphonesimulator/Balu.app   # contains main.jsbundle (verified)
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" com.blaumedia.balu
git checkout package.json                       # prebuild rewrites it
```

`ARCHS=arm64 ONLY_ACTIVE_ARCH=YES` (Apple Silicon) builds only the host simulator
architecture; without it x86_64 is built too and the build takes about twice as long.

`--no-install` stops prebuild from running `pod install` itself, so run it yourself (above).
One build serves every simulator of the same architecture: install the same `.app` on the
iPad and the Duo instead of rebuilding. `ios/` is gitignored: remove it at the end, as
`apps/mobile/ios` is regenerated (if it existed before your run, do not delete it; if you
did, say so in your report).

## 5. Driving the UI

### 5.1 Backend and onboarding

- Stack and seed (`tools/e2e/README.md` 2-3): `BALU_E2E_PORT=<port> tools/e2e/stack.sh up`,
  then `BALU_E2E_PORT=<port> python3 tools/e2e/api.py setup --tasks 6`. `setup` reuses the
  accounts of an earlier run in the same state dir (409 is expected).
- The simulator shares the host network: the server URL is `http://localhost:<port>`
  (verified; Android uses `10.0.2.2`).
- Fresh install (verified 2026-11-05): "Connect to your server" -> type the URL -> Continue
  -> for `http://` a "Continue without encryption" button -> "Welcome back" login form.
  Log in with `tools/e2e/ios/login.py --udid "$UDID" owner`.
- The login form has no accessibility labels for its inputs. `login.py` finds the two input
  rows by geometry: unlabelled single-line boxes below the "Welcome back" / "Willkommen
  zurück" heading, at least 60 % of the screen width. The server chip above the email field
  has the same shape but is labelled with the server URL, so labelled nodes are skipped
  (without that the password would land in a plain visible field, found in review 2026-11-05).
  Exactly two rows must be found, else nothing is typed. A filled input gets its text as a
  label, so after the email the password row is the only unlabelled row left; it is looked up
  again (the layout shifts after the keyboard hides), must carry the `hintText` "Password" /
  "Passwort" with no text, and a keyboard must be up after the tap, else the password is not
  typed. `focused` is always false for these inputs. Verified end to end on iPhone 17
  portrait, English ("Log in") and German ("Anmelden"), 2026-11-05; iPad, the Duo cover
  screen and landscape are not verified yet. The password goes through a temporary Maestro
  flow file that is deleted right after the run, never through argv or stdout. Use
  throwaway e2e accounts only.
- iOS then shows a "Save Password?" sheet: `ui.py tap '^Not Now$'`.
- Cold start check: `xcrun simctl terminate "$UDID" com.blaumedia.balu`, then `launch`. It
  lands on Today with the session kept (verified).

### 5.2 Helper and Maestro

The helpers kill Maestro's process group on SIGINT, SIGTERM and SIGHUP and then clean up; a
SIGKILL of the helper cannot be caught and leaves the Maestro JVM and the temp dir behind.

Maestro writes typed text (`inputText`, so also passwords) verbatim into
`~/.maestro/tests/<timestamp>/`. `ui.py` and `login.py` run `maestro test` with
`--test-output-dir`, `--debug-output` and `--flatten-debug-output` pointing at a private
`mktemp -d` directory (0700) that is removed after the call; do the same if you call
`maestro test` directly (verified 2026-11-05, Maestro 2.12.0: nothing lands in
`~/.maestro/tests`). `maestro hierarchy` has no such flag and writes a folder with
`maestro.log` and an xctest runner log there; it types nothing and the logs held no node
text. Maestro also writes `~/Library/Logs/maestro/<timestamp>_<pid>.zip` per run (checked:
empty `maestro.log`, no typed text). Never delete folders there by "what is new": other
agents run Maestro too. Every `list`, `has`, `tap`, `screen-size` and `login.py` call adds a
hierarchy-only folder (no flow subfolder, about 20 KB, no typed text) to `~/.maestro/tests`;
the machine owner may prune old ones while no Maestro run is active.

`tools/e2e/ios/ui.py --udid "$UDID" <cmd>`:

| Command | Use |
|---|---|
| `list [--full] [--all]` | visible nodes: `[x1,y1][x2,y2] 'label'`; `--all` adds unlabelled nodes, `--full` keeps long labels |
| `has REGEX` / `tap REGEX [--nth N]` | match on the accessibility label; tap the centre |
| `point X Y` / `swipe X1 Y1 X2 Y2 [MS]` | absolute points (402 x 874 pt on iPhone 17) |
| `type TEXT\|-` / `erase N` / `key NAME` / `hide-keyboard` | focused field; `key enter` submits quick add. `type` text is visible in `ps` and the transcript: **never pass secrets** (passwords go through `login.py`; `type -` reads stdin). Text containing `${` is rejected |
| `shot OUT.png` | screenshot via simctl (save under /tmp, cite the path) |
| `screen-size` | width and height in points |

- `maestro hierarchy` gives labels, bounds, enabled, checked, selected and focused, but **no
  class names**. Select by label or by geometry.
- **The keyboard covers buttons.** A tap on a button under the keyboard hits a key (2026-11-05:
  a stray letter ended up in the server URL). Run `hide-keyboard` before tapping a button
  that sits below y ~546 while the keyboard is up.
- Maestro's `swipeLeft`/`swipeRight` do not take start/end: use the generic `swipe` (the helper
  does).
- Deep links: `xcrun simctl openurl "$UDID" 'balu://settings'`. The first call shows an
  "Open in Balu?" dialog: `ui.py tap '^Open$'`. Verified: Settings opens, Back returns to Today.
- Screenshot paths: always the portrait framebuffer. Judge the layout from the hierarchy
  bounds first; open a PNG only for the checks in section 7.

### 5.3 Gestures (verified on iPhone 17, 2026-11-05)

- **Left edge back swipe:** `ui.py swipe 3 500 330 500` (start x 3 pt, mid-height) pops the
  pushed project screen back to Browse. A swipe that starts mid-screen does not pop.
- **Row swipe, mid-row:** a leftward swipe on a task row opens the Schedule sheet; a rightward
  swipe completes the task (the row leaves the list; `completed_at` set in the DB). Neither
  navigates back.
- **Dismiss a bottom sheet:** tap the dimmed strip just under the status bar, `point 200 65`
  (y < 54 is the iOS status bar, its taps never reach the app). A downward swipe did not
  close the task detail sheet, and the Schedule sheet was closed by a tap on the scrim at y 400.
- **Date picker** (task detail): tap "Deadline, Pick a date", then the "Date Picker" node
  (opens the calendar), then the day label (`Thursday, 12. November`). The popover closes on
  the pick; the row reads "12 Nov" and the DB holds the date.
- **Long-press drag (reorder):** not reproduced. A Maestro `swipe` with `duration` 1800 ms on a
  project row did not reorder the list (2026-11-05). Do not claim a drag PASS without a
  working method. Untested: `cliclick` on the host (mouse down/move/up); the Device Hub window
  is reachable via System Events but its screen mapping is not known.

### 5.4 Attachments

- `xcrun simctl addmedia "$UDID" /tmp/<name>.png` puts a PNG in the simulator's library
  (verified). Create it with ImageMagick: `magick -size 320x240 xc:'#3a7bd5' /tmp/<name>.png`.
- Task detail -> "Add attachment" -> action sheet: "Photo" or "File". "Photo" opens the
  Photos picker in limited-access mode with a banner; the newest item is the one you added.
  Tap it: the attachment list shows it (verified). The "File" branch is not tried yet.
- Verify at the server: `tools/e2e/stack.sh psql -c "select filename, content_type, size_bytes
  from attachments where task_id = (select id from tasks where title = '<title>') and not is_deleted"`.

## 6. iPhone Duo

- Displays (points): cover 466 x 678 (portrait only), inner 669 x 951 portrait / 951 x 669
  landscape. Store screenshots: cover 1398 x 2034, inner 2007 x 2853 (and landscape
  variants).
- In most poses iOS draws a vertical **rail** (~84 pt, status bar, back button, tab bar) on
  the left or right edge, so check left/right safe-area insets, not only top/bottom. On the
  cover the status bar is a column on the right that overlaps full-bleed content.
- `simctl` and Maestro cannot fold or rotate the Duo. Use a fold-control CLI such as
  `duoctl` (open source, built from source; `state|open|close|half|hinge|rotate|tap|swipe|screenshot`)
  or Device Hub. Wait ~20 s after boot before using it. *(tool choice unverified for balu)*
- Check every screen: folded, open portrait, open landscape, half-open (nothing to read or
  tap in the fold), and folding with a screen open (same screen, same scroll, same state).

## 7. Layout checks (overlap / clipping)

Per screen, device and pose: screenshot and look; nothing cut off, no text running out of
its container, nothing drawn under the rail, the Dynamic Island or the home indicator, FAB
and sheets clear of system bars, keyboard not covering the focused input. A classic iPhone
must look as before.

Checked 2026-11-05, iPhone 17: onboarding, Today, Settings (the server row ends at y 875,
the screen bottom edge), Browse, project screen, quick-add sheet (input above the keyboard
at every stage), task detail sheet. **Finding:** in the task detail sheet the "Add notes..."
editor (y 561-641) sits under the keyboard (top edge y 546) when focused, and the sheet
does not move up. The quick-add sheet does move up. Check the detail sheet again after a
fix before you mark it clean.

## 8. Cleanup (always, also after a failure)

```sh
xcrun simctl shutdown "$UDID"; xcrun simctl delete "$UDID"      # only YOUR simulators
rm -rf /tmp/$ME-dd /tmp/$ME-udid
rm -rf "$MAESTRO_OUT"                       # only if you called `maestro test` yourself with --test-output-dir
cd apps/mobile && git checkout package.json && rm -rf ios .expo
tools/e2e/stack.sh purge                    # if you started the stack (also removes its state dir)
```

Never `xcrun simctl shutdown all` / `delete all` / `erase all`, never quit Device Hub while
other simulators may be in use, never delete DerivedData you did not create. Never delete
`~/.maestro/tests` folders by timestamp: other agents' runs live there too.
