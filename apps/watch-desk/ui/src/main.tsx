import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
// App-owned CSS follows the browser's color preference without a forced data-theme.
// App Shell authors and reviews both modes; an explicit app setting can override it.
// Preserve the AuthGate, identity, and provider boundaries when changing presentation.

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
);
