import { useEffect, useRef, useState } from "react";
import type { AttackFx, AttackSeq } from "../lib/attack";
import { fxDuration, fxFrame, type FxFrame } from "../lib/attackFx";

/** A blaster show playing now: frame(now) for performance.now() times. */
export type FxPlay = { id: string; start: number; end: number; frame: (now: number) => FxFrame | null };

// Dev builds only: localStorage "legion.fxSlow" = 4 plays the show 4x
// slower, for checking it frame by frame.
const SLOW = import.meta.env.DEV ? Math.max(1, Number(localStorage.getItem("legion.fxSlow")) || 1) : 1;

function playOf(id: string, fx: AttackFx): FxPlay {
  const start = performance.now();
  const end = start + fxDuration(fx, id) * SLOW;
  return { id, start, end, frame: (now) => (now > end ? null : fxFrame(fx, id, (now - start) / SLOW)) };
}

// Plays each attack's effects once, when it finishes (on every client, as
// the board arrives). An attack that was already done when the board
// loaded doesn't play; replay() shows the last one again.
export function useAttackFx(a: AttackSeq | null | undefined): { play: FxPlay | null; replay: () => void } {
  const seen = useRef<string | null | undefined>(undefined);
  const [play, setPlay] = useState<FxPlay | null>(null);
  const id = a?.stage === "done" && a.fx ? a.id : null;
  const fxRef = useRef(a?.fx);
  useEffect(() => { fxRef.current = a?.fx; });

  useEffect(() => {
    if (seen.current === undefined) { seen.current = id; return; }
    if (!id || id === seen.current || !fxRef.current) return;
    seen.current = id;
    const p = playOf(id, fxRef.current);
    setPlay(p);
  }, [id]);

  useEffect(() => {
    if (!play) return;
    const t = setTimeout(() => setPlay((cur) => (cur === play ? null : cur)), play.end - performance.now() + 50);
    return () => clearTimeout(t);
  }, [play]);

  return {
    play,
    replay: () => { if (a?.fx && a.stage === "done") setPlay(playOf(a.id, a.fx)); },
  };
}

/** Re-renders every animation frame while a show plays; returns its frame. */
export function useFxFrame(play: FxPlay | null | undefined): FxFrame | null {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!play) return;
    let raf = 0;
    const loop = () => {
      const t = performance.now();
      setNow(t);
      if (t <= play.end) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [play]);
  return play && now >= play.start ? play.frame(now) : null;
}
