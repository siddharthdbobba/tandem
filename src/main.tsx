import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import "./style.css";
import "./panel.css";
import "./palette.css";

// Default: the Convex backend is served from the same host on port 10000.
const url =
  import.meta.env.VITE_CONVEX_URL ?? `${location.protocol}//${location.hostname}:10000`;
const convex = new ConvexReactClient(url);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
);
