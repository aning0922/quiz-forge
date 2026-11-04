export type QianzaiMusicTrack = Readonly<{
  id: string;
  version: string;
  url: `/qianzai-test-audio/${string}/${string}`;
  mediaType: "audio/mp4";
  durationSeconds: number;
  bytes: number;
  sha256: string;
}>;
export type QianzaiMusicState = Readonly<{
  phase: "off" | "loading" | "playing" | "paused" | "error";
  message: string;
}>;
const initial: QianzaiMusicState = Object.freeze({
  phase: "off",
  message: "点击开启背景音乐",
});

/** Public decorative test audio has a page lifetime, independent of image leases.
 * User intent is not proof of playback. Native events own the playing state. */
export class QianzaiMusicOwner {
  #state = initial;
  #listeners = new Set<() => void>();
  #audio: HTMLAudioElement | undefined;
  #live = false;
  #intent = false;
  #generation = 0;
  #removeMediaListeners: (() => void) | undefined;
  constructor(
    readonly track: QianzaiMusicTrack,
    readonly createAudio: () => HTMLAudioElement = () => new Audio(),
    readonly page?: Document,
    readonly browser?: Window,
  ) {}
  get #document() {
    return this.page ?? document;
  }
  get #window() {
    return this.browser ?? window;
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  getSnapshot = () => this.#state;
  getServerSnapshot = () => initial;
  #publish(phase: QianzaiMusicState["phase"], message: string) {
    this.#state = Object.freeze({ phase, message });
    for (const listener of this.#listeners) listener();
  }
  attach = () => {
    this.#live = true;
    const hidden = () => {
      if (this.#document.hidden) {
        this.pause("页面已隐藏，背景音乐已暂停");
        this.#releaseAudio();
      }
    };
    const leaving = () => {
      this.pause("背景音乐已暂停");
      this.#releaseAudio();
    };
    this.#document.addEventListener("visibilitychange", hidden);
    this.#window.addEventListener("pagehide", leaving);
    return () => {
      this.#live = false;
      this.#intent = false;
      this.#generation++;
      this.#document.removeEventListener("visibilitychange", hidden);
      this.#window.removeEventListener("pagehide", leaving);
      this.#releaseAudio();
      this.#publish("off", "点击开启背景音乐");
    };
  };
  #releaseAudio() {
    const audio = this.#audio;
    this.#audio = undefined;
    this.#removeMediaListeners?.();
    this.#removeMediaListeners = undefined;
    if (audio) {
      audio.muted = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }
  #player() {
    if (this.#audio) return this.#audio;
    const audio = this.createAudio();
    audio.preload = "none";
    audio.loop = true;
    audio.volume = 0.6;
    audio.muted = true;
    audio.src = this.track.url;
    const playing = () => {
      if (!this.#live || !this.#intent || this.#document.hidden) {
        audio.muted = true;
        audio.pause();
        return;
      }
      if (!audio.paused && !audio.muted)
        this.#publish("playing", "背景音乐播放中");
    };
    const waiting = () => {
      if (this.#live && this.#intent)
        this.#publish("loading", "正在准备背景音乐");
    };
    const paused = () => {
      if (this.#live && this.#intent && audio.paused) {
        this.#intent = false;
        this.#generation++;
        audio.muted = true;
        this.#publish("paused", "背景音乐已暂停");
      }
    };
    const failed = () => {
      if (!this.#live || !this.#intent) return;
      this.#intent = false;
      this.#generation++;
      audio.muted = true;
      audio.pause();
      this.#publish("error", "音轨暂不可播放，请点击重试");
    };
    const ended = () => this.pause("背景音乐已暂停");
    const events = { playing, waiting, pause: paused, error: failed, ended };
    for (const [event, listener] of Object.entries(events))
      audio.addEventListener(event, listener);
    this.#removeMediaListeners = () => {
      for (const [event, listener] of Object.entries(events))
        audio.removeEventListener(event, listener);
    };
    this.#audio = audio;
    return audio;
  }
  pause = (message = "背景音乐已暂停") => {
    this.#intent = false;
    this.#generation++;
    if (this.#audio) {
      this.#audio.muted = true;
      this.#audio.pause();
    }
    this.#publish("paused", message);
  };
  toggle = () => {
    if (!this.#live) return;
    if (this.#intent) {
      this.pause();
      return;
    }
    if (this.#document.hidden) {
      this.pause("页面已隐藏，请返回页面后点击播放");
      return;
    }
    const generation = ++this.#generation;
    this.#intent = true;
    this.#publish("loading", "正在准备背景音乐");
    let audio: HTMLAudioElement | undefined;
    try {
      audio = this.#player();
      audio.muted = false;
      // Called synchronously by the button gesture; no fetch/decode await can
      // consume transient activation before the browser receives play().
      const pending = audio.play();
      void Promise.resolve(pending).then(
        () => {
          if (this.#audio !== audio) {
            audio!.muted = true;
            audio!.pause();
            return;
          }
          if (!this.#live || !this.#intent || this.#document.hidden) {
            audio!.muted = true;
            audio!.pause();
          }
        },
        (error: unknown) => {
          if (!this.#live || this.#generation !== generation || !this.#intent)
            return;
          this.#intent = false;
          this.#generation++;
          audio!.muted = true;
          audio!.pause();
          this.#publish(
            "error",
            error instanceof Error && error.name === "NotAllowedError"
              ? "浏览器未允许播放，请再次点击音乐按钮"
              : "音轨暂不可播放，请点击重试",
          );
        },
      );
    } catch {
      this.#intent = false;
      audio?.pause();
      this.#publish("error", "当前浏览器无法播放背景音乐");
    }
  };
}
