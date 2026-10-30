import { createRoot } from "react-dom/client";
import { PlatformAccessForm } from "./access-form";
import {
  PlatformHome,
  type PlatformHomeView,
  type PlatformHomeAssets,
} from "./platform-home";
import { QianzaiPublicEntry } from "./qianzai-public-entry";

// Visual-only entry. Uses A's actual form; this server never grants access.
const assets: PlatformHomeAssets = new URLSearchParams(location.search).has(
  "missing",
)
  ? {}
  : {
      home: "/platform-art/home",
      qian: "/platform-art/qian",
      heart: "/platform-art/heart",
      cat: "/platform-art/cat",
      cover: "/platform-art/cover",
    };
const pathname = location.pathname;
const initialView: PlatformHomeView =
  pathname === "/my"
    ? "mine"
    : pathname === "/search"
      ? "search"
      : pathname === "/works/heart"
        ? "heart"
        : pathname === "/works/cat"
          ? "cat"
          : pathname === "/works"
            ? "catalog"
            : "home";
createRoot(document.getElementById("root")!).render(
  pathname === "/works/qianzai-tongxin" ? (
    <QianzaiPublicEntry
      assets={assets}
      redemptionForm={<PlatformAccessForm />}
    />
  ) : (
    <PlatformHome
      assets={assets}
      initialView={initialView}
      qianzaiHref="/works/qianzai-tongxin"
      redemptionForm={<PlatformAccessForm />}
    />
  ),
);
