import React from "react";
import ReactDOM from "react-dom/client";

async function bootstrap() {
  const isWeb = import.meta.env.VITE_APP_RUNTIME === "web";
  const [{ default: RootApp }] = await Promise.all([
    isWeb ? import("./WebApp") : import("./App"),
    isWeb ? Promise.resolve() : import("./styles.css"),
  ]);

  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>,
  );
}

bootstrap();
