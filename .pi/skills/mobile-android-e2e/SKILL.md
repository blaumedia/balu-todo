---
name: mobile-android-e2e
description: Build, install and drive the balu mobile app (Expo, apps/mobile) on an Android emulator for e2e and smoke checks - phone and tablet AVDs. Use before any Android build, emulator start, adb/uiautomator check or release-APK smoke test in this repo. Carries the commands that never return (and hung workers for 40+ min), AVD isolation rules, and cleanup.
---

# balu mobile: Android e2e

The detailed reference is `tools/e2e/README.md` (section 2 stack, 3 API seeding, 6 Android
runbook). This skill is the short, enforced version: read it fully before the first command,
then use the README for details.

## 0. This skill improves itself - you are expected to update it

Every agent that uses this skill is also its maintainer. It only gets better if you feed
back what you learned; a trap that only lives in your transcript is lost when you finish.

**Before you end your run, update this file** when any of these happened:

- A command hung, failed or behaved differently than written here (add it to the table in
  section 1 or fix the command in place).
- You needed more than one attempt to get something working (write down the attempt that
  worked, and the one that did not, in one line).
- An entry marked *(unverified)* worked or did not: remove the marker or correct it.
- You found a faster or safer way to do a step: replace the old step, do not append a
  second variant.

How to write an entry:

- Only verified facts: you ran it and saw the result. Guesses go in as *(unverified)*.
- Short: symptom, cause, what to do instead. Add the date (`2026-11-05`) so stale entries
  can be spotted.
- Edit the section the learning belongs to; do not grow a changelog at the bottom. If a
  section gets long, condense it - this file must stay quick to read (aim for < 250 lines);
  move bulky detail to `tools/e2e/README.md` section 6 and link it.
- **This repository is public (its whole git history too).** Write every entry so it holds
  on any developer's machine. Never put in: secrets, passwords, tokens, raw log lines with
  typed text; people's names; host names, internal domains, LAN IPs or ports of private
  services; device names, serials or UDIDs; personal AVD/simulator names; absolute paths
  under a home directory or a specific Homebrew prefix. Use placeholders (`<Base>.avd`,
  `<serial>`, `<a JDK 17 home>`) and describe how to find the value instead. Machine-specific
  notes belong in the maintainer's private notes, not here.
- Mention the skill edit in your final report (one line: what you added or changed), so the
  orchestrator can review it with the rest of your work. Commit it together with your other
  e2e tooling changes, or leave it uncommitted for the orchestrator if you commit nothing.

## 1. Rule zero: every command must return

A worker sat 38 minutes on one bash call (2026-11-05) because the command it ran never
exits. The tool call only ends when the process ends, so you see nothing and nobody can
tell a hang from a slow build. Before running anything, ask "does this exit on its own?"

**Never run these in the foreground:**

| Command | Why it hangs | Use instead |
|---|---|---|
| `npx expo run:android` (any variant) | After install it stays attached to Metro / the device log; release variant even waits on `localhost:8081` | Gradle build + `adb install` (section 4) |
| `npx expo run:ios` | Same trap on iOS: after launching it attaches to `simctl log stream` forever (the 2026-11-05 hang) | `xcodebuild ... build`, then `xcrun simctl install` + `xcrun simctl launch` |
| `npx expo start` / Metro | Dev server, runs until killed | Start in the background with a log file, `&`, and record the PID |
| `emulator -avd ...` | Runs as long as the emulator | Always `... > /tmp/<you>-emu.log 2>&1 &` |
| `adb logcat` without `-d` | Streams forever | `adb -s $ANDROID_SERIAL logcat -d -t 500` |
| `adb wait-for-device` / `adb -s X shell` on a serial that never boots | Waits forever | The bounded boot wait below |
| `xcrun simctl spawn <id> log stream` | Streams forever | `log show --last 2m` with a predicate |
| `./gradlew` with a running daemon you did not start | Fine, but `--stop` kills other agents' builds | Leave daemons alone; never `./gradlew --stop` |

**Wrap anything that waits on a device or network in `timeout`** (GNU coreutils; on macOS
it may be installed as `gtimeout`, check with `command -v timeout gtimeout`):
`timeout 120 adb -s "$ANDROID_SERIAL" wait-for-device`.

**Long but finite commands are fine in the foreground** (first Gradle build ~15 min, later
2-4 min; `pod install`; `xcodebuild`): give the bash call a timeout of up to 2400 s, never
background them and end your turn, never `sleep`-poll.

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
df -h ~ | tail -1         # builds need ~15 GB free; full disk = cryptic Gradle/Xcode errors
```

`adb devices` can also list real phones (USB or wireless debugging over the network). Only
ever use an `emulator-<port>` serial you started yourself, always via `ANDROID_SERIAL` /
`adb -s`.

## 3. Your own emulator (phone or tablet)

Never boot or reuse an AVD another agent might run. Clone (APFS clone, instant):

```sh
cd ~/.android/avd
ls *.ini                                    # pick a phone AVD (API 35+) as the base
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
adb shell pm clear com.blaumedia.balutodo 2>/dev/null   # base AVD may carry a logged-in app
```

**Tablet** (verified 2026-11-06): on a booted phone emulator run
`adb shell wm size 1600x2560 && adb shell wm density 320` (10" tablet, ~800x1280 dp; reset with
`wm size reset` / `wm density reset`). Editing `hw.lcd.*` in the clone's `config.ini` had no
effect on this AVD base: do not use that route. Rotate with
`adb shell settings put system accelerometer_rotation 0` then
`adb shell settings put system user_rotation 1` (0 portrait, 1 landscape); set `user_rotation`
again after the app has unlocked rotation. Check every screen in both orientations.
Order matters (2026-11-06): set `accelerometer_rotation 0` before `user_rotation 1`. With it left at 1 the emulator follows its sensor (portrait) and the screen does not rotate, which looked like an app bug until the setting was checked.
Verified tablet geometry at 1600x2560 px with `wm density 320` (800x1280 dp), 2026-11-06: rail 176 px wide (88 dp at font scale 1.0; it grows with the font scale up to 176 dp, see `railWidth` in `apps/mobile/src/lib/layout.ts`), tab items top-aligned under the status bar, content starts at x 176, FAB right edge at 1560 (right 20 dp); quick-add card 600 dp wide, centred right of the rail (x 144-744 dp); detail side sheet 560 dp (x 720-1280) in landscape. A 600 dp window (1200 px) gives a quick-add card that fills the area right of the rail (512 dp). Live `wm size` changes (1000x2560 = 500 dp, back to 1600x2560) keep the same pid and switch rail <-> bottom bar and card <-> bottom sheet without a restart; the typed text survives.
For a 7-inch window use `wm size 1200x1920` with `wm density 320` (600x960 dp); it is a rotation-allowed window (short side >= 600 dp).
Android 12L+ large-screen letterboxing of portrait-manifest apps is off on a plain emulator;
turn it on with `adb shell wm set-ignore-orientation-request true` to test a cold start held
in landscape (2026-11-06).

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

Before trusting any screenshot, check the installed build is the one you just built:
`adb shell dumpsys package com.blaumedia.balutodo | grep -E 'versionName|lastUpdateTime'`.

Dev client instead (only when you need hot reload): Metro in the background
(`npx expo start --dev-client > /tmp/$ME-metro.log 2>&1 &`), then
`tools/e2e/android/cold.sh --dev-client "balu://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"`.

## 5. Backend, login, driving the UI

- Stack: `tools/e2e/stack.sh up` (port `BALU_E2E_PORT`, default 8090; never compose project
  `balu`; pick a port no other local stack uses). If another agent's e2e stack is running, use
  your own: `BALU_E2E_PROJECT=balu-e2e-<you> BALU_E2E_PORT=<free port>` (2026-11-06). Seed: `tools/e2e/api.py setup [--tasks N]`.
- Server URL in the app: `http://10.0.2.2:<port>`.
- Login: `tools/e2e/android/login.py ROLE` (password goes via stdin to the device shell). Export the same `BALU_E2E_PROJECT` and `BALU_E2E_PORT` as the stack first, or it stops with `missing owner.pw in the state dir` (2026-11-06). On
  a fresh install enter the server URL first, and on an `http://` server confirm "Continue
  without encryption" before the login form appears (2026-11-05).
- `cold.sh` is POSIX sh: run `sh tools/e2e/android/cold.sh`. `python3 cold.sh` is a SyntaxError (2026-11-06).
- Tabs with a badge change their content-desc (the Browse tab reads `1, Browse`). Tap with `ui.py tap '^(1, )?Browse$' --desc`, or the tap reports `NOT FOUND` and the screen does not change (2026-11-06).
- The Today row checkbox is an `android.widget.CheckBox` with no content-desc. `ui.py list` does not show it. Find it in a raw `uiautomator dump` (class `android.widget.CheckBox`, left edge < 137 px) and tap the centre of its bounds (2026-11-06). The task then leaves Today and the DB row gets `completed_at`.
- Inbox: the Inbox screen has no add button. Create the inbox task from Today's quick-add without a project; it lands in Inbox and gives the Browse tab its `1, Browse` badge (2026-11-06).
- UI: `tools/e2e/android/ui.py list|tap|has|dump|swipe|scroll|state|type|desc`. Do not bypass
  `ui.py` for dumps (it masks password nodes). Never quote raw typed-text or log lines that
  could contain a password in a report.
- Screenshot: `adb exec-out screencap -p > /tmp/$ME-<name>.png`, then look at it.
  Right after a rotation or `wm size` change it can write an empty file: wait a moment and
  retry, and run it as its own call, not chained after `input tap; sleep` (2026-11-06).
- Changes made through `api.py` show in the app only after a sync: run `api.py sync-probe`
  and wait a few seconds (2026-11-06).
- Release builds still log `console.log` to logcat as `ReactNativeJS`
  (`adb logcat -d -s ReactNativeJS`), handy for a temporary debug value (remove it after).
- Avoid `%s` in quick-add text; use `ui.py type`.
- Quick-add sheet: the Return key (`keyevent 66`) adds and keeps the sheet open; BACK with no sheet open leaves the app to the launcher. With the keyboard up, the first BACK only hides the keyboard; the second closes the sheet; a third leaves the app (2026-11-06). Offline (`cmd connectivity airplane-mode enable`) tasks keep their temp id across an app restart and sync within ~45 s after disabling it (2026-11-06).
- Sheet dismiss taps (2026-11-06, phone 1080x2400): the scrim is one full-screen node `desc='Close'` (English UI only, it is `t('common.close')`);
  tap its visible strip above the sheet (e.g. y=100), a drag-down closes it with `input swipe 540 230 540 2200 300`.
  `adb shell input text` types into a focused field directly, but cannot handle spaces or `%s` (use `ui.py type`). Check stored values with
  `tools/e2e/stack.sh psql -c "select title, notes from tasks"`.
- `uiautomator dump` lists views even when they are `importantForAccessibility="no-hide-descendants"`
  (it includes not-important views), so it cannot show TalkBack hiding; do not read it as a failure (2026-11-06).
- `configChanges`: the repo's `plugins/withConfigChanges.js` adds the size flags (screenSize,
  smallestScreenSize, screenLayout, orientation, ...) and deliberately keeps `density` OUT. Check after
  prebuild with `grep -o 'configChanges="[^"]*"' android/app/src/main/AndroidManifest.xml`. Test: with
  a sheet open and text typed, `wm size` below 600 dp and back and a rotation keep the same pid and the
  text; a `wm density` change recreates the activity (sheet reopens, typed quick-add text is lost) by
  design. Take the pid with `adb shell pidof <package>` before and after; run `adb shell wm size reset`
  and `adb shell wm density reset` afterwards (2026-11-06).
- Handling `density` in-process broke layout: `wm size 1600x2560; wm density 320`, then `wm size reset;
  wm density reset` back to back left the tab bar, FAB and header gear off screen (present in the dump,
  bounds outside the screen) until a cold start; a 1 s gap or the reverse order did not. Check bounds,
  not just presence, in dumps (2026-11-06).
- Long-press drag (reorder): `adb shell input swipe` cannot do it. Use
  `adb shell input motionevent DOWN x y`, hold ~900 ms (`sleep 0.9` in the same call), several
  stepped `MOVE x y` (`sleep 0.1` between), then `UP x y`. Verified 2026-11-06 on a phone and on a
  10 inch tablet (drag beside the rail, x well left of the row's action button): the DB `sort_order`
  followed the drop. Check the DB, not only the list order.
- Creating a project for a test: no `api.py` command. Use Browse, the `New project` row, tap
  `Project name`, `ui.py type`, then `keyevent 66` (2026-11-06).
- Parsing `ui.py list`: lines are `[x1,y1][x2,y2] ...`. Use `awk -F'[][,]' '{print $2,$3,$5,$6}'` (x1 y1 x2 y2);
  `$3` is y1, not `$4` (2026-11-06).
- Side sheet (landscape tablet, 560 dp): the scrim is the full-screen `desc='Close'` node and covers
  the list. `ui.py tap REGEX` matches the list row first, so the tap lands on the scrim and closes the
  sheet. Tap the sheet's own node by its bounds with `adb shell input tap X Y` (2026-11-06).
- Card width: the outer container of a centred card is the node to measure (288-1488 px = 600 dp at
  1600 px); the ScrollView inside is inset 20 dp each side (`space.s5`) and reads ~559 dp (2026-11-06).
- Language: change it in the app's Settings (the `Deutsch` row), not in the device locale. The tab
  labels then read German at once (2026-11-06).
- Font scale: `adb shell settings put system font_scale 2.0` resizes the rail live (rail 352 px = 176 dp,
  German labels one line each, no overlap; 2026-11-06). Once, a font-scale change killed the process
  (pid gone, `Process ... has died` in logcat): a JS error `The imperative router is unavailable before
  the first render` (`ReactNativeJS`) after the activity restarted. Not reproduced in two retries. After
  every setting change, check `adb shell pidof <package>` and keep `adb logcat -d > file` for the report.
- Date picker (Material): the day cell has `desc='20 November 2026'`, then `ui.py tap '^OK$'`. A
  reminder opens a time picker next (default 09:00): `OK` again. The field desc then reads
  `Erinnerung, 21. Nov. · 09:00`; the DB stores UTC `reminder_at`. Clear with the `..., Löschen` desc
  (2026-11-06; labels are German, use the EN desc when the UI is English).
- Attachment on a release build: `Anhang hinzufügen` opens a sheet with FOTO / DATEI. DATEI opens the
  system picker, whose Recent tab does not show files pushed with adb. Use `Show roots` then
  `Downloads` (push with `adb push <file> /sdcard/Download/`). The upload row appears in
  `attachments` (2026-11-06).
- `uiautomator dump` lists views even when they are `importantForAccessibility="no-hide-descendants"`
- Reminders: the notification permission is requested only from the Settings toggle, not
  when a reminder is set. Android delivers reminders as inexact alarms, observed up to
  ~2.5 min late: wait at least 3 min before calling a reminder missing (2026-11-05).

## 6. Layout checks (overlap / clipping)

For each screen and each device/orientation you were asked to cover:

1. Screenshot and look at it: nothing cut off at any edge, no text running out of its
   container, no element drawn over another, FAB and sheets clear of the nav bar.
2. `ui.py list --full` and compare bounds: every node's right edge <= screen width, no two
   interactive nodes overlap. A label at x beyond the screen width is a real bug (seen in
   TaskRow before, Yoga flexWrap).
3. Open the keyboard on input screens: the input stays visible above it.
4. Pixel diff against a baseline build (2026-11-06). Demo mode fixes the status bar so the clock does not differ: `adb shell settings put global sysui_demo_allowed 1`, then `am broadcast -a com.android.systemui.demo -e command enter` and `-e command clock -e hhmm 1000`, `battery`, `network`, `notifications -e visible false`; exit with `-e command exit`. Compare with `magick` after dropping alpha (`magick a.png -alpha off a2.png`), a difference composite, `-threshold 0` and `-format %[fx:mean*W*H]`. Plain `magick compare -metric AE` on RGBA PNGs returned counts above the pixel count here, so do not trust it. Check a second capture of the same screen against itself: a state still settling (a just-added row) can differ by a few thousand pixels that a repeat capture does not show.

## 7. Cleanup (always, also after a failure)

```sh
adb -s "$ANDROID_SERIAL" emu kill                    # only YOUR serial
kill <your Metro PID> 2>/dev/null
rm -rf ~/.android/avd/$ME.avd ~/.android/avd/$ME.ini
cd apps/mobile && git checkout package.json && rm -rf android .expo
tools/e2e/stack.sh down                              # if you started it
```

Never: `adb kill-server`, `adb emu kill` without `-s`, `./gradlew --stop`, `pkill java`,
`pkill emulator`, or an `rm` that contains an adb/SDK path.
