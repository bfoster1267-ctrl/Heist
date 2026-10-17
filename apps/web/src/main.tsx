import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { onCrazyGames, startCrazyGames } from "./crazygames";
import { installAppShell } from "./appShell";
import { syncAlerts } from "./alerts";
import { OpenInBrowser, gatedInApp, inAppWaved } from "./gates";
import { installTracking } from "./track";
import { installTurn } from "./turn";
import "./fonts/fonts.css";
import "./styles.css";

installAppShell();
installTurn();
syncAlerts();

// Opened inside Instagram, Facebook or TikTok (not Reddit, whose browser plays fine): send them to a real browser before an account is made
function Root() {
  // (never on CrazyGames: their portal is the browser, and links out aren't allowed there)
  const [app, setApp] = useState(() => (inAppWaved() || onCrazyGames ? null : gatedInApp()));
  if (app) return <OpenInBrowser app={app} onAnyway={() => setApp(null)} />;
  return <App />;
}

installTracking();

// on CrazyGames their SDK starts first (it can bring an invite's table code); everywhere else this is instant
void startCrazyGames().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  ),
);
