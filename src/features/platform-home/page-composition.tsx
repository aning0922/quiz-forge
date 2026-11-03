import { PlatformHome, type PlatformHomeView } from "./platform-home";
import { PlatformAccessForm } from "./access-form";
import { QianzaiPublicEntry } from "./qianzai-public-entry";
const assets = Object.freeze({
  home: "/platform-art/home",
  qian: "/platform-art/qian",
  heart: "/platform-art/heart",
  cat: "/platform-art/cat",
  cover: "/platform-art/cover",
});
export function PlatformPage({ view = "home" }: { view?: PlatformHomeView }) {
  return (
    <PlatformHome
      assets={assets}
      qianzaiHref="/works/qianzai-tongxin"
      initialView={view}
      redemptionForm={<PlatformAccessForm />}
    />
  );
}
export function PlatformWorkCover() {
  return (
    <QianzaiPublicEntry
      assets={assets}
      homeHref="/"
      redemptionForm={<PlatformAccessForm />}
    />
  );
}
