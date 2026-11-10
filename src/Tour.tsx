import { useState } from "react";

// A three-step welcome card shown the first time someone opens any workspace.
const steps = [
  { title: "Ask the AI below", body: "Type what you want in the prompt box. The AI reads and writes the files everyone here shares, and can browse the web." },
  { title: "Files are shared", body: "Everything the AI makes shows up on the left. Click a file to read or edit it. Every AI change can be undone." },
  { title: "Bring your people", body: "Copy the share link at the top to invite friends. Use Chat to talk, or type @ai there to hand the AI a task." },
];

export function Tour({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState(() => (localStorage.getItem("tandem-tour-done") ? -1 : 0));
  if (step < 0) return null;
  const done = () => { localStorage.setItem("tandem-tour-done", "1"); setStep(-1); onDone?.(); };
  const s = steps[step];
  return (
    <div className="tour" role="status" aria-label="Welcome tour">
      <span className="tour__num">{step + 1}/{steps.length}</span>
      <div className="tour__text">
        <strong>{s.title}</strong>
        <span>{s.body}</span>
      </div>
      <div className="tour__actions">
        <button className="btn btn--ghost btn--sm" onClick={done}>Skip</button>
        <button className="btn btn--sm" onClick={() => (step + 1 < steps.length ? setStep(step + 1) : done())}>
          {step + 1 < steps.length ? "Next" : "Got it"}
        </button>
      </div>
    </div>
  );
}
