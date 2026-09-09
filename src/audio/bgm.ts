/**
 * Single battle BGM via SoundCloud Widget API.
 * One track, looped with near-seamless seek-before-end restart.
 */

declare global {
  interface Window {
    SC?: {
      Widget: {
        (el: HTMLIFrameElement | string): SoundCloudWidget;
        Events: {
          READY: string;
          PLAY: string;
          PAUSE: string;
          FINISH: string;
          PLAY_PROGRESS: string;
        };
      };
    };
  }
}

interface SoundCloudWidget {
  bind(
    event: string,
    listener: ((data?: { currentPosition?: number; relativePosition?: number }) => void) | (() => void),
  ): void;
  play(): void;
  pause(): void;
  setVolume(volume: number): void;
  seekTo(ms: number): void;
  load(
    url: string,
    options?: {
      auto_play?: boolean;
      callback?: () => void;
      show_artwork?: boolean;
      show_comments?: boolean;
      buying?: boolean;
      sharing?: boolean;
      download?: boolean;
    },
  ): void;
  getDuration(cb: (ms: number) => void): void;
  getCurrentSound(cb: (sound: { title?: string } | null) => void): void;
  isPaused(cb: (paused: boolean) => void): void;
}

/** Classic R/B trainer battle (hardware rip) — one looped duel theme. */
const TRACK_URL = 'https://soundcloud.com/aldrasio/07-trainerbattle';
const TRACK_TITLE = 'Trainer Battle';
const API_SRC = 'https://w.soundcloud.com/player/api.js';

const LS_MUSIC_VOL = 'duel-music-volume';
const LS_MUSIC = 'duel-music-muted';
const LS_LEGACY = 'duel-audio-muted';

/** Restart this many ms before the end to avoid a FINISH gap. */
const LOOP_LEAD_MS = 90;

let widget: SoundCloudWidget | null = null;
let iframe: HTMLIFrameElement | null = null;
let ready = false;
let wantPlaying = false;
let gestureArmed = false;
let trackDurationMs = 0;
let loopLock = false;

function readInitialMusicVolume(): number {
  const raw = localStorage.getItem(LS_MUSIC_VOL);
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  if (localStorage.getItem(LS_MUSIC) === '1' || localStorage.getItem(LS_LEGACY) === '1') {
    return 0;
  }
  return 45;
}

let musicVolume = readInitialMusicVolume();
let apiLoaded: Promise<void> | null = null;
let onTrackChange: ((title: string, index: number, total: number) => void) | null = null;

export function setTrackChangeListener(
  fn: ((title: string, index: number, total: number) => void) | null,
) {
  onTrackChange = fn;
}

export function getTrackLabel(): string {
  return TRACK_TITLE;
}

function notifyTrack() {
  onTrackChange?.(TRACK_TITLE, 0, 1);
}

/** UI 0–100 → SoundCloud widget 0–100. Music stays a quiet bed under SFX. */
const MUSIC_OUTPUT_MAX = 24;
const MUSIC_CURVE = 1.4;

function mapMusicUiToWidget(ui: number): number {
  const clamped = Math.max(0, Math.min(100, ui));
  if (clamped <= 0) return 0;
  const t = clamped / 100;
  const shaped = Math.pow(t, MUSIC_CURVE);
  return Math.max(1, Math.round(shaped * MUSIC_OUTPUT_MAX));
}

function applyWidgetVolume() {
  if (!widget || !ready) return;
  widget.setVolume(mapMusicUiToWidget(musicVolume));
}

function loadApi(): Promise<void> {
  if (window.SC?.Widget) return Promise.resolve();
  if (apiLoaded) return apiLoaded;
  apiLoaded = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      if (window.SC?.Widget) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = API_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('SoundCloud API failed to load'));
    document.head.appendChild(s);
  });
  return apiLoaded;
}

function ensureIframe(): HTMLIFrameElement {
  if (iframe) {
    const mount = document.getElementById('sc-bgm-mount');
    if (mount && iframe.parentElement !== mount) mount.appendChild(iframe);
    return iframe;
  }
  iframe = document.createElement('iframe');
  iframe.id = 'sc-bgm';
  iframe.allow = 'autoplay';
  iframe.title = 'Pokémon Trainer Battle (SoundCloud)';
  iframe.scrolling = 'no';
  iframe.frameBorder = 'no';
  const params = new URLSearchParams({
    url: TRACK_URL,
    color: '#5cffb0',
    auto_play: 'false',
    // Native loop when the widget supports it; we also force-seek for sync.
    loop: 'true',
    hide_related: 'true',
    show_comments: 'false',
    show_user: 'false',
    show_reposts: 'false',
    show_teaser: 'false',
    visual: 'false',
    buying: 'false',
    sharing: 'false',
    download: 'false',
    show_playcount: 'false',
    show_artwork: 'false',
  });
  iframe.src = `https://w.soundcloud.com/player/?${params.toString()}`;
  const mount = document.getElementById('sc-bgm-mount');
  (mount ?? document.getElementById('app')!).appendChild(iframe);
  return iframe;
}

function refreshDuration() {
  widget?.getDuration((ms) => {
    if (ms > 0) trackDurationMs = ms;
  });
}

/** Seek to start immediately — used for gapless-ish looping. */
function restartLoop() {
  if (!widget || !wantPlaying || musicVolume <= 0) return;
  if (loopLock) return;
  loopLock = true;
  widget.seekTo(0);
  widget.play();
  applyWidgetVolume();
  window.setTimeout(() => {
    loopLock = false;
  }, 180);
}

export function mountBgmInSettings() {
  if (musicVolume > 0) wantPlaying = true;
  void ensureWidget();
  armBgmGestureUnlock();
  notifyTrack();
}

function armBgmGestureUnlock() {
  if (gestureArmed) return;
  gestureArmed = true;
  const unlock = () => {
    if (wantPlaying && musicVolume > 0) void startBgm();
  };
  addEventListener('pointerdown', unlock, { once: true, capture: true });
  addEventListener('keydown', unlock, { once: true, capture: true });
}

async function ensureWidget(): Promise<SoundCloudWidget | null> {
  try {
    await loadApi();
    const el = ensureIframe();
    if (!widget) {
      widget = window.SC!.Widget(el);
      widget.bind(window.SC!.Widget.Events.READY, () => {
        ready = true;
        applyWidgetVolume();
        refreshDuration();
        notifyTrack();
        if (wantPlaying && musicVolume > 0) {
          widget?.play();
          window.setTimeout(() => applyWidgetVolume(), 100);
          window.setTimeout(() => applyWidgetVolume(), 400);
        }
      });
      widget.bind(window.SC!.Widget.Events.PLAY, () => {
        applyWidgetVolume();
        refreshDuration();
      });
      // Perfect-ish loop: jump back just before the natural end (avoids FINISH silence).
      widget.bind(window.SC!.Widget.Events.PLAY_PROGRESS, (data) => {
        if (!wantPlaying || musicVolume <= 0 || !widget) return;
        const pos = data?.currentPosition ?? 0;
        const rel = data?.relativePosition ?? 0;
        if (trackDurationMs > 0 && pos >= trackDurationMs - LOOP_LEAD_MS) {
          restartLoop();
          return;
        }
        // Fallback if duration unknown but relative is near 1
        if (trackDurationMs <= 0 && rel >= 0.985) restartLoop();
      });
      // Backup if PLAY_PROGRESS miss
      widget.bind(window.SC!.Widget.Events.FINISH, () => {
        restartLoop();
      });
    }
    return widget;
  } catch {
    return null;
  }
}

export async function startBgm() {
  wantPlaying = true;
  if (musicVolume <= 0) return;
  const w = await ensureWidget();
  if (!w || !ready) return;
  applyWidgetVolume();
  w.play();
  window.setTimeout(() => applyWidgetVolume(), 100);
  window.setTimeout(() => applyWidgetVolume(), 350);
  refreshDuration();
}

export function stopBgm() {
  wantPlaying = false;
  widget?.pause();
}

export function getMusicVolume(): number {
  return musicVolume;
}

export function setMusicVolume(next: number) {
  const prev = musicVolume;
  musicVolume = Math.max(0, Math.min(100, Math.round(next)));
  localStorage.setItem(LS_MUSIC_VOL, String(musicVolume));

  void ensureWidget().then((w) => {
    if (!w) return;

    if (musicVolume <= 0) {
      applyWidgetVolume();
      w.pause();
      return;
    }

    if (prev <= 0) wantPlaying = true;
    applyWidgetVolume();

    if (!wantPlaying || !ready) return;

    if (prev <= 0) {
      w.play();
      window.setTimeout(() => applyWidgetVolume(), 80);
      window.setTimeout(() => applyWidgetVolume(), 250);
      return;
    }

    w.isPaused((paused) => {
      if (paused) w.play();
      window.setTimeout(() => applyWidgetVolume(), 80);
    });
  });
}

export function isMusicMuted(): boolean {
  return musicVolume <= 0;
}

export function setMusicMuted(next: boolean) {
  setMusicVolume(next ? 0 : musicVolume > 0 ? musicVolume : 45);
}

export function toggleMusicMute(): boolean {
  setMusicMuted(!isMusicMuted());
  return isMusicMuted();
}

/** @deprecated use setMusicVolume */
export function setBgmMuted(muted: boolean) {
  setMusicMuted(muted);
}

/** Kept for API compat — only one battle track. */
export async function nextBgmTrack() {
  notifyTrack();
  return getTrackLabel();
}

export function isBgmWanted(): boolean {
  return wantPlaying;
}
