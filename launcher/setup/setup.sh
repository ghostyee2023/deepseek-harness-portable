#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="$(cd "$(dirname "$0")" && pwd)"
EXE="$DIST_DIR/dsh-web"
PLIST="$HOME/Library/LaunchAgents/com.deepseek.dsh-web.plist"
LABEL="com.deepseek.dsh-web"

desktop_launcher() {
  local target="$HOME/Desktop/DeepSeek Harness.command"
  cat > "$target" <<EOF
#!/usr/bin/env bash
cd "$DIST_DIR" && exec "$EXE" "\$@"
EOF
  chmod +x "$target"
  echo "[OK] Desktop launcher created: $target"
}

autostart() {
  if [ ! -x "$EXE" ]; then echo "[!!] $EXE not found - run build.sh first"; return; fi
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$EXE</string>
    <string>--open-mode</string><string>none</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "[OK] Auto-start enabled (launchd, service only)."
}

no_autostart() {
  if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "[OK] Auto-start removed."
  else
    echo "[..] No auto-start plist found."
  fi
}

start_now() {
  if [ ! -x "$EXE" ]; then echo "[!!] $EXE not found - run build.sh first"; return; fi
  nohup "$EXE" --open-mode none >/dev/null 2>&1 &
  echo "[OK] Service started in background."
}

stop_all() {
  pkill -f "$EXE" 2>/dev/null || true
  pkill -f "$DIST_DIR/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js" 2>/dev/null || true
  echo "[OK] DSH services stopped."
}

show_menu() {
  clear
  echo ""
  echo "  DeepSeek Harness - optional setup (macOS)"
  echo "  =========================================="
  echo ""
  echo "    1. Create desktop launcher (.command)"
  echo "    2. Enable auto-start (launchd, service only)"
  echo "    3. Disable auto-start"
  echo "    4. Start service now (background)"
  echo "    5. Stop all DSH services"
  echo "    0. Exit"
  echo ""
}

if [ "$#" -gt 0 ]; then
  case "$1" in
    desktop) desktop_launcher ;;
    autostart) autostart ;;
    no-autostart) no_autostart ;;
    start) start_now ;;
    stop) stop_all ;;
    *) echo "Unknown action: $1"; exit 1 ;;
  esac
  exit 0
fi

while true; do
  show_menu
  read -rp "  Choose an option: " choice
  case "$choice" in
    1) desktop_launcher ;;
    2) autostart ;;
    3) no_autostart ;;
    4) start_now ;;
    5) stop_all ;;
    0) echo "  Bye."; exit 0 ;;
    *) echo "  Invalid option." ;;
  esac
  echo ""
  read -rp "  Press Enter to continue" _
done
