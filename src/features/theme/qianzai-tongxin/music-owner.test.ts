import { describe, expect, it, vi } from "vitest";
import { QianzaiMusicOwner, type QianzaiMusicTrack } from "./music-owner";
const track: QianzaiMusicTrack = {
  id: "synthetic-track",
  version: "1.0.0",
  url: "/qianzai-test-audio/synthetic-track/1.0.0",
  mediaType: "audio/mp4",
  durationSeconds: 64,
  bytes: 24,
  sha256: "a".repeat(64),
};
class Media extends EventTarget {
  src = "";
  preload = "auto";
  loop = false;
  volume = 1;
  muted = false;
  paused = true;
  currentTime = 0;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  load = vi.fn();
  removeAttribute = vi.fn(() => {
    this.src = "";
  });
  playing() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
}
function fixture() {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const browser = new EventTarget();
  const media = new Media();
  const create = vi.fn(() => media as unknown as HTMLAudioElement);
  const owner = new QianzaiMusicOwner(
    track,
    create,
    page as unknown as Document,
    browser as unknown as Window,
  );
  const detach = owner.attach();
  return { page, browser, media, create, owner, detach };
}
describe("page-owned background music", () => {
  it("does not create or preload audio until a gesture and waits for real playing", async () => {
    const f = fixture();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.owner.getSnapshot().phase).toBe("off");
    f.owner.toggle();
    expect(f.media.play).toHaveBeenCalledOnce();
    expect(f.media.preload).toBe("none");
    expect(f.media.loop).toBe(true);
    expect(f.owner.getSnapshot().phase).toBe("loading");
    await Promise.resolve();
    expect(f.owner.getSnapshot().phase).toBe("loading");
    f.media.playing();
    expect(f.owner.getSnapshot().phase).toBe("playing");
    f.media.currentTime = 12;
    f.owner.toggle();
    expect(f.media.muted).toBe(true);
    expect(f.media.paused).toBe(true);
    expect(f.owner.getSnapshot().phase).toBe("paused");
    f.owner.toggle();
    f.media.playing();
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.media.currentTime).toBe(12);
    f.detach();
    expect(f.media.src).toBe("");
    expect(f.media.load).toHaveBeenCalledOnce();
  });
  it("reports browser refusal and only retries on another explicit gesture", async () => {
    const f = fixture();
    f.media.play.mockRejectedValueOnce(
      Object.assign(new Error("blocked"), { name: "NotAllowedError" }),
    );
    f.owner.toggle();
    await Promise.resolve();
    expect(f.owner.getSnapshot()).toEqual({
      phase: "error",
      message: "浏览器未允许播放，请再次点击音乐按钮",
    });
    expect(f.media.play).toHaveBeenCalledOnce();
    f.owner.toggle();
    f.media.playing();
    await Promise.resolve();
    expect(f.media.play).toHaveBeenCalledTimes(2);
    expect(f.owner.getSnapshot().phase).toBe("playing");
    f.detach();
  });
  it("pauses while hidden without auto-resuming and invalidates a late play", async () => {
    const f = fixture();
    let finish!: () => void;
    f.media.play.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    f.owner.toggle();
    f.page.hidden = true;
    f.page.dispatchEvent(new Event("visibilitychange"));
    finish();
    await Promise.resolve();
    f.media.playing();
    expect(f.media.src).toBe("");
    expect(f.media.muted).toBe(true);
    expect(f.owner.getSnapshot().phase).toBe("paused");
    f.page.hidden = false;
    f.page.dispatchEvent(new Event("visibilitychange"));
    expect(f.media.play).toHaveBeenCalledOnce();
    f.owner.toggle();
    f.media.playing();
    expect(f.owner.getSnapshot().phase).toBe("playing");
    f.detach();
  });
  it("does not let an older play completion stop a newer valid gesture", async () => {
    const f = fixture();
    let finish!: () => void;
    f.media.play.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    f.owner.toggle();
    f.owner.toggle();
    f.owner.toggle();
    f.media.playing();
    finish();
    await Promise.resolve();
    expect(f.media.paused).toBe(false);
    expect(f.owner.getSnapshot().phase).toBe("playing");
    f.detach();
  });
  it("releases on navigation or unmount and cannot revive after detach", async () => {
    const f = fixture();
    let finish!: () => void;
    f.media.play.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    f.owner.toggle();
    f.browser.dispatchEvent(new Event("pagehide"));
    expect(f.media.src).toBe("");
    expect(f.owner.getSnapshot().phase).toBe("paused");
    f.detach();
    finish();
    await Promise.resolve();
    f.media.playing();
    expect(f.owner.getSnapshot().phase).toBe("off");
    expect(f.media.muted).toBe(true);
    expect(f.media.paused).toBe(false);
    f.owner.toggle();
    expect(f.media.play).toHaveBeenCalledOnce();
  });
  it("supports attach cleanup replay without retaining an old audio instance", () => {
    const f = fixture();
    f.detach();
    const detach = f.owner.attach();
    f.owner.toggle();
    f.media.playing();
    expect(f.owner.getSnapshot().phase).toBe("playing");
    detach();
  });
});

it("reloads a failed native media source only on an explicit retry", async () => {
  const f = fixture(),
    recovered = new Media();
  f.create
    .mockReturnValueOnce(f.media as unknown as HTMLAudioElement)
    .mockReturnValueOnce(recovered as unknown as HTMLAudioElement);
  f.owner.toggle();
  f.media.dispatchEvent(new Event("error"));
  expect(f.owner.getSnapshot().phase).toBe("error");
  expect(f.media.src).toBe("");
  expect(f.media.load).toHaveBeenCalledOnce();
  expect(f.create).toHaveBeenCalledOnce();
  f.owner.toggle();
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(recovered.src).toBe(track.url);
  expect(recovered.play).toHaveBeenCalledOnce();
  recovered.playing();
  await Promise.resolve();
  expect(f.owner.getSnapshot().phase).toBe("playing");
  expect(recovered.paused).toBe(false);
  f.detach();
});

it("recreates a source rejected as unsupported without waiting for a separate error event", async () => {
  const f = fixture(),
    recovered = new Media();
  f.media.play.mockRejectedValueOnce(
    Object.assign(new Error("bad media"), { name: "NotSupportedError" }),
  );
  f.create
    .mockReturnValueOnce(f.media as unknown as HTMLAudioElement)
    .mockReturnValueOnce(recovered as unknown as HTMLAudioElement);
  f.owner.toggle();
  await Promise.resolve();
  expect(f.owner.getSnapshot().phase).toBe("error");
  expect(f.media.src).toBe("");
  f.owner.toggle();
  recovered.playing();
  await Promise.resolve();
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(f.owner.getSnapshot().phase).toBe("playing");
  f.detach();
});
