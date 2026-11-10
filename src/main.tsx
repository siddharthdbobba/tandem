import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Landing from "./Landing";
import "./style.css";
import "./panel.css";
import "./palette.css";

// The app (Convex, auth, editor, markdown...) is loaded on demand. A first-time
// visitor on the landing page only downloads React and the landing itself.
const FullApp = lazy(() => import("./Boot"));

// Signed in before (Convex Auth keeps a JWT in localStorage), arriving from an
// OAuth redirect, or on any route other than the landing: start the app now.
const needsApp = () =>
  Object.keys(localStorage).some((k) => k.startsWith("__convexAuthJWT")) ||
  new URLSearchParams(location.search).has("code") ||
  !["", "#", "#/"].includes(location.hash);

function Root() {
  const [app, setApp] = useState(needsApp);
  useEffect(() => {
    if (app) return;
    const on = () => { if (needsApp()) setApp(true); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [app]);
  if (!app) return <Landing />;
  return (
    <Suspense fallback={<div className="loading"><span className="spin" aria-hidden="true" /> Loading…</div>}>
      <FullApp />
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
