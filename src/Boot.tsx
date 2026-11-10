import { useEffect, useState } from "react";
import { ConvexReactClient, useConvexConnectionState } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";

// Default: the Convex backend is served from the same host on port 10000.
const url =
  import.meta.env.VITE_CONVEX_URL ?? `${location.protocol}//${location.hostname}:10000`;
const convex = new ConvexReactClient(url);

// Shown when the live connection has been down for a few seconds (laptop asleep,
// flaky Wi-Fi, server restart). Edits made meanwhile are queued and sent on reconnect.
function Offline() {
  const { isWebSocketConnected, hasEverConnected, inflightMutations } = useConvexConnectionState();
  const down = hasEverConnected && !isWebSocketConnected;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!down) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(t);
  }, [down]);
  if (!show) return null;
  return (
    <div className="offline" role="status">
      <span className="spin" aria-hidden="true" />
      Reconnecting… {inflightMutations > 0 ? `${inflightMutations} change${inflightMutations === 1 ? "" : "s"} will send when you're back online.` : "Your work is safe."}
    </div>
  );
}

// Everything that needs the backend. Loaded lazily from main.tsx.
export default function Boot() {
  return (
    <ConvexAuthProvider client={convex}>
      <Offline />
      <App />
    </ConvexAuthProvider>
  );
}
