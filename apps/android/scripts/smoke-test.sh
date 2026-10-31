#!/usr/bin/env bash
# Runs inside the Android emulator job (.github/workflows/android.yml): installs
# the APK, opens it, and checks it reaches the Hub started on the runner
# (10.0.2.2 is the runner, seen from the emulator). Screenshots go to
# screenshots/ for the artifact.
set -euo pipefail
APK="$1"
HUB_LOG="$2"
PKG=app.restroos.client
mkdir -p screenshots
shot() { adb exec-out screencap -p > "screenshots/$1.png"; }

adb install -r "$APK"
# First run: the app asks for the Hub's address.
adb shell am start -W -n "$PKG/.MainActivity"
sleep 8
shot 1-connect
adb shell am force-stop "$PKG"

# Given the address, it opens the Hub's own web app (a new Hub: the setup
# wizard), whose first call is the setup status.
adb shell am start -W -n "$PKG/.MainActivity" -e hubURL http://10.0.2.2:7400
for _ in $(seq 1 60); do
  if grep -q '"url":"/api/v1/setup/status' "$HUB_LOG"; then break; fi
  sleep 2
done
sleep 10
shot 2-hub
if ! grep -q '"url":"/api/v1/setup/status' "$HUB_LOG"; then
  echo "::error title=Smoke test::the app never opened the Hub's web app"
  adb logcat -d -t 200 | grep -iE "restroos|chromium|AndroidRuntime" | tail -60 || true
  tail -40 "$HUB_LOG"
  exit 1
fi
# The app is still running (no crash on load).
adb shell pidof "$PKG" > /dev/null || { echo "::error title=Smoke test::the app crashed"; adb logcat -d -t 200 | tail -80; exit 1; }
echo "The app called the Hub:"
grep -o '"url":"[^"]*"' "$HUB_LOG" | sort | uniq -c | head -20
