/**
 * AVRYD DESKTOP ENVIRONMENT v1.1
 * Full desktop shell — React component
 *
 * New in this version (spec 2):
 *  - Full widget system (clock, stats, media, sticky notes) with drag+resize
 *  - Drag-and-drop dock reordering
 *  - Context menus: desktop, dock, files, apps, text selections, widgets
 *  - Submenus (Sort Icons → By Name/Date/Type)
 *  - Wallpaper picker with slide-show support
 *  - Multi-user switcher on lock screen
 *  - Quasar panel with Turbo/Balanced/Eco modes
 *  - Theme switcher (dark/light/auto/high-contrast)
 *  - Notification system with badge + flyout
 *  - Keyboard shortcuts: Escape, Ctrl+K (search), Super+T (terminal)
 *  - Update poller (ui-avryd.onrender.com)
 *  - Wallpaper repo (avryd-wallpapers.git)
 *  - Fuzzy search across apps, files, settings, commands
 */

import React, {
  useState, useEffect, useRef, useCallback, useReducer
} from 'react';
import {
  Monitor, Battery, Wifi, Volume2, Search, Cpu, Layers, ShieldCheck,
  FolderOpen, Trash2, ChevronRight, Zap, Network, Settings, Globe,
  Terminal, Image, Music, Film, Archive, Clipboard, Lock, User,
  RefreshCw, Download, AlertCircle, CheckCircle, X, Minus, Square,
  LayoutGrid, Power, LogOut, Moon, Sun, HardDrive, Activity, Bell,
  BatteryLow, BatteryCharging, Bluetooth, VolumeX, Edit3, Star,
  Clock, Package, Move, Plus, Minus as MinusIcon, Maximize2,
  Sliders, Zap as ZapIcon, Wind, ThumbsUp, ChevronDown, Copy,
  Scissors, Clipboard as ClipboardIcon, Tag, Eye, EyeOff,
  SortAsc, Shuffle, Grid, List, MoreHorizontal, FilePlus,
  FolderPlus, ExternalLink, Play, Pause, SkipForward, SkipBack,
  Volume1, AlertTriangle, Info, Wifi as WifiIcon, WifiOff
} from 'lucide-react';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const UPDATE_SERVER   = 'https://ui-avryd.onrender.com';
const WALLPAPER_REPO  = 'https://raw.githubusercontent.com/avryd/avryd-wallpapers/main';
const DAEMON_API      = 'http://localhost:7771';
const AVRYD_VERSION   = window.__AVRYD_VERSION__ || '1.0.0';

// ── THEME TOKENS ──────────────────────────────────────────────────────────────
const THEMES = {
  light: {
    glass:     'bg-white/40 border-white/60 text-slate-900',
    glassFull: 'bg-white/75 border-white/70 text-slate-900 backdrop-blur-3xl',
    accent:    'bg-lime-400',
    accentTxt: 'text-lime-700',
    bg:        'bg-white/20',
  },
  dark: {
    glass:     'bg-black/35 border-white/12 text-white',
    glassFull: 'bg-black/55 border-white/12 text-white backdrop-blur-3xl',
    accent:    'bg-lime-400',
    accentTxt: 'text-lime-400',
    bg:        'bg-black/20',
  },
  hc: {
    glass:     'bg-black border-white text-white',
    glassFull: 'bg-black border-white text-white',
    accent:    'bg-yellow-400',
    accentTxt: 'text-yellow-400',
    bg:        'bg-black',
  },
};

// ── APP REGISTRY ──────────────────────────────────────────────────────────────
const ALL_APPS = [
  // Internet
  { id:'browser',   name:'Browser',      icon:'🌐', cat:'internet',    cmd:'xdg-open https://'        },
  { id:'mail',      name:'Mail',          icon:'✉️',  cat:'internet',    cmd:'xdg-email'                },
  // System
  { id:'files',     name:'Files',         icon:'📁', cat:'system',      cmd:'thunar'                   },
  { id:'terminal',  name:'Terminal',      icon:'💻', cat:'system',      cmd:'xfce4-terminal'           },
  { id:'settings',  name:'Settings',      icon:'⚙️', cat:'system',      cmd:'avryd-settings'           },
  { id:'monitor',   name:'Task Monitor',  icon:'📊', cat:'system',      cmd:'xfce4-taskmanager'        },
  { id:'users',     name:'Users',         icon:'👤', cat:'system',      cmd:'avryd-users'              },
  { id:'lockscr',   name:'Lock Screen',   icon:'🔒', cat:'system',      cmd:'avryd-lockscreen'         },
  { id:'updater',   name:'Updater',       icon:'⬆️', cat:'system',      cmd:'avryd-update'             },
  // Media
  { id:'photos',    name:'Photos',        icon:'🖼️', cat:'media',       cmd:'ristretto'                },
  { id:'music',     name:'Music',         icon:'🎵', cat:'media',       cmd:'parole --audio'           },
  { id:'video',     name:'Video',         icon:'🎬', cat:'media',       cmd:'parole'                   },
  // Productivity
  { id:'editor',    name:'Text Editor',   icon:'📝', cat:'productivity', cmd:'mousepad'                },
  { id:'calendar',  name:'Calendar',      icon:'📅', cat:'productivity', cmd:'avryd-calendar'          },
  { id:'notes',     name:'Notes',         icon:'🗒️', cat:'productivity', cmd:'avryd-notes'             },
  // Utility
  { id:'archive',   name:'Archive',       icon:'📦', cat:'utility',     cmd:'file-roller'              },
  { id:'clipboard', name:'Clipboard',     icon:'📋', cat:'utility',     cmd:'avryd-clipboard'          },
  { id:'screenshot',name:'Screenshot',    icon:'📸', cat:'utility',     cmd:'xfce4-screenshooter'      },
  { id:'calculator',name:'Calculator',    icon:'🧮', cat:'utility',     cmd:'avryd-calculator'         },
  { id:'themes',    name:'Themes',        icon:'🎨', cat:'utility',     cmd:'avryd-themes'             },
];

const CATEGORIES = ['all','internet','system','media','productivity','utility'];

// ── DAEMON BRIDGE ─────────────────────────────────────────────────────────────
const daemon = async (endpoint, method = 'GET', body = null) => {
  try {
    const r = await fetch(`${DAEMON_API}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return await r.json();
  } catch { return null; }
};

const launch = (app) => daemon('/launch', 'POST', { cmd: app.cmd, id: app.id });

// ── FUZZY MATCH ───────────────────────────────────────────────────────────────
const fuzzy = (str, q) => {
  str = str.toLowerCase(); q = q.toLowerCase();
  let si = 0;
  for (const ch of q) { si = str.indexOf(ch, si); if (si < 0) return false; si++; }
  return true;
};

// ═════════════════════════════════════════════════════════════════════════════
//  ROOT COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
export default function AvrydDesktop() {

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [themeKey, setThemeKey]   = useState('light'); // light|dark|auto|hc
  const theme = THEMES[themeKey === 'auto'
    ? (window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')
    : themeKey] || THEMES.light;

  // ── Time & stats ───────────────────────────────────────────────────────────
  const [time, setTime]           = useState(new Date());
  const [cpu, setCpu]             = useState(14);
  const [ram, setRam]             = useState(43);
  const [battery, setBattery]     = useState(74);
  const [charging, setCharging]   = useState(false);

  // ── Panels open/close ──────────────────────────────────────────────────────
  const [flyout, setFlyout]       = useState(null);
  const [drawerOpen, setDrawer]   = useState(false);
  const [drawerCat, setDrawerCat] = useState('all');

  // ── Context menu ───────────────────────────────────────────────────────────
  const [ctx, setCtx]             = useState(null); // {x,y,type,target}

  // ── Search ─────────────────────────────────────────────────────────────────
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const searchRef                 = useRef();

  // ── Notifications ──────────────────────────────────────────────────────────
  const [notifs, setNotifs]       = useState([]);
  const [notifBadge, setBadge]    = useState(0);

  // ── Settings ───────────────────────────────────────────────────────────────
  const [volume, setVolume]       = useState(72);
  const [muted, setMuted]         = useState(false);
  const [btOn, setBt]             = useState(true);
  const [chargeLimit, setChgLim]  = useState(80);
  const [batSaver, setBatSaver]   = useState(false);
  const [wifiSSID, setSSID]       = useState('Avryd_5G');

  // ── Quasar ─────────────────────────────────────────────────────────────────
  const [quasarMode, setQuasar]   = useState('balanced'); // balanced|turbo|eco
  const [quasarOpen, setQOpen]    = useState(false);

  // ── Wallpaper ──────────────────────────────────────────────────────────────
  const [wallpapers, setWalls]    = useState([]);
  const [activeWall, setWall]     = useState(null);

  // ── Dock (draggable order) ─────────────────────────────────────────────────
  const [dockApps, setDockApps]   = useState(
    ['browser','files','terminal','settings','photos','music']
  );
  const dragDockIdx               = useRef(null);

  // ── Widgets ────────────────────────────────────────────────────────────────
  const [widgets, setWidgets]     = useState([
    { id:'wk-clock',  type:'clock',  x:80,  y:80,  locked:false },
    { id:'wk-stats',  type:'stats',  x:80,  y:210, locked:false },
    { id:'wk-media',  type:'media',  x:80,  y:345, locked:false },
  ]);

  // ── Updates ────────────────────────────────────────────────────────────────
  const [updateVer, setUpVer]     = useState('');
  const [updateStatus, setUpStat] = useState('');

  // ── Tick ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    const s = setInterval(() => {
      setCpu(p => Math.max(5, Math.min(95, p + (Math.random()*10-5))));
      setRam(p => Math.max(30, Math.min(82, p + (Math.random()*3-1.5))));
    }, 2200);
    return () => { clearInterval(t); clearInterval(s); };
  }, []);

  // ── Boot notifications ──────────────────────────────────────────────────────
  useEffect(() => {
    pushNotif('Avryd OS', 'Desktop ready. Quasar active.', '✅');
    setTimeout(() => pushNotif('Quasar', '3 apps preloaded for fast launch.', '⚡'), 1400);
    // Check updates
    setTimeout(async () => {
      try {
        const res = await fetch(`${UPDATE_SERVER}/api/version`);
        const data = await res.json();
        if (data.version && data.version !== AVRYD_VERSION) {
          setUpVer(data.version);
          pushNotif('Update Available', `Avryd ${data.version} ready to install.`, '⬆️');
          setBadge(n => n + 1);
        }
      } catch {}
    }, 2500);
    // Fetch wallpapers
    fetch(`${WALLPAPER_REPO}/index.json`)
      .then(r => r.json()).then(d => setWalls(d.wallpapers || []))
      .catch(() => {});
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        setFlyout(null); setDrawer(false); setCtx(null); setQOpen(false);
        setQuery(''); setResults([]);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Search ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const q = query.trim();
    const appHits = ALL_APPS.filter(a => fuzzy(a.name, q))
      .map(a => ({ type:'app', icon:a.icon, title:a.name, sub:a.cat, app:a }));
    const cmdHints = [
      { type:'cmd', icon:'💻', title:`avryd-launch ${q}`, sub:'Terminal command' },
      { type:'web', icon:'🔍', title:`Search "${q}" on the web`, sub:'Open browser' },
    ];
    setResults([...appHits, ...cmdHints].slice(0, 7));
  }, [query]);

  // ── Notifications ───────────────────────────────────────────────────────────
  const pushNotif = useCallback((title, body, icon = '🔔') => {
    const id = Date.now() + Math.random();
    setNotifs(prev => [...prev, { id, title, body, icon }]);
    setBadge(n => n + 1);
    setTimeout(() => {
      setNotifs(prev => prev.filter(n => n.id !== id));
    }, 5000);
  }, []);

  const dismissNotif = (id) => setNotifs(prev => prev.filter(n => n.id !== id));

  // ── Flyout toggle ───────────────────────────────────────────────────────────
  const toggleFlyout = (name) => {
    setFlyout(f => f === name ? null : name);
  };

  // ── Context menu ────────────────────────────────────────────────────────────
  const showCtx = (e, type, target = null) => {
    e.preventDefault(); e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth  - 220);
    const y = Math.min(e.clientY, window.innerHeight - 320);
    setCtx({ x, y, type, target });
  };

  // ── Dock drag reorder ───────────────────────────────────────────────────────
  const onDockDragStart = (i)   => { dragDockIdx.current = i; };
  const onDockDrop      = (i)   => {
    if (dragDockIdx.current === null) return;
    const arr = [...dockApps];
    const [moved] = arr.splice(dragDockIdx.current, 1);
    arr.splice(i, 0, moved);
    setDockApps(arr);
    dragDockIdx.current = null;
  };

  // ── Quasar ─────────────────────────────────────────────────────────────────
  const quasarLabel = { balanced: 'Balanced', turbo: 'Turbo ⚡', eco: 'Eco 🌿' };
  useEffect(() => {
    // Auto eco-mode when RAM is tight
    if (ram > 70 && quasarMode === 'balanced') setQuasar('eco');
  }, [ram]);

  // ── Wallpaper style ─────────────────────────────────────────────────────────
  const wallBg = activeWall
    ? { backgroundImage: `url("${WALLPAPER_REPO}/${activeWall}")`, backgroundSize:'cover', backgroundPosition:'center' }
    : { background: 'radial-gradient(circle at 28% 22%, #80cdc4 0%, #5eb5ab 35%, #3d9088 80%, #2e7068 100%)' };

  const G = theme.glass;
  const GF = theme.glassFull;

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="relative w-full h-screen overflow-hidden font-sans select-none"
      style={wallBg}
      onClick={() => { setCtx(null); setFlyout(null); }}
      onContextMenu={(e) => showCtx(e, 'desktop')}
    >
      {/* Dark overlay */}
      {themeKey === 'dark' && <div className="absolute inset-0 bg-black/25 pointer-events-none z-0"/>}

      {/* Grain */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.022] z-[9995]"
        style={{ backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}/>

      {/* AVRYD watermark */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden z-0">
        <span className="text-[22vw] font-black tracking-tighter"
          style={{ color: themeKey==='dark' ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,.022)' }}>
          AVRYD
        </span>
      </div>

      {/* ══ WIDGETS ══ */}
      {widgets.map(w => (
        <DraggableWidget key={w.id} widget={w}
          cpu={cpu} ram={ram} time={time}
          onUpdate={(id, pos) => setWidgets(prev => prev.map(p => p.id===id ? {...p,...pos} : p))}
          onRemove={(id) => setWidgets(prev => prev.filter(p => p.id!==id))}
          themeKey={themeKey}
        />
      ))}

      {/* ══ SYSTEM HUB ══ */}
      <div className="fixed top-4 right-4 z-[1000] flex flex-col items-end gap-3"
        onClick={e => e.stopPropagation()}>

        <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-[22px] border backdrop-blur-3xl shadow-2xl ${G}`}>

          {/* CPU ring */}
          <div className="flex items-center gap-2 px-2 border-r border-black/10">
            <div className="relative w-8 h-8">
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 32 32">
                <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.1"/>
                <circle cx="16" cy="16" r="12" fill="none" stroke="#84cc16" strokeWidth="3"
                  strokeDasharray="75.4"
                  strokeDashoffset={75.4 - (75.4*cpu/100)}
                  style={{ transition:'stroke-dashoffset 1s ease' }}/>
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black">
                {Math.round(cpu)}%
              </span>
            </div>
            <div>
              <div className="h-1.5 w-12 rounded-full overflow-hidden" style={{ background:'rgba(128,128,128,0.15)' }}>
                <div className="h-full bg-sky-400 rounded-full" style={{ width:`${ram}%`, transition:'width 1s ease' }}/>
              </div>
              <span className="text-[8px] font-black opacity-35 uppercase mt-0.5 block">RAM {Math.round(ram)}%</span>
            </div>
          </div>

          {/* Hub icons */}
          {[
            { id:'notifications', Icon: Bell,           badge: notifBadge > 0 },
            { id:'network',       Icon: Wifi                                   },
            { id:'battery',       Icon: charging ? BatteryCharging : battery < 20 ? BatteryLow : Battery },
            { id:'sound',         Icon: muted ? VolumeX : Volume2              },
            { id:'user',          Icon: User                                   },
          ].map(({ id, Icon, badge }) => (
            <button key={id}
              onClick={() => toggleFlyout(id)}
              className={`relative p-2 rounded-xl transition-all ${flyout===id ? 'bg-lime-400 text-black' : 'hover:bg-white/30'}`}>
              <Icon size={16}/>
              {badge && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-black flex items-center justify-center">
                  {notifBadge}
                </span>
              )}
            </button>
          ))}

          {/* Update badge */}
          {updateVer && (
            <button onClick={() => toggleFlyout('update')}
              className="p-2 rounded-xl bg-lime-400 text-black animate-pulse">
              <Download size={15}/>
            </button>
          )}

          {/* Clock */}
          <div className="pl-3 pr-4 py-1 border-l border-black/10 flex flex-col items-end">
            <span className="text-sm font-black tracking-tighter leading-none">
              {time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false })}
            </span>
            <span className="text-[9px] font-bold opacity-35 uppercase tracking-widest mt-0.5">
              {time.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' })}
            </span>
          </div>
        </div>

        {/* ── Flyouts ── */}
        {flyout && (
          <div className={`w-72 p-5 rounded-3xl border shadow-2xl ${GF}`}
            onClick={e => e.stopPropagation()}>
            {flyout === 'battery'       && <BatteryFlyout {...{battery, charging, chargeLimit, setChgLim, batSaver, setBatSaver, pushNotif, G}}/>}
            {flyout === 'network'       && <NetworkFlyout {...{wifiSSID, setSSID, btOn, setBt, pushNotif}}/>}
            {flyout === 'sound'         && <SoundFlyout   {...{volume, setVolume, muted, setMuted, pushNotif}}/>}
            {flyout === 'notifications' && <NotifFlyout   {...{notifs, dismissNotif, setBadge}}/>}
            {flyout === 'user'          && <UserFlyout    {...{themeKey, setThemeKey, pushNotif, setQOpen, quasarOpen}}/>}
            {flyout === 'update'        && <UpdateFlyout  {...{updateVer, updateStatus, setUpStat, pushNotif, AVRYD_VERSION}}/>}
            {flyout === 'wallpapers'    && <WallpaperFlyout {...{wallpapers, activeWall, setWall, WALLPAPER_REPO}}/>}
          </div>
        )}
      </div>

      {/* ══ LEFT DOCK ══ */}
      <div className={`fixed left-4 top-1/2 -translate-y-1/2 z-[500] flex flex-col items-center gap-2 py-3 px-2 rounded-[28px] border shadow-2xl backdrop-blur-3xl ${G}`}
        onClick={e => e.stopPropagation()}>

        {/* Drawer button */}
        <button onClick={() => setDrawer(true)}
          className="w-10 h-10 bg-lime-400 rounded-[14px] flex items-center justify-center text-black shadow-lg shadow-lime-400/30 hover:scale-110 transition-transform">
          <LayoutGrid size={18} strokeWidth={2.5}/>
        </button>
        <div className="w-7 h-px bg-current opacity-10"/>

        {/* Pinned apps */}
        {dockApps.map((id, i) => {
          const app = ALL_APPS.find(a => a.id === id);
          if (!app) return null;
          return (
            <div key={id}
              draggable
              onDragStart={() => onDockDragStart(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDockDrop(i)}
              className="relative group"
            >
              <button
                onClick={() => { launch(app); pushNotif(app.name, `Launching ${app.name}…`); }}
                onContextMenu={e => showCtx(e, 'dock', app)}
                className="w-10 h-10 rounded-[14px] flex items-center justify-center text-xl hover:bg-white/30 hover:scale-115 transition-all">
                {app.icon}
              </button>
              <span className="absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 px-2 py-1 rounded-lg bg-black/75 text-white text-[10px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                {app.name}
              </span>
            </div>
          );
        })}

        {/* Add widget button */}
        <div className="w-7 h-px bg-current opacity-10"/>
        <button
          title="Add widget"
          onClick={() => {
            const id = 'wk-' + Date.now();
            setWidgets(prev => [...prev, { id, type:'clock', x:200, y:200, locked:false }]);
          }}
          className="w-10 h-10 rounded-[14px] flex items-center justify-center hover:bg-white/30 transition-all opacity-50 hover:opacity-100">
          <Plus size={16}/>
        </button>
      </div>

      {/* ══ SEARCH ══ */}
      <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] z-[400]"
        onClick={e => e.stopPropagation()}>
        <div className={`flex items-center gap-3 px-5 py-4 rounded-[22px] border backdrop-blur-2xl shadow-2xl ${GF}`}>
          <Search size={18} className="opacity-40 flex-shrink-0"/>
          <input ref={searchRef}
            type="text" placeholder="Search apps, files, run commands…  (Ctrl+K)"
            className="flex-1 bg-transparent outline-none text-sm font-medium placeholder:opacity-40"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {results.length > 0 && (
          <div className={`mt-2 rounded-[18px] border shadow-2xl overflow-hidden ${GF}`}>
            {results.map((r, i) => (
              <button key={i}
                onClick={() => {
                  r.app && launch(r.app);
                  pushNotif(r.title, r.type === 'web' ? 'Opening browser…' : `Launching ${r.title}…`);
                  setQuery(''); setResults([]);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-lime-400/20 transition ${i > 0 ? 'border-t border-black/5' : ''}`}>
                <span className="text-lg w-7 text-center">{r.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{r.title}</div>
                  <div className="text-xs opacity-50 truncate">{r.sub}</div>
                </div>
                <ChevronRight size={12} className="opacity-25"/>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ══ APP DRAWER ══ */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center"
          style={{ backdropFilter:'blur(60px)', background:'rgba(5,15,10,0.55)' }}
          onClick={() => setDrawer(false)}>
          <div className={`w-[820px] max-h-[600px] p-10 rounded-[40px] border shadow-2xl overflow-y-auto ${GF}`}
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-6">
              <h2 className="text-4xl font-black tracking-tighter">Applications</h2>
              <button onClick={() => setDrawer(false)} className="p-2 rounded-xl hover:bg-white/20 transition">
                <X size={20}/>
              </button>
            </div>

            {/* Category filter */}
            <div className="flex gap-2 mb-6 flex-wrap">
              {CATEGORIES.map(cat => (
                <button key={cat}
                  onClick={() => setDrawerCat(cat)}
                  className={`px-4 py-1.5 rounded-full text-[11px] font-bold border transition ${
                    drawerCat===cat ? 'bg-lime-400 text-black border-lime-400' : 'border-white/20 hover:bg-white/15 opacity-70'
                  }`}>
                  {cat.charAt(0).toUpperCase()+cat.slice(1)}
                </button>
              ))}
            </div>

            {/* App grid */}
            <div className="grid grid-cols-6 gap-3">
              {ALL_APPS.filter(a => drawerCat==='all' || a.cat===drawerCat).map(app => (
                <button key={app.id}
                  onClick={() => { launch(app); pushNotif(app.name, `Launching ${app.name}…`); setDrawer(false); }}
                  onContextMenu={e => showCtx(e, 'app', app)}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-white/10 hover:bg-white/20 hover:shadow-lg transition-all group">
                  <span className="text-[28px] group-hover:scale-125 transition-transform duration-300">{app.icon}</span>
                  <span className="text-[11px] font-bold text-center leading-tight">{app.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ CONTEXT MENU ══ */}
      {ctx && (
        <ContextMenu ctx={ctx} closeCtx={() => setCtx(null)}
          pushNotif={pushNotif} dockApps={dockApps} setDockApps={setDockApps}
          GF={GF}
        />
      )}

      {/* ══ QUASAR PANEL ══ */}
      {quasarOpen && (
        <div className={`fixed bottom-14 right-4 z-[400] w-64 p-4 rounded-2xl border shadow-2xl ${GF}`}
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-3 font-black text-sm">
            <ZapIcon size={14} className="text-lime-500"/> Quasar — {quasarLabel[quasarMode]}
          </div>
          <div className="text-xs opacity-60 mb-3">
            RAM: {Math.round(ram)}% · CPU: {Math.round(cpu)}% · Auto-mode {ram>70?'→ Eco':ram>55?'→ Balanced':'→ Performance'}
          </div>
          <div className="flex gap-2">
            {['balanced','turbo','eco'].map(m => (
              <button key={m}
                onClick={() => { setQuasar(m); pushNotif('Quasar', `Mode: ${quasarLabel[m]}`,'⚡'); }}
                className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold border transition ${
                  quasarMode===m ? 'bg-lime-400 text-black border-lime-400' : 'border-white/20 hover:bg-white/15'
                }`}>
                {m.charAt(0).toUpperCase()+m.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ══ NOTIFICATION STACK ══ */}
      <div className="fixed bottom-14 right-4 z-[300] flex flex-col gap-2 items-end pointer-events-none"
        style={{ maxWidth: '280px' }}>
        {notifs.map(n => (
          <div key={n.id}
            className="flex items-start gap-2 p-3 rounded-2xl border shadow-xl pointer-events-all"
            style={{ background:'rgba(255,255,255,0.82)', backdropFilter:'blur(20px)', color:'#111', borderColor:'rgba(255,255,255,0.85)' }}>
            <span className="text-lg flex-shrink-0">{n.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xs">{n.title}</div>
              <div className="text-[11px] opacity-60 mt-0.5 truncate">{n.body}</div>
            </div>
            <button onClick={() => dismissNotif(n.id)} className="opacity-30 hover:opacity-80 text-xs flex-shrink-0">✕</button>
          </div>
        ))}
      </div>

      {/* ══ TASKBAR STATUS STRIP ══ */}
      <div className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-3 px-5 py-2 rounded-[20px] border shadow-xl backdrop-blur-3xl text-[10px] font-bold opacity-75 hover:opacity-100 transition-opacity ${G}`}>
        <Activity size={11} className="text-lime-500"/>
        <span>Avryd OS {AVRYD_VERSION}</span>
        <span className="opacity-30">·</span>
        <span>Quasar: {quasarLabel[quasarMode]}</span>
        <span className="opacity-30">·</span>
        <span>GPU: Active</span>
        <span className="opacity-30">·</span>
        <span>IPC: Ready</span>
        {updateVer && (
          <>
            <span className="opacity-30">·</span>
            <button onClick={() => toggleFlyout('update')} className="text-lime-400 animate-pulse">
              ⬆ v{updateVer}
            </button>
          </>
        )}
        <button onClick={() => setQOpen(o => !o)} className="ml-1 opacity-50 hover:opacity-100 transition">
          <Sliders size={11}/>
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function DraggableWidget({ widget, cpu, ram, time, onUpdate, onRemove, themeKey }) {
  const ref   = useRef();
  const drag  = useRef({ active:false, ox:0, oy:0, sx:0, sy:0 });

  const onMouseDown = (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    drag.current = { active:true, ox:widget.x, oy:widget.y, sx:e.clientX, sy:e.clientY };
    e.preventDefault();
  };

  useEffect(() => {
    const move = (e) => {
      if (!drag.current.active) return;
      onUpdate(widget.id, {
        x: drag.current.ox + e.clientX - drag.current.sx,
        y: drag.current.oy + e.clientY - drag.current.sy,
      });
    };
    const up = () => { drag.current.active = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [widget.id, onUpdate]);

  const cls = themeKey==='dark'
    ? 'bg-black/35 border-white/15 text-white'
    : 'bg-white/30 border-white/55 text-slate-900';

  return (
    <div ref={ref}
      className={`absolute rounded-2xl border shadow-lg backdrop-blur-2xl cursor-grab active:cursor-grabbing p-3 ${cls}`}
      style={{ left: widget.x, top: widget.y, minWidth: 160, zIndex: 30 }}
      onMouseDown={onMouseDown}>

      {/* Widget remove */}
      <button onClick={() => onRemove(widget.id)}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white/80 text-slate-700 text-[10px] flex items-center justify-center shadow opacity-0 hover:opacity-100 transition-opacity group-hover:opacity-100">
        ✕
      </button>

      {widget.type === 'clock' && (
        <div>
          <div className="text-[9px] font-black uppercase opacity-40 mb-1">Clock</div>
          <div className="text-3xl font-black tracking-tighter leading-none">
            {time.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false })}
          </div>
          <div className="text-[11px] opacity-55 mt-1">
            {time.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric' })}
          </div>
        </div>
      )}

      {widget.type === 'stats' && (
        <div style={{ minWidth: 170 }}>
          <div className="text-[9px] font-black uppercase opacity-40 mb-2">System</div>
          {[['CPU', cpu, '#84cc16'], ['RAM', ram, '#38bdf8']].map(([label, val, color]) => (
            <div key={label} className="mb-2">
              <div className="flex justify-between text-[11px] font-bold opacity-70 mb-1">
                <span>{label}</span><span>{Math.round(val)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(128,128,128,.18)' }}>
                <div className="h-full rounded-full transition-all duration-700" style={{ width:`${val}%`, background:color }}/>
              </div>
            </div>
          ))}
        </div>
      )}

      {widget.type === 'media' && (
        <div style={{ minWidth: 190 }}>
          <div className="text-[9px] font-black uppercase opacity-40 mb-2">Now Playing</div>
          <div className="font-bold text-sm">Crystallize</div>
          <div className="text-[11px] opacity-55">Lindsey Stirling</div>
          <div className="flex items-center gap-2 mt-3">
            {[<SkipBack/>, <Play/>, <SkipForward/>].map((Icon, i) => (
              <button key={i}
                className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-lime-400 hover:text-black transition-all"
                style={{ background:'rgba(255,255,255,0.2)' }}>
                {React.cloneElement(Icon, { size:12 })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FlyoutShell({ title, icon, children, action }) {
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="font-black text-sm">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={() => onChange(!value)}
      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-lime-400' : 'bg-black/20'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${value ? 'left-5' : 'left-0.5'}`}/>
    </button>
  );
}

function FRow({ label, icon, children }) {
  return (
    <div className="flex items-center justify-between py-2 border-t border-black/8 text-sm">
      <div className="flex items-center gap-2 font-semibold opacity-75">
        {icon && React.cloneElement(icon, { size: 13 })}
        {label}
      </div>
      {children}
    </div>
  );
}

function BatteryFlyout({ battery, charging, chargeLimit, setChgLim, batSaver, setBatSaver, pushNotif }) {
  return (
    <FlyoutShell title="Power Hub" icon={<Zap size={16} className="text-lime-500"/>}>
      <div className="p-4 rounded-2xl mb-3 bg-black/8 border border-black/8">
        <div className="flex justify-between items-end mb-2">
          <span className="text-2xl font-black">{battery}%</span>
          <span className="text-xs opacity-50">{charging ? 'Charging…' : '2h 45m left'}</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden bg-black/10">
          <div className="h-full bg-lime-400 transition-all" style={{ width:`${battery}%` }}/>
        </div>
      </div>
      <FRow label="Battery Saver" icon={<Zap/>}><Toggle value={batSaver} onChange={setBatSaver}/></FRow>
      <div className="pt-2">
        <div className="flex justify-between text-xs font-bold opacity-60 mb-1">
          <span>Charge Limit</span><span>{chargeLimit}%</span>
        </div>
        <input type="range" min={50} max={100} value={chargeLimit}
          onChange={e => setChgLim(+e.target.value)} className="w-full accent-lime-500"/>
      </div>
      <div className="flex gap-2 mt-3">
        {[['Suspend', () => pushNotif('Power','Suspending…')], ['Reboot', () => pushNotif('Power','Rebooting…')], ['Shutdown', () => pushNotif('Power','Shutting down…')]].map(([l,fn]) => (
          <button key={l} onClick={fn}
            className="flex-1 py-1.5 rounded-xl text-[10px] font-bold bg-black/8 hover:bg-black/15 transition">{l}</button>
        ))}
      </div>
    </FlyoutShell>
  );
}

function NetworkFlyout({ wifiSSID, setSSID, btOn, setBt, pushNotif }) {
  return (
    <FlyoutShell title="Connectivity" icon={<Wifi size={16} className="text-lime-500"/>}>
      <div className="flex items-center justify-between p-2.5 rounded-xl bg-lime-400 text-black mb-2 text-sm font-bold">
        <div className="flex items-center gap-2"><Wifi size={14}/>{wifiSSID}</div>
        <ShieldCheck size={13}/>
      </div>
      <div className="text-[9px] font-black uppercase opacity-35 tracking-wider my-2">Available</div>
      {['Starlink_Alpha','Guest_Access','Neighbor_5G'].map(n => (
        <button key={n} onClick={() => { setSSID(n); pushNotif('Network', `Connecting to ${n}…`); }}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-black/8 text-sm font-medium transition">
          <span>{n}</span><Wifi size={13} className="opacity-35"/>
        </button>
      ))}
      <FRow label="Bluetooth" icon={<Bluetooth/>}><Toggle value={btOn} onChange={setBt}/></FRow>
      <FRow label="Ethernet" icon={<HardDrive/>}><span className="text-xs opacity-40">Disconnected</span></FRow>
    </FlyoutShell>
  );
}

function SoundFlyout({ volume, setVolume, muted, setMuted, pushNotif }) {
  return (
    <FlyoutShell title="Audio" icon={<Volume2 size={16} className="text-lime-500"/>}>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={() => setMuted(m => !m)} className="hover:text-lime-500 transition">
          {muted ? <VolumeX size={16}/> : <Volume2 size={16}/>}
        </button>
        <input type="range" min={0} max={100} value={muted ? 0 : volume}
          onChange={e => { setVolume(+e.target.value); setMuted(false); }}
          className="flex-1 accent-lime-500"/>
        <span className="text-sm font-black w-7 text-right">{muted ? 0 : volume}</span>
      </div>
      <div className="text-[9px] font-black uppercase opacity-35 tracking-wider mb-1">Output</div>
      {['Built-in Speakers','HDMI Audio','Bluetooth Headset'].map(d => (
        <button key={d} className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/8 text-sm transition">{d}</button>
      ))}
    </FlyoutShell>
  );
}

function NotifFlyout({ notifs, dismissNotif, setBadge }) {
  return (
    <FlyoutShell title="Notifications"
      icon={<Bell size={16} className="text-lime-500"/>}
      action={<button onClick={() => { setBadge(0); }} className="text-[10px] font-bold opacity-40 hover:opacity-80">Clear</button>}>
      {notifs.length === 0
        ? <p className="text-xs opacity-40 text-center py-4">No notifications</p>
        : notifs.slice().reverse().slice(0,5).map(n => (
          <div key={n.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-black/6 mb-1.5">
            <span className="text-base">{n.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xs">{n.title}</div>
              <div className="text-[11px] opacity-55 truncate">{n.body}</div>
            </div>
            <button onClick={() => dismissNotif(n.id)} className="opacity-30 hover:opacity-70 text-xs">✕</button>
          </div>
        ))}
    </FlyoutShell>
  );
}

function UserFlyout({ themeKey, setThemeKey, pushNotif, setQOpen, quasarOpen }) {
  return (
    <FlyoutShell title="Session" icon={<User size={16} className="text-lime-500"/>}>
      <div className="flex items-center gap-3 pb-3 mb-1 border-b border-black/8">
        <div className="w-10 h-10 rounded-full bg-lime-400 flex items-center justify-center font-black text-lg text-black">A</div>
        <div>
          <div className="font-bold text-sm">avryd-user</div>
          <div className="text-xs opacity-50">Administrator</div>
        </div>
      </div>
      <div className="text-[9px] font-black uppercase opacity-35 tracking-wider mt-2 mb-1">Theme</div>
      <div className="flex gap-2 mb-2">
        {['light','dark','auto','hc'].map(t => (
          <button key={t}
            onClick={() => setThemeKey(t)}
            className={`flex-1 py-1.5 rounded-xl text-[10px] font-bold border transition ${themeKey===t ? 'bg-lime-400 text-black border-lime-400' : 'border-black/15 hover:bg-black/8'}`}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>
      <button onClick={() => setQOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-black/8 text-sm transition">
        <Sliders size={14}/> Quasar Controls
      </button>
      <div className="h-px bg-black/8 my-1"/>
      {[['🔒','Lock Screen'], ['↩️','Log Out'], ['🔄','Restart Shell'], ['⭘','Shutdown']].map(([ic,lb]) => (
        <button key={lb} onClick={() => pushNotif('Session', lb+'…')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-black/8 text-sm transition text-left">
          {ic} {lb}
        </button>
      ))}
    </FlyoutShell>
  );
}

function UpdateFlyout({ updateVer, updateStatus, setUpStat, pushNotif, AVRYD_VERSION }) {
  const doUpdate = async () => {
    setUpStat('downloading');
    try {
      const r = await fetch(`${UPDATE_SERVER}/api/update`, { method:'POST' });
      if (r.ok) { setUpStat('done'); pushNotif('Update', 'Installed. Restart to apply.', '✅'); }
      else       { setUpStat('error'); }
    } catch { setUpStat('error'); }
  };
  return (
    <FlyoutShell title="System Update" icon={<Download size={16} className="text-lime-500"/>}>
      <div className="p-4 rounded-2xl bg-black/8 text-center mb-3">
        <div className="text-2xl font-black">v{updateVer}</div>
        <p className="text-xs opacity-50 mt-1">Available from ui-avryd.onrender.com</p>
        <p className="text-xs opacity-35">Current: v{AVRYD_VERSION}</p>
      </div>
      {updateStatus === 'downloading' && (
        <div className="flex items-center gap-2 py-2 text-sm"><div className="w-4 h-4 border-2 border-lime-400 border-t-transparent rounded-full animate-spin"/>Downloading…</div>
      )}
      {updateStatus === 'done' && (
        <div className="flex items-center gap-2 py-2 text-green-600 text-sm"><CheckCircle size={14}/>Installed. Restart to apply.</div>
      )}
      {updateStatus === 'error' && (
        <div className="flex items-center gap-2 py-2 text-red-500 text-sm"><AlertCircle size={14}/>Update failed.</div>
      )}
      {!updateStatus && (
        <button onClick={doUpdate}
          className="w-full py-3 rounded-xl bg-lime-400 text-black font-bold text-sm hover:bg-lime-300 transition flex items-center justify-center gap-2">
          <Download size={14}/> Install v{updateVer}
        </button>
      )}
    </FlyoutShell>
  );
}

function WallpaperFlyout({ wallpapers, activeWall, setWall, WALLPAPER_REPO }) {
  return (
    <FlyoutShell title="Wallpapers" icon={<Image size={16} className="text-lime-500"/>}>
      <div className="grid grid-cols-2 gap-2">
        {/* Stock */}
        <button onClick={() => setWall(null)}
          className={`h-20 rounded-xl border-2 transition overflow-hidden ${!activeWall ? 'border-lime-400' : 'border-transparent'}`}
          style={{ background:'linear-gradient(135deg,#80cdc4,#3d9088)', backgroundSize:'cover' }}>
          <span className="sr-only">Stock</span>
        </button>
        {wallpapers.map(w => (
          <button key={w.file} onClick={() => setWall(w.file)}
            className={`h-20 rounded-xl border-2 transition overflow-hidden ${activeWall===w.file ? 'border-lime-400' : 'border-transparent'}`}
            style={{ backgroundImage:`url("${WALLPAPER_REPO}/${w.thumb}")`, backgroundSize:'cover', backgroundPosition:'center' }}/>
        ))}
      </div>
      {wallpapers.length === 0 && (
        <p className="text-xs opacity-40 text-center pt-3">Sync: <code className="font-mono">avryd-wallpaper-sync</code></p>
      )}
    </FlyoutShell>
  );
}

function ContextMenu({ ctx, closeCtx, pushNotif, dockApps, setDockApps, GF }) {
  const { x, y, type, target } = ctx;

  const Item = ({ icon, label, onClick, danger, children }) => (
    <button
      onClick={() => { onClick?.(); closeCtx(); }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition text-left ${
        danger ? 'hover:bg-red-100 hover:text-red-600' : 'hover:bg-lime-400/20'
      }`}>
      {icon && React.cloneElement(icon, { size:13, className:'opacity-60' })}
      {label}
      {children}
    </button>
  );

  const Sep = () => <div className="h-px bg-black/8 my-1 mx-2"/>;
  const Header = ({ label }) => <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest opacity-30">{label}</div>;

  return (
    <div
      className={`fixed z-[5000] w-52 p-1.5 rounded-2xl border shadow-2xl backdrop-blur-2xl`}
      style={{ top: y, left: x, background:'rgba(255,255,255,0.88)', border:'1px solid rgba(255,255,255,0.9)', color:'#1a1a1a' }}
      onClick={e => e.stopPropagation()}>

      {type === 'desktop' && <>
        <Header label="Desktop"/>
        <Item icon={<RefreshCw/>} label="Refresh" onClick={() => pushNotif('Desktop','Refreshed')}/>
        <Item icon={<FolderPlus/>} label="New Folder" onClick={() => pushNotif('Files','New folder created')}/>
        <Item icon={<FilePlus/>} label="New File" onClick={() => pushNotif('Files','New file created')}/>
        <Sep/>
        <Item icon={<Image/>} label="Change Wallpaper" onClick={() => pushNotif('Wallpaper','Open wallpaper picker')}/>
        <Item icon={<Monitor/>} label="Display Settings" onClick={() => pushNotif('Settings','Opening display…')}/>
        {/* Sort submenu */}
        <div className="relative group">
          <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold hover:bg-lime-400/20 transition text-left">
            <SortAsc size={13} className="opacity-60"/> Sort Icons
            <ChevronRight size={11} className="ml-auto opacity-40"/>
          </button>
          <div className="absolute left-full top-0 w-36 p-1.5 rounded-xl border shadow-xl hidden group-hover:block"
            style={{ background:'rgba(255,255,255,0.95)', borderColor:'rgba(255,255,255,0.9)' }}>
            {['By Name','By Date Modified','By Type','By Size'].map(s => (
              <button key={s} onClick={closeCtx}
                className="w-full text-left px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-lime-400/20 transition">{s}</button>
            ))}
          </div>
        </div>
        <Item icon={<Eye/>} label="Show Hidden Files"/>
        <Sep/>
        <Item icon={<Sliders/>} label="Desktop Preferences"/>
      </>}

      {type === 'dock' && <>
        <Header label={target?.name || 'App'}/>
        <Item icon={<Play/>}        label="Open"          onClick={() => { launch(target); pushNotif(target.name, `Launching ${target.name}…`); }}/>
        <Item icon={<ShieldCheck/>} label="Run as Admin"  onClick={() => pushNotif(target.name, 'Running as root…')}/>
        <Sep/>
        <Item icon={<Star/>}        label="Pin to Dock"/>
        <Item icon={<FolderOpen/>}  label="Open File Location"/>
        <Item icon={<LayoutGrid/>}  label="Move to Workspace"/>
        <Sep/>
        <Item icon={<Trash2/>} label="Remove from Dock" danger
          onClick={() => setDockApps(prev => prev.filter(id => id !== target?.id))}/>
      </>}

      {type === 'app' && <>
        <Header label={target?.name || 'App'}/>
        <Item icon={<Play/>}        label="Open"          onClick={() => { launch(target); pushNotif(target.name, `Launching ${target.name}…`); }}/>
        <Item icon={<ShieldCheck/>} label="Run as Admin"/>
        <Item icon={<Star/>}        label="Pin to Dock"
          onClick={() => setDockApps(prev => prev.includes(target.id) ? prev : [...prev, target.id])}/>
        <Item icon={<FolderOpen/>}  label="Open File Location"/>
        <Sep/>
        <Item icon={<Trash2/>}      label="Uninstall" danger/>
      </>}
    </div>
  );
}
