import type { TabletopState } from "../lib/tabletop";
import {
  MISSIONS, SECONDARY_OBJECTIVES, isMissionPoi, mapVariantFor, missionById, missionPois, missionScaled,
  type Mission,
} from "../lib/missions";

const BASE = import.meta.env.BASE_URL;

// Board-setup picker for the Battle Card missions: choosing one shades its
// Territories and lays its Objective tokens where the Map Card shows them.
export function MissionSection({ state, onCommit }: {
  state: TabletopState;
  onCommit: (next: TabletopState) => void;
}) {
  const mission = missionById(state.mission);
  const square = state.map.widthInches === state.map.heightInches;

  function choose(m: Mission | null) {
    const tokens = state.tokens.filter((t) => !isMissionPoi(t));
    onCommit({
      ...state,
      mission: m?.id ?? null,
      tokens: m ? [...tokens, ...missionPois(m, state.map)] : tokens,
    });
  }

  const variant = mission ? mapVariantFor(mission, state.map) : null;
  const secondary = SECONDARY_OBJECTIVES.find((c) => c.name === state.secondary);

  return (
    <section className="tt-mission">
      <h3>Mission</h3>
      <p className="muted small">
        Battle Card objectives. Picking one shades both Territories and places its objective tokens as on the Map Card.
      </p>
      <div className="tt-faction-pills">
        <button className={"tt-faction-pill" + (!mission ? " active" : "")} onClick={() => choose(null)}>None</button>
        {MISSIONS.map((m) => (
          <button key={m.id}
                  className={"tt-faction-pill" + (mission?.id === m.id ? " active" : "")}
                  title={square && !m.maps.recon ? "No Recon map for this card; the 6' × 3' map is squeezed to fit" : m.setup}
                  onClick={() => choose(m)}>
            {m.name}{m.maps.recon ? " ◎" : ""}
          </button>
        ))}
      </div>
      <p className="muted small">◎ also has a 3' × 3' Recon map, used on square boards.</p>

      {mission && variant && (
        <div className="tt-mission-detail">
          <div className="tt-mission-cards">
            <a href={BASE + mission.card} target="_blank" rel="noreferrer">
              <img src={BASE + mission.card} alt={`${mission.name} objective card`} />
            </a>
            {mission.mapCard[variant] && (
              <a href={BASE + mission.mapCard[variant]} target="_blank" rel="noreferrer">
                <img src={BASE + mission.mapCard[variant]} alt={`${mission.name} map card`} />
              </a>
            )}
          </div>
          <p className="small"><b>Setup:</b> {mission.setup}</p>
          <p className="small"><b>Scoring:</b> {mission.scoring}</p>
          {mission.special && <p className="small"><b>Special:</b> {mission.special}</p>}
          <p className="muted small">
            {variant === "recon" ? "Recon map (3' × 3')." : "Standard map (6' × 3')."}
            {missionScaled(mission, state.map) && " This board is a different size, so positions are stretched to fit."}
            {" "}Blue's Territory is along the top edge; each grid square on the Map Card is Range 1 (6").
          </p>
          <button className="tt-palette-btn" onClick={() => choose(mission)}>Reset objective tokens</button>
        </div>
      )}

      <label className="tt-map-field">Secondary objective
        <select value={state.secondary ?? ""}
                onChange={(e) => onCommit({ ...state, secondary: e.target.value || null })}>
          <option value="">None</option>
          {SECONDARY_OBJECTIVES.map((c) => (
            <option key={c.name} value={c.name}>{c.name}{c.recon ? " ◎" : ""}</option>
          ))}
        </select>
      </label>
      {secondary && (
        <div className="tt-mission-cards">
          <a href={BASE + secondary.card} target="_blank" rel="noreferrer">
            <img src={BASE + secondary.card} alt={`${secondary.name} card`} />
          </a>
        </div>
      )}
    </section>
  );
}
