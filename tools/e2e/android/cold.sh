#!/bin/sh
# Cold-start the app, optionally on a deep link. Usage: cold.sh [--dev-client] [URL]
# Needs ANDROID_SERIAL (your own emulator). With --dev-client, taps the Metro entry
# if the Expo dev launcher shows.
set -eu
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to your own emulator (adb devices)}"
HERE=$(cd "$(dirname "$0")" && pwd)
PKG=${BALU_ANDROID_PACKAGE:-com.blaumedia.balutodo}
METRO_PORT=${METRO_PORT:-8081}
DEV=0
if [ "${1:-}" = "--dev-client" ]; then DEV=1; shift; fi
URL=${1:-}

adb -s "$ANDROID_SERIAL" shell am force-stop "$PKG"
if [ -n "$URL" ]; then
  case "$URL" in *"'"*) echo "URL must not contain a single quote" >&2; exit 2 ;; esac
  # single quotes keep ? and & away from the device shell
  adb -s "$ANDROID_SERIAL" shell "am start -a android.intent.action.VIEW -d '$URL' $PKG" >/dev/null 2>&1
else
  adb -s "$ANDROID_SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi
sleep 10
if [ "$DEV" = 1 ]; then
  if python3 "$HERE/ui.py" has "DEVELOPMENT SERVERS" | grep -qE "^count [1-9]"; then
    python3 "$HERE/ui.py" tap "^http://10.0.2.2:$METRO_PORT\$" >/dev/null
    sleep 15
  fi
fi
sleep 3
# No status-bar tap here: in an earlier run it moved focus to the launcher.
python3 "$HERE/ui.py" state
