import "./polyfills"; // must run first: shims for old Android WebViews (Chromium ~83)
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installViewportTracking } from "./ui/viewport";
import "./ui/tokens.css";
import "./ui/app.css";

// Track the visual viewport so the composer stays above the soft keyboard.
installViewportTracking();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
