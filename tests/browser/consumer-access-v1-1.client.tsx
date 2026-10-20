import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { ConsumerAccessV1_1 } from "@/features/theme/consumer-v1-1/access";
const content = <ConsumerAccessV1_1 />;
window.accessLifecycleProbe.beforeHydration?.();
hydrateRoot(
  document.getElementById("root")!,
  document.documentElement.dataset.strict === "true" ? (
    <StrictMode>{content}</StrictMode>
  ) : (
    content
  ),
);
