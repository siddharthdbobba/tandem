import { BuildIcon, Contours, PeakMark, RidgeDivider, Ridges, SchoolIcon, TripIcon, WorkspaceMock } from "./art";
import type { ReactNode } from "react";

const GITHUB = "https://github.com/siddharthdbobba/tandem";

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <a href="#/" className="brand" aria-label="Tandem home"><PeakMark />Tandem</a>
        <nav className="lp-nav__right" aria-label="Account">
          <a href="#/signin" className="lp-nav__link">Sign in</a>
          <a href="#/signup" className="btn btn--primary">Get started</a>
        </nav>
      </header>
      <main>
        <section className="lp-hero">
          <Contours className="lp-hero__contours" />
          <div className="lp-hero__copy">
            <p className="eyebrow"><span className="eyebrow__tick" aria-hidden="true" />For trips, projects and side quests</p>
            <h1 className="lp-hero__title">Your group&apos;s shared AI workspace.</h1>
            <p className="lp-hero__lede">Plan the trip, finish the project, build the thing, together. The AI researches, writes and builds while everyone watches and chimes in. It runs on the Claude or ChatGPT plan you already have.</p>
            <div className="lp-hero__ctas"><a href="#/signup" className="btn btn--primary btn--lg">Start a workspace, it&apos;s free</a><a href="#how-it-works" className="textlink" onClick={(e) => { e.preventDefault(); document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" }); }}>See how it works</a></div>
          </div>
          <WorkspaceMock />
        </section>
        <Ridges className="lp-ridges" />
        <section className="lp-section lp-uses" aria-labelledby="uses"><p className="eyebrow">Made for small groups</p><h2 id="uses" className="lp-h2">One space for the plans you make together.</h2><div className="use-grid">
          <Use icon={<TripIcon />} title="Plan a group trip" text="Routes, packing lists, and the details nobody wants to lose in a group chat." />
          <Use icon={<SchoolIcon />} title="School & group projects" text="Research, drafts, and shared notes with everyone looking at the same thing." />
          <Use icon={<BuildIcon />} title="Build an app together" text="Give the AI a task, watch it work, then steer it with your friends." />
        </div></section>
        <section id="how-it-works" className="lp-section lp-how" aria-labelledby="how"><p className="eyebrow">How it works</p><h2 id="how" className="lp-h2">Get everyone on the same trail.</h2><ol className="steps">
          <li><span className="steps__n">01</span><div><h3>Create a workspace</h3><p>Start with a shared home for files, notes, and the work in progress.</p></div></li>
          <li><span className="steps__n">02</span><div><h3>Share the link with friends</h3><p>Anyone can open it to watch live. Signing up lets them jump in.</p></div></li>
          <li><span className="steps__n">03</span><div><h3>Ask the AI together</h3><p>Everyone sees it work live and can guide it mid-task.</p></div></li>
        </ol></section>
        <section className="lp-section lp-features" aria-label="Workspace features"><div>Shared files &amp; docs <span>PDFs, images, notes</span></div><div>A browser the AI drives <span>Everyone can watch</span></div><div>Claude or ChatGPT <span>Switch models anytime</span></div><div>Steer mid-task <span>Jump in when it matters</span></div></section>
        <section className="lp-cta" aria-labelledby="cta">
          <h2 id="cta" className="lp-h2">Round up your crew.</h2>
          <p>Start a workspace in a minute, then send the link. No new AI bill: it runs on the Claude or ChatGPT plan you already have.</p>
          <a href="#/signup" className="btn btn--primary btn--lg">Start a workspace</a>
          <p className="lp-cta__fine">Your AI login stays in a private sandbox only your prompts use. <a href="#/privacy">Privacy</a></p>
        </section>
      </main>
      <footer className="lp-foot"><RidgeDivider /><div><span className="brand"><PeakMark />Tandem</span><nav aria-label="Footer"><a href="#/privacy">Privacy</a><a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a></nav></div></footer>
    </div>
  );
}

function Use({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <article className="use-card"><div className="use-card__icon">{icon}</div><h3>{title}</h3><p>{text}</p></article>;
}
