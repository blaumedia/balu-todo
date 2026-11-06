---
name: mobile-android-e2e
description: Build, install and drive the balu mobile app (Expo, apps/mobile) on an Android emulator for e2e and smoke checks - phone and tablet AVDs. Use before any Android build, emulator start, adb/uiautomator check or release-APK smoke test in this repo. Carries the commands that never return (and hung workers for 40+ min), AVD isolation rules, and cleanup.
---

# balu mobile: Android e2e

The detailed reference is `tools/e2e/README.md` (section 2 stack, 3 API seeding, 6 Android
runbook). This skill is the short, enforced version: read it fully before the first command,
then use the README for details.

## 0. This skill improves itself - you are expected to update it

Every agent that uses this skill is also its maintainer. Before you end your run, update this
file when any of these happened:

- A command hung, failed or behaved differently than written here (fix it in place).
- You needed more than one attempt (write the working attempt and the failing one in one line).
- An *(unverified)* entry worked or did not: remove the marker or correct it.
- You found a faster or safer way: replace the old step, do not append a second variant.

Entries are verified facts only (you ran it and saw the result), short, and dated
(`2026-11-05`). Edit the section the learning belongs to; keep this file under 250 lines and
move bulky detail to `tools/e2e/README.md` section 6.

**This repository is public (its whole git history too).** Never put in: secrets, passwords,
tokens, raw log lines with typed text; people's names; host names, internal domains, LAN IPs or
ports of private services; device names, serials or UDIDs; personal AVD/simulator names;
absolute paths under a home directory or a specific Homebrew prefix. Use placeholders
(`<Base>.avd`, `<serial>`, `<a JDK 17 home>`) and say how to find the value.

Mention the skill edit in your final report (one line), so the orchestrator can review it.

## 1. Rule zero: every command must return

A worker sat 38 minutes on one bash call (2026-11-05) because the command never exits. Before
running anything, ask "does this exit on its own?"

**Never run these in the foreground:**

| Command | Why it hangs | Use instead |
|---|---|---|
| `npx expo run:android` (any variant) | Stays attached to Metro / the device log; release waits on `localhost:8081` | Gradle build + `adb install` (section 4) |
| `npx expo run:ios` | Attaches to `simctl log stream` forever (2026-11-05) | `xcodebuild ... build`, then `simctl install` + `simctl launch` |
| `npx expo start` / Metro | Dev server, runs until killed | Background with a log file, `&`, record the PID |
| `emulator -avd ...` | Runs as long as the emulator | `... > /tmp/<you>-emu.log 2>&1 &` |
| `adb logcat` without `-d` | Streams forever | `adb -s $ANDROID_SERIAL logcat -d -t 500` |
| `adb wait-for-device` / `adb -s X shell` on a serial that never boots | Waits forever | The bounded boot wait below |
| `xcrun simctl spawn <id> log stream` | Streams forever | `log show --last 2m` with a predicate |
| `./gradlew --stop` | Kills other agents' builds | Leave daemons alone |

Wrap anything that waits on a device or network in `timeout` (GNU; on macOS check
`command -v timeout gtimeout`): `timeout 120 adb -s "$ANDROID_SERIAL" wait-for-device`.

Long but finite commands are fine in the foreground (first Gradle build ~15 min, later 2-4 min,
`pod install`, `xcodebuild`): bash timeout up to 2400 s, never background them and end your turn.

Bounded boot wait:

```sh
timeout 300 sh -c 'until [ "$(adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = 1 ]; do sleep 3; done' \
  || { echo "emulator did not boot in 300 s"; tail -30 /tmp/<you>-emu.log; exit 1; }
```

## 2. Preflight (once per run)

```sh
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"   # Android Studio default on macOS
export JAVA_HOME=<a JDK 17 home>        # Gradle fails without it ("SDK location not found" / JDK errors)
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
adb devices -l            # note who else is running: never touch those serials
df -h ~ | tail -1         # builds need ~15 GB free; a full disk gives cryptic Gradle/Xcode errors
```

`adb devices` also lists real phones (USB or wireless debugging). Only ever use an
`emulator-<port>` serial you started yourself (`ANDROID_SERIAL` / `adb -s`; the helpers refuse to run without it).

## 3. Your own emulator (phone or tablet)

Never boot or reuse an AVD another agent might run. Clone (APFS clone, instant):

```sh
cd ~/.android/avd
BASE_INI=<Base>.ini                         # the AVD name is the ini name, not the .avd dir name
BASE_DIR=$(sed -n 's#^path=.*/##p' "$BASE_INI")   # the .avd directory from path=
ME=balu-e2e-$$                                                    # unique clone name
cp -cR "$BASE_DIR" "$ME.avd"
sed "s#$BASE_DIR#$ME.avd#" "$BASE_INI" > "$ME.ini"
rm -f "$ME.avd"/*.lock
sed -i '' -e "s/^AvdId=.*/AvdId=$ME/" -e "s/^avd.ini.displayname=.*/avd.ini.displayname=$ME/" "$ME.avd/config.ini"
PORT=5600                                   # free even port 5554-5682, not 5554, not in adb devices
emulator -avd "$ME" -port $PORT -no-snapshot-save -no-boot-anim > /tmp/$ME-emu.log 2>&1 &
export ANDROID_SERIAL=emulator-$PORT
# bounded boot wait (section 1), then:
adb shell pm clear com.blaumedia.balutodo 2>/dev/null
```

The clone can carry another account's app data: after the first install run `pm clear`, or
the app opens logged in on foreign tasks (2026-11-06).

**Tablet** (verified 2026-11-06): on a booted phone emulator run
`adb shell wm size 1600x2560 && adb shell wm density 320` (10", 800x1280 dp). Reset with
`wm size reset` / `wm density reset`. Editing `hw.lcd.*` in the clone's `config.ini` has no effect.
Rotation: `adb shell settings put system accelerometer_rotation 0`, THEN
`adb shell settings put system user_rotation 1` (0 portrait, 1 landscape, 2560x1600 px). The other
order leaves the screen in portrait.
Geometry at 1600x2560 / 320 (2026-11-06): rail 176 px (88 dp; grows with the font scale, see
`railWidth` in `apps/mobile/src/lib/layout.ts`), content from x 176, FAB at x 1440-1560 and
y 2296-2416 (right 20 dp). Quick-add card 600 dp = 1200 px: container x 288-1488 in portrait, and
x 768-1968 in landscape. Detail side sheet 560 dp in landscape.
A live `wm size` change (1000x2560 = 500 dp, back to 1600x2560) switches rail <-> bottom bar and card
<-> bottom sheet without a restart; typed text survives. A `wm density` change recreates the activity
(the sheet reopens, typed quick-add text is lost) by design.
7-inch window: `wm size 1200x1920` with `wm density 320` (600x960 dp).
Portrait-manifest letterboxing on large screens: `adb shell wm set-ignore-orientation-request true`.

**Nav bar and cutout overlays** (2026-11-06): `adb shell cmd overlay list | grep -iE 'navbar|cutout'`.
3-button nav: `cmd overlay disable com.android.internal.systemui.navbar.gestural` then
`cmd overlay enable com.android.internal.systemui.navbar.threebutton`; the bottom inset then reads 112 px
(`dumpsys window windows | grep -oE 'insetsSize=Insets\{[^}]*\}'`). Restore gestural after the run.
Cutout: `cmd overlay enable com.android.internal.display.cutout.emulation.tall` (or `hole`) showed `[x]`,
but `dumpsys window | grep -o 'mDisplayCutout=DisplayCutout{insets=[^}]*'` stayed zero in both orientations:
this base image does not apply it. Report a cutout check NOT POSSIBLE unless the insets are non-zero.

## 4. Build and install (release APK, no Metro)

```sh
cd apps/mobile
npx expo prebuild --platform android --no-install     # rewrites package.json, creates android/ and .expo/
(cd android && ./gradlew :app:assembleRelease)       # foreground, bash timeout 2400 s
# one ABI only (must match the emulator image, arm64-v8a on Apple Silicon), ~1.5 min (2026-11-06):
# (cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a)
adb install -r android/app/build/outputs/apk/release/app-release.apk
git checkout package.json                            # unless the task changed it on purpose
```

Older tag (expo 54, reanimated 4.1.7 + worklets 0.5.1) fails with `ninja: ... libworklets.so missing`
(2026-11-06). Workaround in a throwaway tree: delete reanimated's `android/.cxx` and worklets'
`android/build`, copy worklets' RelWithDebInfo `libworklets.so` to the path reanimated expects, and
rebuild with `--no-parallel`. Never run two release builds at once.

Check the installed build: `adb shell dumpsys package com.blaumedia.balutodo | grep -E 'versionName|lastUpdateTime'`.
HEAD still reports `versionName=1.6.0` (2026-11-06): compare the size of `adb shell pm path` (`stat -c %s`)
with the APK file size (`stat -f %z`) instead.

Dev client instead (only for hot reload): Metro in the background
(`npx expo start --dev-client > /tmp/$ME-metro.log 2>&1 &`), then
`tools/e2e/android/cold.sh --dev-client "balu://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"`.

## 5. Backend, login, driving the UI

- Stack: `tools/e2e/stack.sh up` (port `BALU_E2E_PORT`, default 8090; never compose project `balu`).
  `up` always runs `docker compose up -d --build` (cached layers keep it short). If another agent's
  stack runs, use `BALU_E2E_PROJECT=balu-e2e-<you> BALU_E2E_PORT=<free port>` (check with `lsof -nP -iTCP:<port>`).
  Seed: `tools/e2e/api.py setup [--tasks N]`.
- Server URL in the app: `http://10.0.2.2:<port>`. On a fresh install enter it, tap Continue, then
  confirm "Continue without encryption" (http://) before the login form appears (2026-11-05).
- Login: `tools/e2e/android/login.py owner|member` (password via stdin). Export the same
  `BALU_E2E_PROJECT` and `BALU_E2E_PORT` first, or it stops with `missing owner.pw in the state dir`.
- `cold.sh` is POSIX sh: `sh tools/e2e/android/cold.sh` (`python3 cold.sh` is a SyntaxError).
- UI helper: `tools/e2e/android/ui.py list|tap|has|dump|swipe|scroll|state|type|desc`. `list` lines are
  `[x1,y1][x2,y2] ...`: `awk -F'[][,]' '{print $2,$3,$5,$6}'` gives x1 y1 x2 y2. Use `list --full` for
  bounds without truncation. `dump FILE` masks password nodes; do not bypass it.
- `ui.py tap REGEX` matches `text`; add `--desc` for `content-desc`. Tabs with a badge read `3, Browse`
  (`ui.py tap '^(1, )?Browse$' --desc`). A language change changes the descriptions (Back reads `Zurück`).
- Checkbox rows and switches have no text: find them in `dump` output (`checkable="true"`, or class
  `android.widget.CheckBox`, left edge < 137 px) and tap the centre of their bounds. Reminders switch:
  bounds `[916,1845][1038,1916]` in English Settings, checked="true" once on (2026-11-06).
- Notification permission: the Settings toggle opens `Allow Balu to send you notifications?`; tap it with
  `ui.py tap '^Allow$'` (text, no `--desc`).
- Screenshot: `adb exec-out screencap -p > /tmp/$ME-<name>.png`. Right after a rotation or `wm size` change
  it can write an empty file: retry in its own call (2026-11-06). Never open a PNG with `read`.
- **Quick-add text is lost** (2026-11-06, 2 of 2 sessions): the focused EditText (`dumpsys input_method
  | grep mInputShown=true`) showed only its hint, and neither `ui.py type` nor a raw `keyevent` reached it. `am force-stop` and
  a relaunch fixed it; tap `Add task` again, then type.
- Quick-add: `keyevent 66` adds and keeps the sheet open. With the keyboard up, BACK hides it, the next
  BACK closes the sheet, and a third leaves the app (2026-11-06).
- Sheet dismiss: the scrim is a full-screen `desc='Close'` node; tap a strip above the sheet or drag down
  (`input swipe 540 230 540 2200 300`). A plain BACK also closes a sheet with no keyboard up.
- Reminder (2026-11-06, EN): in the detail sheet the row is `desc='Remind me, Pick a date'`.
  1. Date cell `ui.py tap '^06 November 2026$' --desc`, then `OK` (`ui.py tap '^OK$'`).
  2. Time: `Switch to text input mode` (`--desc`). The keyboard then moves the dialog up: re-dump
     before each tap. Tap the hour field, `KEYCODE_MOVE_END`, two `KEYCODE_DEL`, `input text 06`;
     same for minutes.
  3. Tapping the AM field opens a `PopupWindow` with AM/PM: check `dumpsys window | grep mCurrentFocus`,
     then tap `AM` inside the popup (`ui.py tap '^AM$'`). Without that the dialog stays under it.
  4. `OK`. The row reads `Remind me, Today · 6:28 AM`; the DB stores UTC `reminder_at`.
  Cancelling keeps the wrong date: `CANCEL` before reopening the picker.
- Alarms (2026-11-06):
  - `adb shell dumpsys alarm | grep -A3 <pkg>`; the count of matching lines is two per alarm.
  - `am force-stop` removes all the app's alarms (0 after force-stop). The next launch re-arms them.
    For a cold-start notification test use `keyevent 3` then `am kill <pkg>` (process gone, alarms kept).
  - Reminders are inexact: R1 due 06:28 fired at 06:30:57 (about 3 min late). Wait 3.5 min before calling one missing.
  - Delivered check: `dumpsys notification --noredact | grep -A25 pkg=<pkg>` shows `when=` and `android.title=`.
    Shade: `cmd statusbar expand-notifications`, `ui.py list`, tap the title's bounds (a tap opened the task
    detail sheet on a cold start), `cmd statusbar collapse`.
  - An in-place upgrade (`install -r`) about 4 min before a reminder kept the alarm and the reminder
    fired. logcat printed `lost permission to set exact alarms` at the update but did not drop it.
    (The run that lost a reminder on 2026-11-06 did not reproduce.)
  - `adb reboot` plus the bounded boot wait keeps the alarms (one reminder survived, 2026-11-06).
- Notes: on HEAD, type notes, BACK (hides keyboard), BACK (closes sheet), reopen: the notes field shows the
  text and the DB has it (2026-11-06). On 1.6.0 a scrim tap close lost typed notes once. Check
  `tools/e2e/stack.sh psql -c "select title, notes from tasks"` after every close.
- Inbox has no add button: quick-add without a project lands in Inbox. Projects: no `api.py` command (Browse, `New project`).
- Attachment DATEI: use `Show roots` then `Downloads` (`adb push <file> /sdcard/Download/`); Recent does not show pushed files.
- Language: change it in the app's Settings (`Deutsch` row), not the device locale (2026-11-06).
- Font scale: `adb shell settings put system font_scale 2.0` resizes the rail live (2026-11-06). Check
  `pidof <pkg>` after each change: once the process died with `The imperative router is unavailable before
  the first render` (not reproduced in two retries).
- Dark theme check (2026-11-06): `magick <png> -alpha off -crop 40x40+500+700 -format %[fx:mean] info:` gives ~0.08.
- Drag (reorder): `input swipe` cannot do it. Use `input motionevent DOWN x y`, hold ~900 ms, stepped
  `MOVE` 0.1 s apart, then `UP`. Check `sort_order` in the DB.
- `api.py` changes show in the app after `api.py sync-probe` and a few seconds. Use `ui.py type` (not `input text`) for spaces.
- `configChanges`: `plugins/withConfigChanges.js` adds the size flags and keeps `density` OUT. Check
  `grep -o 'configChanges="[^"]*"' android/app/src/main/AndroidManifest.xml` after prebuild. Test a
  `wm size` change with a sheet open: same pid, text kept.
- Handling `density` in-process broke layout: `wm size` then `wm density` followed by the resets in
  reverse order back to back left the tab bar and FAB off screen until a cold start (2026-11-06).
  Check bounds, not presence.

## 6. Layout checks (overlap / clipping)

For each screen and each device/orientation you were asked to cover:

1. Screenshot and look at it: nothing cut off at any edge, no text running out of its container, no
   element drawn over another, FAB and sheets clear of the nav bar.
2. `ui.py list --full` and compare bounds: every node's right edge <= screen width, no two interactive
   nodes overlap. A label beyond the screen width is a real bug (seen in TaskRow before, Yoga flexWrap).
   Nav bar: FAB bottom <= screen height minus the bottom inset (112 px in portrait, 3-button).
3. Open the keyboard on input screens: the input stays visible above it.
4. Pixel diff against a baseline: fix the status bar with demo mode (`sysui_demo_allowed 1`, broadcast
   `com.android.systemui.demo` with `enter`, `clock -e hhmm 1000`, `notifications -e visible false`, `exit`).
   Diff with `magick` after `-alpha off`, `-threshold 0`, `-format %[fx:mean*W*H]`. Do not trust
   `compare -metric AE` on RGBA PNGs. Repeat-capture the same screen first: a settling state differs by a few thousand pixels.

## 7. Cleanup (always, also after a failure)

```sh
adb -s "$ANDROID_SERIAL" emu kill                    # only YOUR serial (prints "OK: killing emulator")
kill <your Metro PID> 2>/dev/null
rm -rf ~/.android/avd/$ME.avd ~/.android/avd/$ME.ini
cd apps/mobile && git checkout package.json && rm -rf android .expo
BALU_E2E_PROJECT=<yours> BALU_E2E_PORT=<yours> tools/e2e/stack.sh down    # then `purge` if you own the state dir
```

Reset device changes before the kill (overlays back to default, `wm size/density reset`, `font_scale 1.0`,
`user_rotation 0`, `accelerometer_rotation 1`).

Never: `adb kill-server`, `adb emu kill` without `-s`, `./gradlew --stop`, `pkill java`, `pkill emulator`,
or an `rm` that contains an adb/SDK path.
