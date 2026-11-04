"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  QianzaiMusicOwner,
  type QianzaiMusicTrack,
  type QianzaiMusicState,
} from "./music-owner";

type Music = Readonly<{
  state: QianzaiMusicState;
  toggle(): void;
  label: string;
}>;
const MusicContext = createContext<Music | null>(null);
export const useQianzaiMusic = () => useContext(MusicContext);

/** This provider sits outside the image-lease-keyed experience, so an entry ->
 * report transition keeps one audio element. No controller or business event is owned here. */
export function QianzaiMusicProvider({
  children,
  track,
  enabled,
}: {
  children: ReactNode;
  track: QianzaiMusicTrack;
  enabled: boolean;
}) {
  const owner = useMemo(() => new QianzaiMusicOwner(track), [track]);
  useEffect(() => (enabled ? owner.attach() : undefined), [owner, enabled]);
  const state = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getServerSnapshot,
  );
  const value = useMemo(
    () =>
      enabled
        ? {
            state,
            toggle: owner.toggle,
            label:
              state.phase === "playing"
                ? "暂停背景音乐"
                : state.phase === "loading"
                  ? "取消音乐加载"
                  : "播放背景音乐",
          }
        : null,
    [enabled, state, owner],
  );
  return (
    <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
  );
}
