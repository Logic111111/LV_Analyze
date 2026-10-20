export default function AboutPage() {
  return (
    <div className="card">
      <h2>About this deployment</h2>
      <p className="hint">
        Feeder Island is a small full-stack app: a React frontend (this UI), an Express/JS API, and a MySQL
        database. The load-flow engine (backward-forward sweep, transformer impedance, reverse-power handling)
        runs entirely in your browser — the server's job is authentication and storing your designs.
      </p>
      <div className="note">
        <b>Accounts &amp; designs.</b> Each design (network topology, loads, PV, curves, settings) is saved to
        MySQL under your account, scoped by a signed-in session (httpOnly JWT cookie). Only you can see or edit
        your own designs.
      </div>
      <div className="note">
        <b>AI Insights.</b> The "Get AI insights" button sends the design to this app's own server, which holds the
        Anthropic API key (never sent to your browser) and lets Claude run the app's engine tools on it — load flows,
        the 24 h scan and the advisors. The brief lists every tool it ran; suggested changes open as previews and are
        never applied or saved by the AI.
      </div>
      <div className="note">
        <b>Export / Import JSON.</b> Use these on the Designs page to back up a design outside the database,
        move it between accounts, or hand it to a colleague.
      </div>
      <div className="note">
        <b>Deploying this yourself.</b> See the project README for setup: create the MySQL schema, configure
        <code> server/.env</code>, run the API (<code>npm start</code> in <code>server/</code>), then build and
        serve the React app (<code>npm run build</code> in <code>client/</code>) behind your web server of
        choice, with <code>/api</code> proxied to the Express process. Put both behind HTTPS in production.
      </div>
    </div>
  );
}
