export default function Privacy() {
  return (
    <div className="privacy">
      <header className="privacy__header">
        <a href="#/">← Tandem</a>
      </header>
      <article className="privacy__article">
        <h1>Privacy, in plain words</h1>

        <section>
          <h2>What Tandem is</h2>
          <p>Tandem is a shared workspace. The AI runs on each person&apos;s own Claude or ChatGPT subscription.</p>
        </section>

        <section>
          <h2>Your AI login</h2>
          <p>When you connect Claude or ChatGPT, the login token is stored only inside your own private sandbox on our server: a separate Linux user that other people&apos;s agents can&apos;t read. We never see your password. Prompts you send are billed to your own plan. You can reconnect or disconnect any time in Settings.</p>
        </section>

        <section>
          <h2>What&apos;s shared in a workspace</h2>
          <p>Files, prompts, AI replies, chat, and the AI&apos;s browser view are visible to everyone in that workspace, and to anyone who has its share link (read-only). Reset the link in Workspace settings to cut off old links.</p>
        </section>

        <section>
          <h2>The AI&apos;s browser</h2>
          <p>Each run gets a fresh, logged-out browser. It can&apos;t reach private networks.</p>
        </section>

        <section>
          <h2>What we store</h2>
          <ul>
            <li>Your account email and name</li>
            <li>Workspace contents and run history</li>
          </ul>
          <p>No ads, no selling data, and no training on your data by us. The AI providers&apos; own policies apply to prompts you send them.</p>
        </section>

        <section>
          <h2>Deleting things</h2>
          <p>The workspace owner can delete a workspace, which removes its files, chat, and history.</p>
        </section>

        <section>
          <h2>Contact</h2>
          <p><a href="mailto:siddharthdbobba@gmail.com">siddharthdbobba@gmail.com</a></p>
        </section>

        <p className="privacy__updated">Last updated: November 2026.</p>
      </article>
    </div>
  );
}
