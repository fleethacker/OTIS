import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeObserver } from "./components/theme-observer";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { initializeTheme } from "./theme";
import "./fonts.css";

initializeTheme();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeObserver />
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
);
