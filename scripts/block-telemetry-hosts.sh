#!/bin/sh
# Blocks the hosts that receive nothing but telemetry from Claude Code and the Claude desktop app, by pointing
# them nowhere in the hosts file. Sign-in, the model API, Remote Control and auto-updates use other hosts.
# The hosts and what each one carries are listed in telemetry-hosts.txt next to this script.
#
#   sudo ./block-telemetry-hosts.sh              block the default hosts
#   sudo ./block-telemetry-hosts.sh --extended   also block the analytics hosts of the claude.ai pages
#   sudo ./block-telemetry-hosts.sh --remove     take all entries out again
#
# HOSTS_FILE names another file than /etc/hosts (used by the tests).
set -eu

hosts_file="${HOSTS_FILE:-/etc/hosts}"
list="$(dirname "$0")/telemetry-hosts.txt"
marker='# claude-privacy-guard'

wanted='default'
remove=''
for argument in "$@"; do
  case "$argument" in
    --extended) wanted='default extended' ;;
    --remove) remove='yes' ;;
    *) echo "Unknown option: $argument" >&2; exit 1 ;;
  esac
done

# The hosts of the wanted sections of telemetry-hosts.txt.
names="$(awk -v wanted="$wanted" '
  { sub(/#.*/, ""); gsub(/^[ \t]+|[ \t\r]+$/, "") }
  /^\[.*\]$/ { section = substr($0, 2, length($0) - 2); next }
  $0 != "" && index(" " wanted " ", " " section " ") { print }
' "$list")"

tmp="$(mktemp)"
grep -v -F "$marker" "$hosts_file" > "$tmp" || true
if [ -z "$remove" ]; then
  # Both address families, so that a lookup over IPv6 does not get past the entry.
  for name in $names; do
    printf '0.0.0.0 %s %s\n:: %s %s\n' "$name" "$marker" "$name" "$marker" >> "$tmp"
  done
fi
cat "$tmp" > "$hosts_file"
rm -f "$tmp"

if [ -n "$remove" ]; then echo 'Removed the entries.'; else echo "Blocked $(echo "$names" | wc -l | tr -d ' ') hosts: $(echo $names | sed 's/ /, /g')"; fi
