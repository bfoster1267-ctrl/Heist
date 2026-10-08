import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installAppShell } from "./appShell";
import { installTracking } from "./track";
import "./fonts/fonts.css";
import "./styles.css";

installAppShell();
installTracking();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
