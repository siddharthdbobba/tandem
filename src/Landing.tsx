// Public landing page, shown to signed-out visitors at #/.
const GITHUB = "https://github.com/siddharthdbobba/tandem";

// Condensed from convex/worker.ts, as [className, text] tokens for highlighting.
const CLAIM: [string, string][] = [
  ["tk-c", "// Mutations are transactions: a run can't be claimed twice.\n"],
  ["tk-k", "export const"], ["", " claim = "], ["tk-f", "mutation"], ["", "({\n  "],
  ["tk-k", "async"], ["", " handler(ctx, { runId }) {\n    "],
  ["tk-k", "const"], ["", " run = "], ["tk-k", "await"], ["", " ctx.db."], ["tk-f", "get"], ["", "(runId);\n    "],
  ["tk-k", "if"], ["", " (run?.status !== "], ["tk-s", '"queued"'], ["", ") "], ["tk-k", "return null"], ["", ";\n    "],
  ["tk-k", "const"], ["", " me = "], ["tk-k", "await"], ["", " "], ["tk-f", "getProfile"], ["", "(ctx, run.userId);\n    "],
  ["tk-k", "await"], ["", " ctx.db."], ["tk-f", "patch"], ["", "(runId, { status: "], ["tk-s", '"running"'], ["", " });\n    "],
  ["tk-c", "// bill the person who typed it\n    "],
  ["tk-k", "return"], ["", " { run, sandboxKey: me.sandboxKey, provider: me.provider };\n  },\n});"],
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <a href="#/" className="brand" aria-label="Tandem home">
          <span className="brand__mark" aria-hidden="true" />
          Tandem
        </a>
        <nav className="lp-nav__right" aria-label="Account">
          <a href="#/signin" className="lp-nav__link">Sign in</a>
          <a href="#/signup" className="btn btn--primary">Create account</a>
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero__copy">
            <p className="eyebrow"><span className="eyebrow__tick" aria-hidden="true" />Multiplayer coding agent</p>
            <h1 className="lp-hero__title">Code with agents, together.</h1>
            <p className="lp-hero__lede">
              Tandem gives your group one shared folder. Everyone opens prompt panes on it, watches
              every agent work in real time, and edits the files it writes. Your prompts run on your
              own Claude or ChatGPT subscription.
            </p>
            <div className="lp-hero__ctas">
              <a href="#/signup" className="btn btn--primary btn--lg">Start a workspace</a>
              <a href={GITHUB} className="textlink" target="_blank" rel="noreferrer">Read the code ↗</a>
            </div>
          </div>
          <HeroShot />
        </section>

        <section className="lp-band" aria-labelledby="how">
          <div className="lp-band__inner">
            <div className="lp-band__copy">
              <h2 id="how" className="lp-h2 lp-h2--light">What happens when you hit Send</h2>
              <ol className="steps">
                <li>
                  <span className="steps__n">1</span>
                  <div>
                    <h3>Your prompt becomes a row</h3>
                    <p>Convex stores it as a queued run tied to your account. Everyone in the workspace sees it appear instantly.</p>
                  </div>
                </li>
                <li>
                  <span className="steps__n">2</span>
                  <div>
                    <h3>A worker claims it</h3>
                    <p>A transaction hands it to exactly one worker, which runs Jcode as your own sandboxed Linux user, on your subscription.</p>
                  </div>
                </li>
                <li>
                  <span className="steps__n">3</span>
                  <div>
                    <h3>Output streams back</h3>
                    <p>Each message, command and file edit lands as it happens. Files sync to the shared folder both ways.</p>
                  </div>
                </li>
              </ol>
            </div>
            <figure className="codecard" aria-label="The Convex mutation that claims a run">
              <figcaption className="codecard__name">convex/worker.ts</figcaption>
              <pre className="codecard__body"><code>{CLAIM.map(([cls, text], i) =>
                cls ? <span key={i} className={cls}>{text}</span> : text,
              )}</code></pre>
            </figure>
          </div>
        </section>

        <section className="lp-yours" aria-labelledby="yours">
          <h2 id="yours" className="lp-h2">Shared folder. Separate everything else.</h2>
          <dl className="yours">
            <div>
              <dt>Your subscription</dt>
              <dd>Connect Claude or ChatGPT once in Settings. Your prompts bill to you, never to whoever owns the workspace, and the login stays in your sandbox.</dd>
            </div>
            <div>
              <dt>Your sandbox</dt>
              <dd>Every account runs as its own Linux user. Its agent can't read anyone else's login or open a workspace it hasn't joined.</dd>
            </div>
            <div>
              <dt>Your settings</dt>
              <dd>Name, color, default subscription and model are saved to your account and follow you to any device.</dd>
            </div>
            <div>
              <dt>Your own context</dt>
              <dd>Each person keeps their own conversation in every pane, so follow-ups pick up where you left off.</dd>
            </div>
          </dl>
        </section>

        <section className="lp-cta" aria-labelledby="start">
          <h2 id="start" className="lp-h2">Open a folder and invite someone.</h2>
          <p>Create an account, start a workspace, then send the invite link to whoever you're building with.</p>
          <div className="lp-hero__ctas">
            <a href="#/signup" className="btn btn--primary btn--lg">Start a workspace</a>
            <a href="#/signin" className="textlink">I have an account</a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <p>
          Tandem <span aria-hidden="true">·</span> built on Convex and Jcode by Sid Bobba{" "}
          <span aria-hidden="true">·</span>{" "}
          <a href={GITHUB} target="_blank" rel="noreferrer">Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}

// An illustration of a real workspace, built from the app's own components.
// Outputs shown are from an actual Tandem run.
function HeroShot() {
  return (
    <figure className="shot" aria-label="Two people prompting in one Tandem workspace">
      <div className="shot__bar">
        <span className="shot__ws">trail-weather</span>
        <span className="shot__people" aria-hidden="true">
          <i className="shot__av shot__av--a">M</i>
          <i className="shot__av shot__av--b">J</i>
        </span>
      </div>
      <div className="shot__body">
        <ul className="shot__files" aria-label="Files">
          <li className="shot__dir">weather/</li>
          <li className="shot__file is-new">forecast.py</li>
          <li className="shot__dir">tests/</li>
          <li className="shot__file is-new">test_forecast.py</li>
          <li className="shot__file">README.md</li>
        </ul>
        <div className="shot__pane">
          <p className="shot__head">Main <i className="shot__dot shot__dot--b" /></p>
          <p className="shot__prompt"><b>Maya</b> Estimate summit temp from trailhead elevation.</p>
          <p className="shot__billed">Maya's claude</p>
          <p className="shot__file-ev">write weather/forecast.py</p>
          <pre className="shot__cmd">$ python3 weather/forecast.py 5000 70{"\n"}52.5 F</pre>
          <p className="shot__msg">Done. A 5,000 ft summit is about 52.5 °F.</p>
        </div>
        <div className="shot__pane">
          <p className="shot__head">Tests <i className="shot__dot shot__dot--a" /></p>
          <p className="shot__prompt"><b>Jon</b> Write two tests for forecast.py and run them.</p>
          <p className="shot__billed">Jon's chatgpt</p>
          <p className="shot__file-ev">write tests/test_forecast.py</p>
          <pre className="shot__cmd">$ python3 tests/test_forecast.py{"\n"}2 tests passed</pre>
          <p className="shot__status"><span className="spin" aria-hidden="true" /> working</p>
        </div>
      </div>
    </figure>
  );
}
