#!/bin/sh
set -eu

chown -R clamav:clamav /var/lib/clamav

# Do not accept uploads until a real signature database has been obtained.
if ! find /var/lib/clamav -maxdepth 1 -type f \( -name '*.cvd' -o -name '*.cld' \) | grep -q .; then
  freshclam
fi

freshclam --daemon --foreground &
updater_pid=$!
clamd --foreground &
scanner_pid=$!

stop() {
  kill "$updater_pid" "$scanner_pid" 2>/dev/null || true
  wait "$updater_pid" "$scanner_pid" 2>/dev/null || true
}
trap stop INT TERM
wait "$scanner_pid"
stop
