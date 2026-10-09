import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installAppShell } from "./appShell";
import { OpenInBrowser, RotateGate, inAppBrowser, inAppWaved } from "./gates";
import { installTracking } from "./track";
import "./fonts/fonts.css";
import "./styles.css";

installAppShell();

// Opened inside Reddit, Instagram, Facebook or TikTok: send them to a real browser before an account is made
function Root() {
  const [app, setApp] = useState(() => (inAppWaved() ? null : inAppBrowser()));
  if (app) return <OpenInBrowser app={app} onAnyway={() => setApp(null)} />;
  return (
    <>
      <App />
      <RotateGate />
    </>
  );
}

installTracking();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
