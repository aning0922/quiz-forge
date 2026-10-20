import { createRoot } from "react-dom/client";
import { ConsumerAccessV1 } from "@/features/theme/consumer-v1/access";
createRoot(document.getElementById("root")!).render(
  location.pathname === "/access" ? (
    <ConsumerAccessV1 />
  ) : (
    <main>Safe synthetic previous document.</main>
  ),
);
