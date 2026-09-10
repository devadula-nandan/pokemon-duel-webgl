/**
 * Battle BGM via SoundCloud Widget API (Aldrasio R/B OST set).
 * Track index + play preference persist across refreshes.
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
  next(): void;
  prev(): void;
  skip(index: number): void;
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
  getCurrentSoundIndex(cb: (index: number) => void): void;
  getSounds(cb: (sounds: unknown[]) => void): void;
  isPaused(cb: (paused: boolean) => void): void;
}

/** Full hardware rip set — next/prev cycle through tracks. */
const PLAYLIST_URL = 'https://soundcloud.com/aldrasio/sets/pokemon-red-blue-music';
/** Default: Trainer Battle (index in set; falls back if set size differs). */
const DEFAULT_TRACK_INDEX = 7;
const API_SRC = 'https://w.soundcloud.com/player/api.js';

const LS_MUSIC_VOL = 'duel-music-volume';
const LS_MUSIC = 'duel-music-muted';
const LS_LEGACY = 'duel-audio-muted';
const LS_TRACK = 'duel-music-track';
const LS_WANT_PLAY = 'duel-music-want-play';

const LOOP_LEAD_MS = 90;

let widget: SoundCloudWidget | null = null;
let iframe: HTMLIFrameElement | null = null;
let ready = false;
let wantPlaying = localStorage.getItem(LS_WANT_PLAY) !== '0';
let gestureArmed = false;
let trackDurationMs = 0;
let loopLock = false;
let trackIndex = readTrackIndex();
let trackCount = 0;
let trackTitle = 'Loading…';

function readTrackIndex(): number {
  const raw = localStorage.getItem(LS_TRACK);
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return DEFAULT_TRACK_INDEX;
}

function persistTrack() {
  localStorage.setItem(LS_TRACK, String(trackIndex));
}

function persistWantPlay() {
  localStorage.setItem(LS_WANT_PLAY, wantPlaying ? '1' : '0');
}

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
let onPlayChange: ((playing: boolean) => void) | null = null;

export function setTrackChangeListener(
  fn: ((title: string, index: number, total: number) => void) | null,
) {
  onTrackChange = fn;
}

export function setPlayChangeListener(fn: ((playing: boolean) => void) | null) {
  onPlayChange = fn;
}

export function getTrackLabel(): string {
  return trackTitle;
}

export function getTrackIndex(): number {
  return trackIndex;
}

export function getTrackCount(): number {
  return trackCount;
}

function notifyTrack() {
  onTrackChange?.(trackTitle, trackIndex, Math.max(1, trackCount));
}

function notifyPlay() {
  onPlayChange?.(wantPlaying && musicVolume > 0);
}

function refreshTrackMeta() {
  if (!widget) return;
  widget.getCurrentSound((sound) => {
    const raw = sound?.title?.trim() || 'Untitled';
    trackTitle = raw.replace(/^\d+\s*/, '').trim() || raw;
    notifyTrack();
  });
  widget.getCurrentSoundIndex((idx) => {
    if (Number.isFinite(idx) && idx >= 0) {
      trackIndex = idx;
      persistTrack();
    }
  });
  widget.getSounds((sounds) => {
    if (Array.isArray(sounds)) trackCount = sounds.length;
  });
}

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
  iframe.title = 'Pokémon Red/Blue OST (SoundCloud)';
  iframe.scrolling = 'no';
  iframe.frameBorder = 'no';
  const params = new URLSearchParams({
    url: PLAYLIST_URL,
    color: '#5cffb0',
    auto_play: 'false',
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

function applySavedTrackThenMaybePlay() {
  if (!widget || !ready) return;
  widget.getSounds((sounds) => {
    trackCount = Array.isArray(sounds) ? sounds.length : 0;
    const max = Math.max(0, trackCount - 1);
    const idx = Math.min(Math.max(0, trackIndex), max || DEFAULT_TRACK_INDEX);
    trackIndex = idx;
    persistTrack();
    try {
      widget!.skip(idx);
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      refreshTrackMeta();
      refreshDuration();
      applyWidgetVolume();
      if (wantPlaying && musicVolume > 0) {
        widget!.play();
        window.setTimeout(() => applyWidgetVolume(), 100);
        window.setTimeout(() => applyWidgetVolume(), 400);
      } else {
        widget!.pause();
      }
      notifyPlay();
    }, 120);
  });
}

export function mountBgmInSettings() {
  void ensureWidget();
  armBgmGestureUnlock();
  notifyTrack();
  notifyPlay();
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
        applySavedTrackThenMaybePlay();
      });
      widget.bind(window.SC!.Widget.Events.PLAY, () => {
        applyWidgetVolume();
        refreshDuration();
        refreshTrackMeta();
        if (wantPlaying) notifyPlay();
      });
      widget.bind(window.SC!.Widget.Events.PAUSE, () => {
        notifyPlay();
      });
      widget.bind(window.SC!.Widget.Events.PLAY_PROGRESS, (data) => {
        if (!wantPlaying || musicVolume <= 0 || !widget) return;
        const pos = data?.currentPosition ?? 0;
        const rel = data?.relativePosition ?? 0;
        if (trackDurationMs > 0 && pos >= trackDurationMs - LOOP_LEAD_MS) {
          restartLoop();
          return;
        }
        if (trackDurationMs <= 0 && rel >= 0.985) restartLoop();
      });
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
  persistWantPlay();
  notifyPlay();
  if (musicVolume <= 0) return;
  const w = await ensureWidget();
  if (!w || !ready) return;
  applyWidgetVolume();
  w.play();
  window.setTimeout(() => applyWidgetVolume(), 100);
  window.setTimeout(() => applyWidgetVolume(), 350);
  refreshDuration();
  refreshTrackMeta();
}

export function stopBgm(opts?: { persist?: boolean }) {
  wantPlaying = false;
  if (opts?.persist !== false) persistWantPlay();
  notifyPlay();
  widget?.pause();
}

/** Pause without changing the user’s play preference (e.g. mid-match sting). */
export function pauseBgmSoft() {
  widget?.pause();
  notifyPlay();
}

export async function restartBgm() {
  wantPlaying = true;
  persistWantPlay();
  notifyPlay();
  if (musicVolume <= 0) return;
  const w = await ensureWidget();
  if (!w || !ready) return;
  applyWidgetVolume();
  w.seekTo(0);
  w.play();
  window.setTimeout(() => applyWidgetVolume(), 80);
}

export function toggleBgm(): boolean {
  if (wantPlaying && musicVolume > 0) {
    stopBgm();
    return false;
  }
  void startBgm();
  return true;
}

export function isBgmPlaying(): boolean {
  return wantPlaying && musicVolume > 0;
}

async function changeTrack(dir: 1 | -1) {
  const w = await ensureWidget();
  if (!w || !ready) return getTrackLabel();
  trackDurationMs = 0;
  if (dir > 0) w.next();
  else w.prev();
  window.setTimeout(() => {
    refreshTrackMeta();
    refreshDuration();
    applyWidgetVolume();
    if (wantPlaying && musicVolume > 0) {
      w.play();
      window.setTimeout(() => applyWidgetVolume(), 80);
    }
  }, 150);
  return getTrackLabel();
}

export async function nextBgmTrack() {
  return changeTrack(1);
}

export async function prevBgmTrack() {
  return changeTrack(-1);
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
      notifyPlay();
      return;
    }

    if (prev <= 0 && wantPlaying) {
      applyWidgetVolume();
      notifyPlay();
      if (ready) {
        w.play();
        window.setTimeout(() => applyWidgetVolume(), 80);
        window.setTimeout(() => applyWidgetVolume(), 250);
      }
      return;
    }

    applyWidgetVolume();
    notifyPlay();
    if (!wantPlaying || !ready) return;

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

export function isBgmWanted(): boolean {
  return wantPlaying;
}
