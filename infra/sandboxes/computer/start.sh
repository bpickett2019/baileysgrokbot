#!/usr/bin/env bash
set -uo pipefail
export DISPLAY="${DISPLAY:-:1}"
export HOME="${HOME:-/home/rakazo}"
AGENT_HOME="$HOME"
mkdir -p "$AGENT_HOME" "$AGENT_HOME/.local/bin" "$AGENT_HOME/.config" /tmp/rakazo /tmp/.X11-unix /tmp/fluxbox-home
# Login shells re-apply ~/.local/bin from /etc/profile.d/rakazo-local-bin.sh.
export PATH="$AGENT_HOME/.local/bin:/usr/local/bin:$PATH"
export NPM_CONFIG_PREFIX="$AGENT_HOME/.local"
export PIP_USER=1
cd "$AGENT_HOME"

# This script is PID 1. Without a handler, PID 1 ignores SIGTERM and `docker stop` waits its
# full grace period before killing the container, so every stop, sleep and computer switch
# took ten seconds. Install the handler before any child starts so a stop during startup is
# honoured too: forward the signal to the desktop processes and exit promptly.
XVFB_PID=""
shutdown() {
  trap - TERM INT
  if [[ -n "$XVFB_PID" ]]; then
    kill -TERM "$XVFB_PID" 2>/dev/null || true
  fi
  kill -TERM -- -1 2>/dev/null || true
  if [[ -n "$XVFB_PID" ]]; then
    wait "$XVFB_PID" 2>/dev/null || true
  fi
  exit 0
}
trap shutdown TERM INT

# Host-run supervisors preserve the host uid/gid for bind-mounted homes. On macOS
# (and custom Linux users) that uid may not exist in the image's passwd database.
# D-Bus needs a resolvable identity. Supply one to our children without becoming
# root, changing /etc/passwd, or changing ownership of the mounted home.
computer_uid="$(id -u)"
computer_gid="$(id -g)"
if ! getent passwd "$computer_uid" >/dev/null; then
  nss_wrapper=""
  for library in /usr/lib/*/libnss_wrapper.so /usr/lib/libnss_wrapper.so; do
    if [[ -f "$library" ]]; then
      nss_wrapper="$library"
      break
    fi
  done
  if [[ -z "$nss_wrapper" ]]; then
    echo "libnss_wrapper is required for computer uid $computer_uid" >&2
    exit 1
  fi
  identity_dir="$(mktemp -d /tmp/rakazo/identity.XXXXXX)" || exit 1
  awk -F: '$1 != "rakazo"' /etc/passwd > "$identity_dir/passwd"
  printf 'rakazo:x:%s:%s:Rakazo:%s:/bin/bash\n' "$computer_uid" "$computer_gid" "$AGENT_HOME" \
    >> "$identity_dir/passwd"
  awk -F: -v gid="$computer_gid" '$1 != "rakazo" && $3 != gid' /etc/group > "$identity_dir/group"
  printf 'rakazo:x:%s:\n' "$computer_gid" >> "$identity_dir/group"
  export NSS_WRAPPER_PASSWD="$identity_dir/passwd"
  export NSS_WRAPPER_GROUP="$identity_dir/group"
  export LD_PRELOAD="$nss_wrapper${LD_PRELOAD:+:$LD_PRELOAD}"
  export USER=rakazo LOGNAME=rakazo
fi

if [[ -n "${RAKAZO_COMPUTER_CONTROL_TOKEN:-}" ]]; then
  /usr/local/bin/rakazo-computer-control >/tmp/rakazo/control.log 2>&1 &
fi

rm -f /tmp/.X1-lock /tmp/.X11-unix/X1

Xvfb :1 -screen 0 1280x800x24 -ac +extension RANDR +render -noreset >/tmp/rakazo/xvfb.log 2>&1 &
XVFB_PID=$!

ready=0
for _ in $(seq 1 100); do
  if xdpyinfo -display :1 >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "Xvfb failed to start" >&2
  cat /tmp/rakazo/xvfb.log >&2 || true
  exit 1
fi

if command -v dbus-launch >/dev/null 2>&1; then
  if ! dbus_environment="$(dbus-launch --sh-syntax)"; then
    echo "Failed to start the desktop D-Bus session" >&2
    exit 1
  fi
  eval "$dbus_environment"
  if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
    echo "D-Bus did not provide a session address" >&2
    exit 1
  fi
  # rakazo-browser is launched later without this session's environment; the
  # file-chooser portals only work if the browser finds the same bus.
  printf 'export DBUS_SESSION_BUS_ADDRESS=%s\n' "$DBUS_SESSION_BUS_ADDRESS" \
    > /tmp/rakazo/dbus-session
fi

# Chromium's file chooser talks to xdg-desktop-portal over the session bus.
# Without a running portal backend, the select-file dialog opens but the
# chosen file never reaches the page — uploads silently do nothing. The
# daemons install as flat files in /usr/libexec on Debian bookworm.
if [ -x /usr/libexec/xdg-desktop-portal ] && [ -x /usr/libexec/xdg-desktop-portal-gtk ]; then
  /usr/libexec/xdg-desktop-portal >/tmp/rakazo/portal.log 2>&1 &
  /usr/libexec/xdg-desktop-portal-gtk >/tmp/rakazo/portal-gtk.log 2>&1 &
fi

xsetroot -solid "#111113" >/dev/null 2>&1 || true
mkdir -p /tmp/fluxbox-home/.fluxbox
cp /etc/rakazo/fluxbox/init /tmp/fluxbox-home/.fluxbox/init
cp /etc/rakazo/fluxbox/apps /tmp/fluxbox-home/.fluxbox/apps 2>/dev/null || true
cp /etc/rakazo/fluxbox/menu /tmp/fluxbox-home/.fluxbox/menu 2>/dev/null || true
cat > /tmp/fluxbox-home/.fluxbox/startup <<'EOF'
#!/bin/sh
xsetroot -solid "#111113"
exec fluxbox -rc /tmp/fluxbox-home/.fluxbox/init
EOF
chmod +x /tmp/fluxbox-home/.fluxbox/startup
HOME=/tmp/fluxbox-home /tmp/fluxbox-home/.fluxbox/startup >/tmp/rakazo/fluxbox.log 2>&1 &

register_browser_handler() {
  local mime="$1"
  if ! xdg-mime default rakazo-browser.desktop "$mime" >/dev/null 2>&1 \
    || [[ "$(xdg-mime query default "$mime" 2>/dev/null || true)" != "rakazo-browser.desktop" ]]; then
    echo "failed to register rakazo-browser for $mime" >&2
    exit 1
  fi
}
register_browser_handler x-scheme-handler/http
register_browser_handler x-scheme-handler/https
register_browser_handler text/html
if ! xdg-settings set default-web-browser rakazo-browser.desktop >/dev/null 2>&1 \
  || [[ "$(xdg-settings get default-web-browser 2>/dev/null || true)" != "rakazo-browser.desktop" ]]; then
  echo "failed to set default web browser to rakazo-browser" >&2
  exit 1
fi

x11vnc -display :1 -forever -shared -viewonly -nopw -listen 127.0.0.1 -rfbport 5900 -xkb -ncache 0 >/tmp/rakazo/x11vnc.log 2>&1 &

NOVNC_ROOT=/usr/share/novnc
if [[ ! -d "$NOVNC_ROOT" ]]; then
  echo "noVNC is missing from the computer image" >&2
  exit 1
fi
if [[ ! -f "$NOVNC_ROOT/embed.html" ]]; then
  echo "noVNC embed.html is missing from the computer image" >&2
  exit 1
fi
if [[ ! -f "$NOVNC_ROOT/clipboard-bridge.js" ]]; then
  echo "noVNC clipboard-bridge.js is missing from the computer image" >&2
  exit 1
fi
if [[ ! -f "$NOVNC_ROOT/mobile-keyboard.js" ]]; then
  echo "noVNC mobile-keyboard.js is missing from the computer image" >&2
  exit 1
fi
websockify --heartbeat=30 --web="$NOVNC_ROOT" --token-plugin=TokenFile --token-source=/tmp/rakazo/view-target-1 0.0.0.0:6080 >/tmp/rakazo/novnc.log 2>&1 &

wait "$XVFB_PID"
echo "Xvfb exited" >&2
exit 1
