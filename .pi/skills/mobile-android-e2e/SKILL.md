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
`adb shell settings put system user_rotation 1` (0 portrait, 1 landscape). Check every screen
in both orientations.

## 4. Build and install (release APK, no Metro)

```sh
cd apps/mobile
npx expo prebuild --platform android                 # rewrites package.json, creates android/ and .expo/
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
  `balu`; pick a port no other local stack uses). Seed: `tools/e2e/api.py setup [--tasks N]`.
- Server URL in the app: `http://10.0.2.2:<port>`.
- Login: `tools/e2e/android/login.py ROLE` (password goes via stdin to the device shell). On
  a fresh install enter the server URL first, and on an `http://` server confirm "Continue
  without encryption" before the login form appears (2026-11-05).
- UI: `tools/e2e/android/ui.py list|tap|has|dump|swipe|scroll|state|type|desc`. Do not bypass
  `ui.py` for dumps (it masks password nodes). Never quote raw typed-text or log lines that
  could contain a password in a report.
- Screenshot: `adb exec-out screencap -p > /tmp/$ME-<name>.png`, then look at it.
  Right after a rotation or `wm size` change it can write an empty file: wait a moment and
  retry (2026-11-06).
- Avoid `%s` in quick-add text; use `ui.py type`.
- Long-press drag (reorder): `adb shell input swipe` cannot do it. Use
  `adb shell input motionevent DOWN x y`, hold ~900 ms, several stepped `MOVE x y`, then
  `UP x y` (2026-11-05).
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
