import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Expose platform as a CSS class so styles can adapt (e.g. .platform-win32)
if (window.piApp?.platform) {
  document.body.classList.add(`platform-${window.piApp.platform}`);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
