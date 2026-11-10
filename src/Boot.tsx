import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";

// Default: the Convex backend is served from the same host on port 10000.
const url =
  import.meta.env.VITE_CONVEX_URL ?? `${location.protocol}//${location.hostname}:10000`;
const convex = new ConvexReactClient(url);

// Everything that needs the backend. Loaded lazily from main.tsx.
export default function Boot() {
  return (
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  );
}
