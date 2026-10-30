import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PlatformAccessForm } from "@/features/platform-home/access-form";
function Harness() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    document.documentElement.dataset.ready = "true";
  }, []);
  return (
    <>
      <button id="toggle" onClick={() => setActive((v) => !v)}>
        切换显示
      </button>
      <PlatformAccessForm
        active={active}
        className="card"
        classNames={{
          label: "label",
          input: "input",
          message: "message",
          submit: "button",
          cancel: "button",
        }}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
