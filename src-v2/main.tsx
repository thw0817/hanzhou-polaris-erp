import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router";
import * as Tooltip from "@radix-ui/react-tooltip";
import { App } from "./app/App";
import { queryClient } from "./app/query-client";
import { installBrowserDiagnostics, recordDiagnosticEvent } from "./lib/diagnostics.js";
import "./styles/app.css";

function DiagnosticCapture() {
  const location = useLocation();

  useEffect(() => installBrowserDiagnostics(), []);
  useEffect(() => {
    recordDiagnosticEvent({
      kind: "ui.route",
      path: location.pathname,
      module: location.pathname.split("/").filter(Boolean)[1] || "root",
      metadata: { searchPresent: Boolean(location.search) },
    });
  }, [location.pathname, location.search]);

  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={350}>
        <BrowserRouter>
          <DiagnosticCapture />
          <App />
        </BrowserRouter>
      </Tooltip.Provider>
    </QueryClientProvider>
  </React.StrictMode>,
);
