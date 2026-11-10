import { PeakMark } from "./art";

// User-facing "What's new". Short, plain words, newest first.
const releases: { date: string; items: string[] }[] = [
  {
    date: "November 10, 2026",
    items: [
      "Invite links open a welcome card: who invited you, who's in, and a one-tap join.",
      "\u201cWhile you were away\u201d shows what friends changed since your last visit.",
      "Chat: emoji reactions, replies, @mentions, polls, and a typing indicator.",
      "Templates for trips, school, study groups, events, side projects and apps.",
      "Every AI change can be undone, file by file, with a clear before/after.",
      "Paste from Google Docs into a notes file and the formatting comes along.",
      "Save any AI answer as a shared doc, or copy it with one click.",
      "\u201cAsk AI\u201d from any open file. Find a file fast once you have lots.",
      "Pick an icon for each workspace. Rename, share, leave or delete from Home.",
      "Publish a doc as a clean public page for the group chat.",
      "Works well on phones: share sheet, tap-to-react, tidier editor.",
      "If the AI server restarts, queued prompts say so and run automatically after.",
      "Faster first load, better contrast and labels for screen readers.",
    ],
  },
];

export default function WhatsNew() {
  return (
    <div className="page-plain">
      <a href="#/" className="brand"><PeakMark />Tandem</a>
      <main className="whatsnew">
        <p className="eyebrow">What's new</p>
        <h1>Fresh tracks</h1>
        {releases.map((r) => (
          <section key={r.date}>
            <h2>{r.date}</h2>
            <ul>{r.items.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        ))}
        <a href="#/" className="btn btn--primary">Back to Tandem</a>
      </main>
    </div>
  );
}
