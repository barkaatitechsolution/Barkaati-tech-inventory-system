import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { initTheme } from "./lib/theme.js";
import { configureStatusBar, configureViewport } from "./lib/statusBar.js";
import "./theme.css";
import "./index.css";

initTheme();
configureStatusBar();
configureViewport();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
