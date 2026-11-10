import { Component, type ReactNode } from "react";

// If something in the UI throws while rendering, show a calm card with a reload
// button instead of a blank white page. Your work is saved on the server either way.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("Tandem UI error:", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <div className="crash__card">
          <p className="eyebrow">Something slipped</p>
          <h1>That page tripped over a rock.</h1>
          <p>Your files, chat and AI runs are saved, so nothing is lost. Reloading usually fixes it.</p>
          <div className="crash__actions">
            <button className="btn btn--primary" onClick={() => location.reload()}>Reload</button>
            <a className="btn btn--ghost" href="#/" onClick={() => setTimeout(() => location.reload(), 0)}>Go to Home</a>
          </div>
          <details><summary>Details</summary><pre>{String(this.state.error.message).slice(0, 400)}</pre></details>
        </div>
      </div>
    );
  }
}
