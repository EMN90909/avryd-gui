#!/usr/bin/env bash
# ============================================================
#  AVRYD DESKTOP ENVIRONMENT — LINUX INSTALLER
#  Tested on: Debian 12, Ubuntu 22.04, AntiX 23, MX Linux 23
#  Run as root: sudo bash install.sh
#  Or run via GitHub import: bash <(curl -sL https://raw.githubusercontent.com/avryd/avryd-ui/main/install.sh)
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${CYAN}[AVRYD]${NC} $*"; }
ok()   { echo -e "${GREEN}[  OK ]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "Run as root: sudo bash install.sh"

INSTALL_DIR="/usr/share/avryd"
BIN_DIR="/usr/local/bin"
SESSION_DIR="/usr/share/xsessions"
AUTOSTART_DIR="/etc/xdg/autostart"
DESKTOP_DIR="/usr/share/applications"
WALLPAPER_DIR="$INSTALL_DIR/wallpapers"
THEME_DIR="/usr/share/themes/Avryd"
ICON_DIR="/usr/share/icons/Avryd"
LOG_DIR="/var/log/avryd"
CONFIG_DIR="/etc/avryd"
SYSTEMD_DIR="/etc/systemd/user"
LOCK_FILE="$INSTALL_DIR/.ui_locked"
VERSION_FILE="$INSTALL_DIR/version"
UPDATE_SERVER="https://ui-avryd.onrender.com"
WALLPAPER_REPO="https://github.com/avryd/avryd-wallpapers.git"
UI_REPO="https://github.com/avryd/avryd-ui.git"

log "Starting Avryd Desktop Environment installation..."

# ── System dependencies ───────────────────────────────────────────────────────
log "Installing system dependencies..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    openbox picom xorg xinit xterm \
    nodejs npm git curl wget \
    pulseaudio pavucontrol \
    network-manager network-manager-gnome \
    thunar thunar-archive-plugin \
    xfce4-terminal \
    mousepad \
    ristretto \
    parole \
    file-roller \
    xfce4-screenshooter \
    lxappearance \
    xcompmgr \
    dbus-x11 \
    jq \
    unzip \
    socat \
    inotify-tools \
    || fail "Dependency installation failed"
ok "System dependencies installed"

# ── Create directories ────────────────────────────────────────────────────────
log "Creating Avryd directories..."
mkdir -p "$INSTALL_DIR" "$WALLPAPER_DIR" "$THEME_DIR" "$ICON_DIR" \
         "$LOG_DIR" "$CONFIG_DIR" "$SYSTEMD_DIR" \
         "$SESSION_DIR" "$DESKTOP_DIR" \
         /var/run/avryd
ok "Directories created"

# ── Clone or update Avryd UI from GitHub ─────────────────────────────────────
log "Fetching Avryd UI from GitHub ($UI_REPO)..."
if [[ -d "$INSTALL_DIR/ui/.git" ]]; then
    log "UI already cloned, pulling latest..."
    git -C "$INSTALL_DIR/ui" pull origin main || log "Git pull failed, using existing"
else
    git clone --depth=1 "$UI_REPO" "$INSTALL_DIR/ui" || {
        log "GitHub not reachable, extracting bundled UI..."
        # Bundled fallback: extract from this installer's embedded tarball
        if [[ -f "$(dirname "$0")/avryd-ui-bundle.tar.gz" ]]; then
            mkdir -p "$INSTALL_DIR/ui"
            tar -xzf "$(dirname "$0")/avryd-ui-bundle.tar.gz" -C "$INSTALL_DIR/ui"
        else
            log "No bundle found, creating minimal UI skeleton..."
            mkdir -p "$INSTALL_DIR/ui/src"
        fi
    }
fi
ok "UI source ready at $INSTALL_DIR/ui"

# ── Build UI ──────────────────────────────────────────────────────────────────
if [[ -f "$INSTALL_DIR/ui/package.json" ]]; then
    log "Building Avryd UI (npm install + build)..."
    cd "$INSTALL_DIR/ui"
    npm install --silent
    npm run build --silent || log "Build step skipped (no build script)"
    cd -
    ok "UI built"
fi

# ── Clone wallpapers from avryd-wallpapers.git ───────────────────────────────
log "Fetching wallpapers from $WALLPAPER_REPO..."
if [[ -d "$WALLPAPER_DIR/.git" ]]; then
    git -C "$WALLPAPER_DIR" pull origin main || log "Wallpaper pull failed, using existing"
else
    git clone --depth=1 "$WALLPAPER_REPO" "$WALLPAPER_DIR" 2>/dev/null || {
        log "Wallpaper repo not reachable, using bundled stock wallpaper"
        # Copy bundled stock wallpaper
        if [[ -f "$(dirname "$0")/assets/stock.jpg" ]]; then
            cp "$(dirname "$0")/assets/stock.jpg" "$WALLPAPER_DIR/stock.jpg"
        fi
    }
fi
ok "Wallpapers ready at $WALLPAPER_DIR"

# ── Lock UI files after import ────────────────────────────────────────────────
# The UI is immutable once installed. Only the update system can replace files.
log "Locking UI files (chattr +i)..."
touch "$LOCK_FILE"
find "$INSTALL_DIR/ui" -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.html" -o -name "*.css" \) \
    -exec chattr +i {} \; 2>/dev/null || log "chattr not available on this FS, skipping lock"
echo "Avryd UI is locked. Use avryd-update to upgrade." > "$LOCK_FILE"
ok "UI files locked"

# ── Install avryd-daemon (Node.js local API server) ───────────────────────────
log "Installing avryd-daemon..."
cat > "$INSTALL_DIR/avryd-daemon.js" << 'DAEMON_EOF'
#!/usr/bin/env node
/**
 * AVRYD DAEMON — local REST API on port 7771
 * Bridges the Electron/React GUI to real Linux system calls.
 * Communicates via HTTP (localhost only) and Unix socket /run/avryd/daemon.sock
 */
const http = require('http');
const { execSync, exec, spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const net  = require('net');
const os   = require('os');

const PORT       = 7771;
const SOCK_PATH  = '/var/run/avryd/daemon.sock';
const LOG_FILE   = '/var/log/avryd/daemon.log';
const UPDATE_SERVER = process.env.AVRYD_UPDATE_SERVER || 'https://ui-avryd.onrender.com';
const VERSION_FILE  = '/usr/share/avryd/version';

const VERSION = fs.existsSync(VERSION_FILE) ? fs.readFileSync(VERSION_FILE, 'utf8').trim() : '1.0.0';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

function shell(cmd, opts = {}) {
  try { return execSync(cmd, { encoding: 'utf8', ...opts }).trim(); }
  catch (e) { return e.message; }
}

function bg(cmd) { exec(cmd, () => {}); }

// ── Route handlers ────────────────────────────────────────────────────────────
const routes = {
  'GET /api/version': () => ({ version: VERSION }),

  'GET /status': () => ({
    version: VERSION,
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    kernel: shell('uname -r'),
    cpu_model: shell("lscpu | grep 'Model name' | cut -d: -f2 | xargs"),
    gpu: shell("lspci 2>/dev/null | grep -i vga | head -1 | cut -d: -f3 | xargs"),
    display: process.env.DISPLAY || ':0',
    compositor: shell('pgrep -x picom && echo running || echo stopped'),
  }),

  'POST /launch': ({ cmd, sudo }) => {
    const full = sudo ? `pkexec ${cmd}` : `DISPLAY=:0 ${cmd}`;
    bg(full);
    log(`Launch: ${full}`);
    return { launched: true, cmd: full };
  },

  'POST /shell/restart': () => {
    log('Restarting Avryd shell...');
    bg('DISPLAY=:0 pkill -x openbox; sleep 1; DISPLAY=:0 openbox --restart');
    return { restarting: true };
  },

  'POST /compositor/restart': () => {
    log('Restarting compositor...');
    bg('pkill -x picom; sleep 0.5; DISPLAY=:0 picom --config /etc/avryd/picom.conf --daemon');
    return { restarting: true };
  },

  'POST /power/suspend':  () => { bg('systemctl suspend');           return { ok: true }; },
  'POST /power/reboot':   () => { bg('systemctl reboot');            return { ok: true }; },
  'POST /power/shutdown': () => { bg('systemctl poweroff');          return { ok: true }; },
  'POST /session/lock':   () => { bg('DISPLAY=:0 xsecurelock');      return { ok: true }; },
  'POST /session/logout': () => { bg('pkill -u $USER openbox');      return { ok: true }; },

  'POST /power/charge-limit': ({ limit }) => {
    // Works on machines with TLP or upower
    try { execSync(`echo ${limit} > /sys/class/power_supply/BAT0/charge_control_end_threshold`); }
    catch { shell(`tlp setcharge 0 ${limit} 2>/dev/null || true`); }
    return { limit };
  },

  'POST /audio/volume': ({ volume }) => {
    shell(`pactl set-sink-volume @DEFAULT_SINK@ ${volume}%`);
    return { volume };
  },
  'POST /audio/mute': ({ mute }) => {
    shell(`pactl set-sink-mute @DEFAULT_SINK@ ${mute ? '1' : '0'}`);
    return { muted: mute };
  },

  'POST /network/connect': ({ ssid }) => {
    bg(`nmcli device wifi connect "${ssid}"`);
    return { connecting: ssid };
  },

  'POST /bluetooth/toggle': ({ enabled }) => {
    shell(`rfkill ${enabled ? 'unblock' : 'block'} bluetooth`);
    return { enabled };
  },

  'GET /search': ({ q }) => {
    const apps  = shell(`find /usr/share/applications -name "*.desktop" | xargs grep -li "${q}" 2>/dev/null | head -5`);
    const files = shell(`locate -l 5 "${q}" 2>/dev/null || find /home -iname "*${q}*" -maxdepth 4 2>/dev/null | head -5`);
    const results = [
      ...apps.split('\n').filter(Boolean).map(p  => ({ type: 'app',  name: path.basename(p, '.desktop'), path: p })),
      ...files.split('\n').filter(Boolean).map(p => ({ type: 'file', name: path.basename(p),             path: p })),
    ];
    return { results };
  },

  'POST /files/open': ({ path: p }) => {
    bg(`DISPLAY=:0 xdg-open "${p}"`);
    return { opened: p };
  },

  'POST /wallpaper/set': ({ path: p }) => {
    shell(`DISPLAY=:0 feh --bg-scale "${p}"`);
    shell(`echo 'feh --bg-scale "${p}"' > ~/.fehbg`);
    return { wallpaper: p };
  },

  'POST /update/apply': () => {
    log('Applying update...');
    bg(`/usr/local/bin/avryd-update`);
    return { updating: true };
  },

  'GET /logs': () => {
    try { return { log: fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-100).join('\n') }; }
    catch { return { log: '' }; }
  },
};

// ── HTTP server ───────────────────────────────────────────────────────────────
function respond(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'http://localhost:3000',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { respond(res, {}); return; }

  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    const url    = new URL(req.url, 'http://localhost');
    const key    = `${req.method} ${url.pathname}`;
    const params = Object.fromEntries(url.searchParams);
    let   payload = {};

    try { if (body) payload = JSON.parse(body); } catch {}

    log(`${req.method} ${url.pathname}`);

    const handler = routes[key];
    if (handler) {
      try { respond(res, handler({ ...params, ...payload })); }
      catch (e) { respond(res, { error: e.message }, 500); }
    } else {
      respond(res, { error: 'Not found' }, 404);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => log(`avryd-daemon listening on 127.0.0.1:${PORT}`));

// ── Unix socket (IPC for terminal control) ────────────────────────────────────
if (fs.existsSync(SOCK_PATH)) fs.unlinkSync(SOCK_PATH);
const sockServer = net.createServer(socket => {
  socket.on('data', data => {
    const cmd = data.toString().trim();
    log(`IPC: ${cmd}`);
    socket.write(JSON.stringify({ ack: cmd }) + '\n');
    // Pass through to route table
    const [method, route, ...rest] = cmd.split(' ');
    const key = `${method} ${route}`;
    if (routes[key]) {
      try { socket.write(JSON.stringify(routes[key]({})) + '\n'); }
      catch (e) { socket.write(JSON.stringify({ error: e.message }) + '\n'); }
    }
  });
});
sockServer.listen(SOCK_PATH, () => {
  fs.chmodSync(SOCK_PATH, 0o770);
  log(`IPC socket ready at ${SOCK_PATH}`);
});

process.on('SIGTERM', () => { log('Daemon shutting down'); process.exit(0); });
process.on('uncaughtException', e => log(`Uncaught: ${e.message}`));
DAEMON_EOF
chmod +x "$INSTALL_DIR/avryd-daemon.js"

# Install node deps for daemon
cd "$INSTALL_DIR"
cat > package.json << 'PKG'
{ "name": "avryd-daemon", "version": "1.0.0", "main": "avryd-daemon.js" }
PKG
npm install --silent 2>/dev/null || true
ok "avryd-daemon installed"

# ── Install CLI tools ─────────────────────────────────────────────────────────
log "Installing CLI tools..."

# avryd-launch — launch apps from terminal
cat > "$BIN_DIR/avryd-launch" << 'EOF'
#!/usr/bin/env bash
# Usage: avryd-launch <app|command>
# Sends launch request to avryd-daemon via IPC socket
APP="$*"
if [[ -z "$APP" ]]; then echo "Usage: avryd-launch <app>"; exit 1; fi

# Try daemon API first
curl -sf -X POST http://localhost:7771/launch \
  -H 'Content-Type: application/json' \
  -d "{\"cmd\": \"$APP\"}" > /dev/null 2>&1 && echo "Launched: $APP" && exit 0

# Fallback: direct exec
DISPLAY=:0 $APP &
echo "Launched (direct): $APP"
EOF
chmod +x "$BIN_DIR/avryd-launch"

# avryd-restart — restart shell components
cat > "$BIN_DIR/avryd-restart" << 'EOF'
#!/usr/bin/env bash
TARGET="${1:-shell}"
case "$TARGET" in
  shell)      curl -sf -X POST http://localhost:7771/shell/restart | jq . ;;
  compositor) curl -sf -X POST http://localhost:7771/compositor/restart | jq . ;;
  daemon)     systemctl --user restart avryd-daemon ;;
  *)          echo "Usage: avryd-restart [shell|compositor|daemon]" ;;
esac
EOF
chmod +x "$BIN_DIR/avryd-restart"

# avryd-status — system status
cat > "$BIN_DIR/avryd-status" << 'EOF'
#!/usr/bin/env bash
curl -sf http://localhost:7771/status | jq .
EOF
chmod +x "$BIN_DIR/avryd-status"

# avryd-logs — view daemon logs
cat > "$BIN_DIR/avryd-logs" << 'EOF'
#!/usr/bin/env bash
tail -f /var/log/avryd/daemon.log
EOF
chmod +x "$BIN_DIR/avryd-logs"

# avryd-update — update from server
cat > "$BIN_DIR/avryd-update" << 'UPDATEEOF'
#!/usr/bin/env bash
# ── Avryd Update Script ────────────────────────────────────────────────────
# Downloads latest UI from ui-avryd.onrender.com and applies it.
# UI files are unlocked, replaced, then re-locked.

set -euo pipefail

UPDATE_SERVER="https://ui-avryd.onrender.com"
INSTALL_DIR="/usr/share/avryd"
LOCK_FILE="$INSTALL_DIR/.ui_locked"
VERSION_FILE="$INSTALL_DIR/version"
TMP_DIR=$(mktemp -d)

echo "[avryd-update] Checking for updates from $UPDATE_SERVER..."
LATEST=$(curl -sf "$UPDATE_SERVER/api/version" | jq -r '.version') || {
  echo "[avryd-update] Cannot reach update server"; exit 1
}
CURRENT=$(cat "$VERSION_FILE" 2>/dev/null || echo "0.0.0")

if [[ "$LATEST" == "$CURRENT" ]]; then
  echo "[avryd-update] Already up to date ($CURRENT)"; exit 0
fi

echo "[avryd-update] Updating $CURRENT -> $LATEST..."

# Unlock UI files
find "$INSTALL_DIR/ui" -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.html" \) \
  -exec chattr -i {} \; 2>/dev/null || true

# Download update bundle
curl -sf "$UPDATE_SERVER/api/bundle" -o "$TMP_DIR/update.tar.gz" || {
  echo "[avryd-update] Download failed"; exit 1
}

# Extract & apply
tar -xzf "$TMP_DIR/update.tar.gz" -C "$INSTALL_DIR/ui" --strip-components=1
echo "$LATEST" > "$VERSION_FILE"

# Rebuild if needed
if [[ -f "$INSTALL_DIR/ui/package.json" ]]; then
  cd "$INSTALL_DIR/ui" && npm run build --silent 2>/dev/null || true
fi

# Re-lock files
find "$INSTALL_DIR/ui" -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.html" \) \
  -exec chattr +i {} \; 2>/dev/null || true
echo "Avryd UI $LATEST applied and locked." > "$LOCK_FILE"

# Restart shell
curl -sf -X POST http://localhost:7771/shell/restart > /dev/null 2>&1 || \
  DISPLAY=:0 pkill -x openbox && sleep 1 && DISPLAY=:0 openbox --restart &

echo "[avryd-update] Done. Running version: $LATEST"
rm -rf "$TMP_DIR"
UPDATEEOF
chmod +x "$BIN_DIR/avryd-update"

# avryd-wallpaper-sync — sync from avryd-wallpapers.git
cat > "$BIN_DIR/avryd-wallpaper-sync" << 'EOF'
#!/usr/bin/env bash
WALLPAPER_DIR="/usr/share/avryd/wallpapers"
REPO="https://github.com/avryd/avryd-wallpapers.git"
if [[ -d "$WALLPAPER_DIR/.git" ]]; then
  echo "Pulling latest wallpapers..."
  git -C "$WALLPAPER_DIR" pull origin main
else
  echo "Cloning wallpaper repository..."
  git clone --depth=1 "$REPO" "$WALLPAPER_DIR"
fi
echo "Wallpapers synced to $WALLPAPER_DIR"
ls "$WALLPAPER_DIR"/*.{jpg,png,webp} 2>/dev/null | wc -l && echo "wallpapers found"
EOF
chmod +x "$BIN_DIR/avryd-wallpaper-sync"

ok "CLI tools installed"

# ── Picom compositor config ───────────────────────────────────────────────────
log "Writing compositor config..."
cat > "$CONFIG_DIR/picom.conf" << 'EOF'
# Avryd Compositor Configuration (picom)
backend         = "glx";          # GPU-accelerated; falls back to "xrender"
vsync           = true;
unredir-if-possible = true;

# Shadows
shadow          = true;
shadow-radius   = 18;
shadow-offset-x = -8;
shadow-offset-y = -8;
shadow-opacity  = 0.25;
shadow-exclude  = [ "class_g = 'avryd-panel'" ];

# Fading
fading          = true;
fade-in-step    = 0.04;
fade-out-step   = 0.04;
fade-delta      = 5;

# Transparency
active-opacity   = 1.0;
inactive-opacity = 0.92;
frame-opacity    = 0.9;
opacity-rule     = [
  "95:class_g = 'avryd-terminal'",
  "100:class_g = 'avryd-shell'",
];

# Blur (requires picom jonaburg or pijulius fork)
blur-background        = true;
blur-background-frame  = true;
blur-method            = "dual_kawase";
blur-strength          = 5;
blur-background-exclude = [ "window_type = 'dock'" ];

# Rounded corners
corner-radius   = 12;
rounded-corners-exclude = [ "window_type = 'dock'" ];
EOF
ok "Compositor config written"

# ── Openbox config ────────────────────────────────────────────────────────────
log "Writing Openbox (WM) config..."
mkdir -p /etc/avryd/openbox
cat > /etc/avryd/openbox/rc.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme>
    <name>Avryd</name>
    <titleLayout>NLIMC</titleLayout>
    <keepBorder>yes</keepBorder>
    <animateIconify>yes</animateIconify>
    <font place="ActiveWindow"><name>monospace</name><size>9</size><weight>Bold</weight></font>
  </theme>
  <desktops><number>4</number><firstdesk>1</firstdesk></desktops>
  <keyboard>
    <keybind key="Super_L"><action name="ShowMenu"><menu>avryd-launcher</menu></action></keybind>
    <keybind key="Super-e"><action name="Execute"><execute>avryd-launch files</execute></action></keybind>
    <keybind key="Super-t"><action name="Execute"><execute>avryd-launch terminal</execute></action></keybind>
    <keybind key="Super-l"><action name="Execute"><execute>avryd-launch lockscreen</execute></action></keybind>
    <keybind key="Super-r"><action name="Execute"><execute>avryd-restart shell</execute></action></keybind>
    <keybind key="A-F4"><action name="Close"/></keybind>
    <keybind key="A-Tab"><action name="NextWindow"/></keybind>
    <keybind key="Super-Left"><action name="SnapLeft"/></keybind>
    <keybind key="Super-Right"><action name="SnapRight"/></keybind>
    <keybind key="Super-Up"><action name="Maximize"/></keybind>
    <keybind key="Super-Down"><action name="Iconify"/></keybind>
  </keyboard>
  <mouse>
    <dragThreshold>8</dragThreshold>
    <context name="Desktop">
      <mousebind button="Right" action="Press">
        <action name="ShowMenu"><menu>avryd-desktop-menu</menu></action>
      </mousebind>
    </context>
  </mouse>
  <applications>
    <application class="*">
      <decor>yes</decor>
      <focus>yes</focus>
    </application>
  </applications>
</openbox_config>
EOF
ok "Openbox config written"

# ── Session startup script ────────────────────────────────────────────────────
log "Writing session startup script..."
cat > "$BIN_DIR/avryd-session" << 'EOF'
#!/usr/bin/env bash
# ── AVRYD SESSION STARTUP ──────────────────────────────────────────────────
# Called by .xinitrc or the xsessions entry.
# Starts all Avryd components in the correct order.

export DISPLAY="${DISPLAY:-:0}"
export XDG_SESSION_TYPE="x11"
export XDG_CURRENT_DESKTOP="Avryd"

LOG="/var/log/avryd/session.log"
exec >> "$LOG" 2>&1

echo "=== Avryd Session Start $(date) ==="

# ── 1. Quasar performance manager ──────────────────────────────────────────
/usr/share/avryd/quasar.sh &
QUASAR_PID=$!
echo "Quasar PID: $QUASAR_PID"

# ── 2. D-Bus session (if not already running) ──────────────────────────────
if [[ -z "$DBUS_SESSION_BUS_ADDRESS" ]]; then
    eval "$(dbus-launch --sh-syntax)"
fi

# ── 3. avryd-daemon (local API) ────────────────────────────────────────────
node /usr/share/avryd/avryd-daemon.js &
DAEMON_PID=$!
echo "Daemon PID: $DAEMON_PID"
sleep 0.5

# ── 4. Compositor ──────────────────────────────────────────────────────────
picom --config /etc/avryd/picom.conf --daemon &
echo "Compositor started"

# ── 5. Set stock wallpaper ─────────────────────────────────────────────────
if command -v feh &>/dev/null; then
    STOCK_WALL="/usr/share/avryd/wallpapers/stock.jpg"
    [[ -f "$STOCK_WALL" ]] && feh --bg-scale "$STOCK_WALL"
    [[ -f ~/.fehbg ]] && bash ~/.fehbg
fi

# ── 6. Notification daemon ─────────────────────────────────────────────────
command -v dunst &>/dev/null && dunst &

# ── 7. Clipboard manager ───────────────────────────────────────────────────
command -v xclipd &>/dev/null && xclipd &

# ── 8. NetworkManager applet ───────────────────────────────────────────────
command -v nm-applet &>/dev/null && nm-applet &

# ── 9. Start Avryd Shell (Electron or fallback) ────────────────────────────
if command -v electron &>/dev/null && [[ -f /usr/share/avryd/ui/main.js ]]; then
    electron /usr/share/avryd/ui &
    SHELL_PID=$!
elif command -v chromium-browser &>/dev/null; then
    chromium-browser --app=file:///usr/share/avryd/ui/index.html \
        --no-sandbox --kiosk --disable-web-security &
    SHELL_PID=$!
elif command -v firefox-esr &>/dev/null; then
    firefox-esr --kiosk "file:///usr/share/avryd/ui/index.html" &
    SHELL_PID=$!
fi
echo "Shell PID: $SHELL_PID"

# ── 10. Window manager (Openbox) ───────────────────────────────────────────
openbox --config-file /etc/avryd/openbox/rc.xml &
WM_PID=$!
echo "WM PID: $WM_PID"

# ── 11. Check for updates in background ────────────────────────────────────
(sleep 10 && avryd-update-check) &

# ── Wait on WM; if it exits, clean up ──────────────────────────────────────
wait $WM_PID

echo "=== Avryd Session End $(date) ==="
kill $DAEMON_PID $QUASAR_PID $SHELL_PID 2>/dev/null || true
EOF
chmod +x "$BIN_DIR/avryd-session"

# ── Quasar performance manager ────────────────────────────────────────────────
log "Installing Quasar performance manager..."
cat > "$INSTALL_DIR/quasar.sh" << 'EOF'
#!/usr/bin/env bash
# AVRYD QUASAR — performance and resource controller
# Runs in background, adjusts system behavior based on RAM/CPU pressure.

LOG="/var/log/avryd/quasar.log"
exec >> "$LOG" 2>&1

log() { echo "[QUASAR $(date +%H:%M:%S)] $*"; }
log "Quasar starting..."

# Enable zram if available
if command -v zramctl &>/dev/null && [[ ! -b /dev/zram0 ]]; then
    modprobe zram 2>/dev/null || true
    TOTAL_RAM=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    ZRAM_SIZE=$(( TOTAL_RAM / 2 ))
    echo "${ZRAM_SIZE}K" > /sys/block/zram0/disksize 2>/dev/null || true
    mkswap /dev/zram0 2>/dev/null && swapon /dev/zram0 2>/dev/null || true
    log "zram enabled: ${ZRAM_SIZE}K"
fi

# Performance control loop
while true; do
    RAM_FREE=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    CPU_IDLE=$(vmstat 1 1 | tail -1 | awk '{print $15}')
    RAM_FREE_MB=$(( RAM_FREE / 1024 ))

    # LOW MEMORY MODE: < 200MB free
    if (( RAM_FREE_MB < 200 )); then
        log "LOW MEMORY ($RAM_FREE_MB MB free) — activating Quasar low-end mode"
        # Drop caches
        echo 1 > /proc/sys/vm/drop_caches 2>/dev/null || true
        # Kill non-critical background services
        pkill -f "tracker-" 2>/dev/null || true
        pkill -f "evolution-" 2>/dev/null || true
        # Tell daemon to reduce animations
        curl -sf -X POST http://localhost:7771/quasar/low-memory >/dev/null 2>&1 || true
    fi

    # HIGH CPU: < 10% idle
    if (( CPU_IDLE < 10 )); then
        log "HIGH CPU — throttling background tasks"
        # Lower ionice on non-critical processes
        ionice -c 3 -p $(pgrep -d, -f "tracker") 2>/dev/null || true
    fi

    sleep 15
done
EOF
chmod +x "$INSTALL_DIR/quasar.sh"

# ── systemd user service ──────────────────────────────────────────────────────
log "Installing systemd user service..."
cat > "$SYSTEMD_DIR/avryd-daemon.service" << 'EOF'
[Unit]
Description=Avryd Desktop Daemon
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/share/avryd/avryd-daemon.js
Restart=always
RestartSec=2
StandardOutput=append:/var/log/avryd/daemon.log
StandardError=append:/var/log/avryd/daemon.log
Environment=DISPLAY=:0

[Install]
WantedBy=default.target
EOF

# ── xsessions entry ───────────────────────────────────────────────────────────
log "Writing xsessions entry..."
cat > "$SESSION_DIR/avryd.desktop" << 'EOF'
[Desktop Entry]
Name=Avryd Desktop
Comment=Avryd Desktop Environment
Exec=/usr/local/bin/avryd-session
TryExec=/usr/local/bin/avryd-session
Type=XSession
DesktopNames=Avryd
EOF
ok "xsessions entry written"

# ── .xinitrc for startx ───────────────────────────────────────────────────────
log "Writing ~/.xinitrc..."
cat > /etc/skel/.xinitrc << 'EOF'
#!/bin/bash
exec /usr/local/bin/avryd-session
EOF
[[ -f ~/.xinitrc ]] || cp /etc/skel/.xinitrc ~/.xinitrc
ok ".xinitrc written"

# ── Desktop .desktop files for apps ──────────────────────────────────────────
log "Writing .desktop entries..."
declare -A APP_CMDS=(
  ["avryd-browser"]="xdg-open https://"
  ["avryd-files"]="thunar"
  ["avryd-terminal"]="xfce4-terminal"
  ["avryd-settings"]="xfce4-settings-manager"
  ["avryd-editor"]="mousepad"
  ["avryd-photos"]="ristretto"
  ["avryd-music"]="parole --audio"
  ["avryd-video"]="parole"
  ["avryd-archive"]="file-roller"
  ["avryd-screenshot"]="xfce4-screenshooter"
  ["avryd-monitor"]="xfce4-taskmanager"
)

for APP in "${!APP_CMDS[@]}"; do
  NAME=$(echo "${APP/avryd-/}" | sed 's/\b./\u&/g')
  cat > "$DESKTOP_DIR/${APP}.desktop" << DEOF
[Desktop Entry]
Name=${NAME}
Exec=${APP_CMDS[$APP]}
Icon=applications-${NAME,,}
Type=Application
Categories=Avryd;
DEOF
done
ok ".desktop files written"

# ── Version file ──────────────────────────────────────────────────────────────
echo "1.0.0" > "$VERSION_FILE"

# ── Fix permissions ───────────────────────────────────────────────────────────
chown -R root:root "$INSTALL_DIR"
chmod -R 755 "$INSTALL_DIR"
chmod 644 "$VERSION_FILE" "$LOCK_FILE" 2>/dev/null || true

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        AVRYD INSTALLATION COMPLETE       ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Start with:      ${CYAN}startx${NC}  or choose 'Avryd' at login"
echo -e "  Or run:          ${CYAN}avryd-session${NC}"
echo -e "  CLI launch:      ${CYAN}avryd-launch <app>${NC}"
echo -e "  Restart shell:   ${CYAN}avryd-restart shell${NC}"
echo -e "  Check updates:   ${CYAN}avryd-update${NC}"
echo -e "  Sync wallpapers: ${CYAN}avryd-wallpaper-sync${NC}"
echo -e "  View logs:       ${CYAN}avryd-logs${NC}"
echo ""
echo -e "  UI locked at: ${CYAN}$INSTALL_DIR/ui${NC}"
echo -e "  Update server: ${CYAN}$UPDATE_SERVER${NC}"
echo -e "  Wallpaper repo: ${CYAN}$WALLPAPER_REPO${NC}"
echo ""
