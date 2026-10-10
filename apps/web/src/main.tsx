import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installAppShell } from "./appShell";
import { OpenInBrowser, gatedInApp, inAppWaved } from "./gates";
import { installTracking } from "./track";
import { installTurn } from "./turn";
import "./fonts/fonts.css";
import "./styles.css";

installAppShell();
installTurn();

// Opened inside Instagram, Facebook or TikTok (not Reddit, whose browser plays fine): send them to a real browser before an account is made
function Root() {
  const [app, setApp] = useState(() => (inAppWaved() ? null : gatedInApp()));
  if (app) return <OpenInBrowser app={app} onAnyway={() => setApp(null)} />;
  return <App />;
}

installTracking();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
