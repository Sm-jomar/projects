import "./landing.css";
import { legionUrl, dndUrl } from "../lib/appRouting";

// The eslegion.com hub: pick a game, get sent to its subdomain.
export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-head">
        <h1>ESLegion</h1>
        <p className="muted">Tabletop companions — pick your game.</p>
      </header>

      <div className="landing-grid">
        <a className="landing-card legion" href={legionUrl()}>
          <div className="landing-card-body">
            <h2>Star Wars: Legion</h2>
            <p>Army builder, card reference, Tours of Duty, and a live tabletop with remote play.</p>
          </div>
          <div className="landing-card-go">Enter ▸</div>
        </a>

        <a className="landing-card dnd" href={dndUrl()}>
          <div className="landing-card-body">
            <h2>Dungeons &amp; Dragons</h2>
            <p>5e character sheets, DM notes, rulebooks, and a dungeon tabletop with multiplayer.</p>
          </div>
          <div className="landing-card-go">Enter ▸</div>
        </a>
      </div>

      <footer className="landing-foot muted small">
        eslegion.com
      </footer>
    </div>
  );
}
