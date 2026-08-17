// Voltage Wilds visual system: full-bleed tactical arena, corner-bound field instruments,
// Barlow Condensed urgency, DM Sans support copy, signal amber for player agency.
// React is the picture frame; Babylon and client/src/game/scene.ts own the game.

import { useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { createGameScene, type GameHandle, type HudState } from "@/game/scene";

const initialHud: HudState = {
  health: 100,
  shield: 3,
  remaining: 8,
  timer: 150,
  stormRadius: 19,
  toast: "SCANNING STORM CELL",
  matchState: "briefing",
  streak: 0,
  ammo: 12,
  reserve: 72,
  reloading: false,
  reloadProgress: 0,
  hitConfirm: false,
};

function timeLabel(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedRef = useRef(false);
  const fireIntervalRef = useRef<number | null>(null);
  const [hud, setHud] = useState<HudState>(initialHud);
  const [stick, setStick] = useState({ x: 0, y: 0 });
  const [aimStick, setAimStick] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || startedRef.current) return;
    startedRef.current = true;

    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });

    let handle: GameHandle | null = null;
    let alive = true;
    createGameScene(engine, canvas).then((created) => {
      if (!alive) {
        created.dispose();
        return;
      }
      handle = created;
      engine.runRenderLoop(() => created.scene.render());
    });

    const onResize = () => engine.resize();
    const onHud = (event: Event) => setHud((event as CustomEvent<HudState>).detail);
    window.addEventListener("resize", onResize);
    window.addEventListener("stormfall-hud", onHud);

    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("stormfall-hud", onHud);
      handle?.dispose();
      engine.dispose();
      startedRef.current = false;
    };
  }, []);

  const launch = () => window.dispatchEvent(new Event("stormfall-start"));
  const restart = () => window.dispatchEvent(new Event("stormfall-restart"));
  const sendMobileMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const max = bounds.width * 0.29;
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(dx, dy);
    const scale = distance > max ? max / distance : 1;
    const x = (dx * scale) / max;
    const y = (dy * scale) / max;
    setStick({ x: x * max, y: y * max });
    window.dispatchEvent(new CustomEvent("stormfall-mobile-move", { detail: { x, z: -y } }));
  };
  const resetMobileMove = () => {
    setStick({ x: 0, y: 0 });
    window.dispatchEvent(new CustomEvent("stormfall-mobile-move", { detail: { x: 0, z: 0 } }));
  };
  const sendMobileAim = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const max = bounds.width * 0.29;
    const dx = event.clientX - (bounds.left + bounds.width / 2);
    const dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(dx, dy);
    const scale = distance > max ? max / distance : 1;
    const x = (dx * scale) / max;
    const y = (dy * scale) / max;
    setAimStick({ x: x * max, y: y * max });
    window.dispatchEvent(new CustomEvent("stormfall-mobile-aim", { detail: { x, y } }));
  };
  const resetMobileAim = () => setAimStick({ x: 0, y: 0 });
  const startMobileFire = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.dispatchEvent(new CustomEvent("stormfall-mobile-fire", { detail: { firing: true } }));
    if (fireIntervalRef.current === null) {
      fireIntervalRef.current = window.setInterval(() => window.dispatchEvent(new CustomEvent("stormfall-mobile-fire", { detail: { firing: true } })), 110);
    }
  };
  const stopMobileFire = () => {
    window.dispatchEvent(new CustomEvent("stormfall-mobile-fire", { detail: { firing: false } }));
    if (fireIntervalRef.current !== null) {
      window.clearInterval(fireIntervalRef.current);
      fireIntervalRef.current = null;
    }
  };
  const reload = () => window.dispatchEvent(new Event("stormfall-reload"));
  const health = Math.max(0, Math.min(100, hud.health));
  const stormProgress = Math.max(0, Math.min(100, ((19 - hud.stormRadius) / 11) * 100));
  const ended = hud.matchState === "victory" || hud.matchState === "defeat";

  return (
    <div className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" style={{ touchAction: "none" }} />
      <div className="rain-film" aria-hidden="true" />
      {hud.matchState === "active" && <span className={`aim-reticle ${hud.hitConfirm ? "confirmed" : ""}`} aria-hidden="true"><i /><b /></span>}

      <header className="game-topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <div>
            <p className="eyebrow">SABLE RIDGE // SURVIVAL PROTOCOL</p>
            <p className="brand-wordmark">STORMFALL <span>ARENA</span></p>
          </div>
        </div>
        <div className="top-readout">
          <span className="live-dot" />
          <span>{hud.matchState === "active" ? "LIVE SIGNAL" : "FIELD LINK"}</span>
        </div>
      </header>

      <aside className="vitals-panel hud-panel" aria-label="Player vitals">
        <div className="panel-heading"><span>VITALS</span><span>{Math.round(health)}%</span></div>
        <div className="health-track"><div className="health-fill" style={{ width: `${health}%` }} /></div>
        <div className="shield-row"><span>ARMOR</span><span className="shield-pips">{Array.from({ length: 3 }, (_, i) => <i key={i} className={i < hud.shield ? "active" : ""} />)}</span></div>
      </aside>

      <section className="storm-panel hud-panel" aria-label="Storm status">
        <p className="eyebrow">STORM CLOSING</p>
        <p className="storm-clock">{timeLabel(hud.timer)}</p>
        <div className="storm-track"><div className="storm-fill" style={{ width: `${stormProgress}%` }} /></div>
        <p className="storm-distance">RING AT {hud.stormRadius.toFixed(1)}M</p>
      </section>

      <aside className="remain-panel hud-panel" aria-label="Remaining rivals">
        <span className="remain-number">{hud.remaining}</span>
        <span className="remain-label">RIVALS<br />REMAIN</span>
      </aside>

      <section className="field-note hud-panel" aria-live="polite">
        <span className="note-line" />
        <span>{hud.toast}</span>
      </section>

      <section className="controls-panel hud-panel" aria-label="Game controls">
        <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>MOVE</span></div>
        <div><kbd>CLICK</kbd><span>FIRE</span></div><div><kbd>R</kbd><span>RELOAD</span></div>
      </section>

      <section className={`weapon-panel hud-panel ${hud.reloading ? "is-reloading" : ""}`} aria-label="Weapon status">
        <div className="weapon-heading"><span>VOLT-9</span>{hud.hitConfirm && <b>HIT</b>}</div>
        <div className="ammo-row"><strong>{String(hud.ammo).padStart(2, "0")}</strong><span>/ {String(hud.reserve).padStart(2, "0")}</span></div>
        <div className="reload-track"><i style={{ width: `${hud.reloading ? hud.reloadProgress : 0}%` }} /></div>
        <button className="reload-button" onClick={reload} disabled={hud.reloading || hud.ammo === 12 || hud.reserve === 0}>{hud.reloading ? "RELOADING" : "RELOAD"}</button>
      </section>

      {hud.matchState === "active" && (
        <section className="mobile-controls" aria-label="Touch controls">
          <div
            className="mobile-stick"
            role="slider"
            aria-label="Movement control"
            aria-valuetext="Drag to move"
            onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); sendMobileMove(event); }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) sendMobileMove(event); }}
            onPointerUp={resetMobileMove}
            onPointerCancel={resetMobileMove}
          >
            <span className="stick-range" />
            <span className="stick-thumb" style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }} />
            <span className="stick-label">MOVE</span>
          </div>
          <div className="mobile-actions">
            <div
              className="mobile-aim"
              role="slider"
              aria-label="Aim control"
              aria-valuetext="Drag to aim"
              onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); sendMobileAim(event); }}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) sendMobileAim(event); }}
              onPointerUp={resetMobileAim}
              onPointerCancel={resetMobileAim}
            >
              <span className="aim-range" /><span className="aim-thumb" style={{ transform: `translate(${aimStick.x}px, ${aimStick.y}px)` }} /><span>AIM</span>
            </div>
            <button
              className="mobile-fire"
              onPointerDown={startMobileFire}
              onPointerUp={stopMobileFire}
              onPointerCancel={stopMobileFire}
              onPointerLeave={stopMobileFire}
            >
              <span>HOLD</span><strong>FIRE</strong><b>↗</b>
            </button>
          </div>
        </section>
      )}

      <section className="minimap hud-panel" aria-label="Arena minimap">
        <div className="map-ring map-ring-one" />
        <div className="map-ring map-ring-two" />
        <span className="map-player" />
        <i className="map-rival one" /><i className="map-rival two" /><i className="map-rival three" /><i className="map-rival four" />
        <p>SABLE RIDGE // 07</p>
      </section>

      {hud.matchState === "briefing" && (
        <section className="briefing-card" aria-label="Match briefing">
          <span className="briefing-logo" aria-hidden="true"><i /></span>
          <p className="eyebrow">SINGLE-PLAYER SURVIVAL RUN</p>
          <h1>THE STORM IS MOVING.<br /><em>SO ARE THEY.</em></h1>
          <p className="briefing-copy">Scavenge amber supply crates, break line of sight behind cover, and outlast every rival before the storm folds the arena.</p>
          <button className="drop-button" onClick={launch}><span>ENTER THE STORM</span><b>↗</b></button>
          <p className="briefing-tip">WASD / TOUCH TO MOVE · CLICK / HOLD TO FIRE</p>
        </section>
      )}

      {ended && (
        <section className={`result-card ${hud.matchState}`} aria-live="assertive">
          <p className="eyebrow">{hud.matchState === "victory" ? "STORM CELL SECURED" : "SIGNAL LOST"}</p>
          <h2>{hud.matchState === "victory" ? "LAST SIGNAL\nSTANDING" : "THE STORM\nTAKES ALL"}</h2>
          <p>{hud.matchState === "victory" ? `You cleared the field with a ${hud.streak} supply streak.` : "The field is still open. Drop again and make the storm blink first."}</p>
          <button className="drop-button" onClick={restart}><span>DROP AGAIN</span><b>↻</b></button>
        </section>
      )}
    </div>
  );
}
