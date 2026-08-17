// Sable Ridge visual system: an original sunlit frontier outpost seen through a close
// over-the-shoulder survival camera. Gameplay stays framework-independent from React.

import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";

type MatchState = "briefing" | "active" | "victory" | "defeat";
type Team = "player" | "enemy";

export type HudState = {
  health: number;
  shield: number;
  remaining: number;
  timer: number;
  stormRadius: number;
  toast: string;
  matchState: MatchState;
  streak: number;
  ammo: number;
  reserve: number;
  reloading: boolean;
  reloadProgress: number;
  hitConfirm: boolean;
};

export type GameHandle = { scene: Scene; dispose: () => void };

type Actor = { mesh: Mesh; health: number; cooldown: number; speed: number; team: Team; alive: boolean; phase: number };
type Projectile = { mesh: Mesh; velocity: Vector3; team: Team; life: number };
type Pickup = { root: Mesh; glow: Mesh; core: Mesh; kind: "med" | "burst"; collected: boolean; phase: number };

const amber = new Color3(0.961, 0.71, 0.267);
const coral = new Color3(0.95, 0.30, 0.27);
const violet = new Color3(0.53, 0.28, 1.0);
const charcoal = new Color3(0.06, 0.08, 0.12);

function distance(a: Vector3, b: Vector3) { return Math.hypot(a.x - b.x, a.z - b.z); }

function clampArena(point: Vector3, radius: number) {
  const length = Math.hypot(point.x, point.z);
  if (length > radius) { point.x = (point.x / length) * radius; point.z = (point.z / length) * radius; }
}

function material(scene: Scene, name: string, color: Color3, emissive?: Color3) {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = color;
  result.specularColor = Color3.Black();
  result.emissiveColor = emissive ?? Color3.Black();
  return result;
}

class GameWorld {
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly ground: Mesh;
  private readonly player: Actor;
  private readonly playerRing: Mesh;
  private readonly storm: Mesh;
  private readonly stormPylons: Mesh[] = [];
  private enemies: Actor[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private pressed = new Set<string>();
  private mobileMovement = new Vector3(0, 0, 0);
  private mobileAim = new Vector3(0, 0, 0);
  private mobileFiring = false;
  private pointerTarget = new Vector3(0, 0, 12);
  private state: MatchState = "briefing";
  private timer = 150;
  private stormRadius = 19;
  private elapsed = 0;
  private burstRemaining = 0;
  private magazine = 12;
  private reserveAmmo = 72;
  private reloadTimer = 0;
  private hitConfirmTimer = 0;
  private streak = 0;
  private toast = "SABLE RIDGE UPLINK ACQUIRED";
  private hudElapsed = 0;
  private demo = new URLSearchParams(window.location.search).has("demo");
  private readonly listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(scene: Scene, canvas: HTMLCanvasElement, camera: FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.ground = this.createEnvironment();
    this.storm = this.createStorm();
    this.player = this.createActor("player", new Vector3(0, 0.8, 1.5));
    this.playerRing = MeshBuilder.CreateTorus("playerSignal", { diameter: 2.4, thickness: 0.07, tessellation: 32 }, scene);
    this.playerRing.rotation.x = Math.PI / 2;
    this.playerRing.position.y = 0.055;
    this.playerRing.material = material(scene, "playerSignalMat", amber, amber.scale(0.4));
    this.createMatchEntities();
    this.bindInputs(canvas);
    scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000)));
    if (this.demo) window.setTimeout(() => this.start(), 350);
    this.updateCamera();
    this.emitHud();
  }

  private createEnvironment() {
    this.scene.clearColor = new Color4(0.28, 0.64, 0.84, 1);
    this.scene.ambientColor = new Color3(0.42, 0.34, 0.25);
    const ground = MeshBuilder.CreateGround("sableRidgeGround", { width: 46, height: 46, subdivisions: 2 }, this.scene);
    ground.material = material(this.scene, "dustMat", new Color3(0.40, 0.25, 0.13), new Color3(0.022, 0.011, 0.004));
    ground.isPickable = true;
    const outer = MeshBuilder.CreateGround("outerBadlands", { width: 82, height: 82 }, this.scene);
    outer.position.y = -0.09;
    outer.material = material(this.scene, "outerBadlandsMat", new Color3(0.16, 0.11, 0.08), new Color3(0.03, 0.017, 0.01));

    const sun = new HemisphericLight("ridgeSun", new Vector3(-0.35, 1, 0.45), this.scene);
    sun.intensity = 1.22;
    sun.diffuse = new Color3(0.82, 0.75, 0.56);
    sun.groundColor = new Color3(0.16, 0.09, 0.055);
    const stormLight = new PointLight("stormLight", new Vector3(0, 11, 0), this.scene);
    stormLight.diffuse = violet;
    stormLight.intensity = 1.6;
    stormLight.range = 25;
    const signalLight = new PointLight("signalLight", new Vector3(0, 4, 0), this.scene);
    signalLight.diffuse = amber;
    signalLight.intensity = 1.5;
    signalLight.range = 15;
    new GlowLayer("outpostGlow", this.scene, { blurKernelSize: 28 }).intensity = 0.12;

    const sandstone = material(this.scene, "sandstoneMat", new Color3(0.33, 0.19, 0.11), new Color3(0.035, 0.015, 0.006));
    const weathered = material(this.scene, "weatheredMat", new Color3(0.20, 0.24, 0.25), new Color3(0.012, 0.016, 0.018));
    const roof = material(this.scene, "roofMat", new Color3(0.12, 0.14, 0.15), new Color3(0.008, 0.01, 0.013));
    const pine = material(this.scene, "pineMat", new Color3(0.055, 0.13, 0.08), new Color3(0.004, 0.014, 0.006));
    const metal = material(this.scene, "metalMat", new Color3(0.16, 0.19, 0.21));

    for (let i = 0; i < 38; i += 1) {
      const angle = (Math.PI * 2 * i) / 38;
      const ridge = MeshBuilder.CreatePolyhedron(`ridgeRock${i}`, { type: i % 2 === 0 ? 1 : 2, size: 0.42 + (i % 3) * 0.18 }, this.scene);
      ridge.position.set(Math.cos(angle) * (21 + (i % 4) * 1.5), 0.34, Math.sin(angle) * (21 + (i % 4) * 1.5));
      ridge.scaling.y = 1.5 + (i % 2) * 0.35;
      ridge.material = sandstone;
    }
    const hut = (name: string, x: number, z: number, scale = 1) => {
      const base = MeshBuilder.CreateBox(`${name}Base`, { width: 4.4 * scale, height: 2.9 * scale, depth: 3.6 * scale }, this.scene);
      base.position.set(x, 1.45 * scale, z); base.material = weathered;
      const top = MeshBuilder.CreateBox(`${name}Roof`, { width: 4.9 * scale, height: 0.42 * scale, depth: 4.1 * scale }, this.scene);
      top.position.set(x, 3.05 * scale, z); top.rotation.z = 0.14; top.material = roof;
      const door = MeshBuilder.CreateBox(`${name}Door`, { width: 0.82 * scale, height: 1.6 * scale, depth: 0.05 }, this.scene);
      door.position.set(x - 0.95 * scale, 0.8 * scale, z - 1.83 * scale); door.material = material(this.scene, `${name}DoorMat`, charcoal);
    };
    const pineTree = (name: string, x: number, z: number, scale = 1) => {
      const trunk = MeshBuilder.CreateCylinder(`${name}Trunk`, { height: 2.2 * scale, diameter: 0.32 * scale, tessellation: 8 }, this.scene);
      trunk.position.set(x, 1.1 * scale, z); trunk.material = sandstone;
      [2, 1.45, 1].forEach((diameter, index) => {
        const crown = MeshBuilder.CreateCylinder(`${name}Crown${index}`, { height: 1.55 * scale, diameterTop: 0.06, diameterBottom: diameter * scale, tessellation: 7 }, this.scene);
        crown.position.set(x, 2.2 * scale + index * 0.72 * scale, z); crown.material = pine;
      });
    };
    const sandbags = (name: string, x: number, z: number) => {
      for (let row = 0; row < 2; row += 1) for (let bag = 0; bag < 4; bag += 1) {
        const mesh = MeshBuilder.CreateSphere(`${name}${row}${bag}`, { diameterX: 0.88, diameterY: 0.46, diameterZ: 0.52, segments: 8 }, this.scene);
        mesh.position.set(x + (bag - 1.5) * 0.76, 0.24 + row * 0.42, z + row * 0.12);
        mesh.material = material(this.scene, `${name}Mat${row}${bag}`, new Color3(0.31, 0.25, 0.17));
      }
    };
    [[-12, 12, 1.7], [-3, 15, 2.1], [9, 14, 2.8], [14, 9, 1.6], [-14, 7, 1.45]].forEach(([x, z, size], index) => {
      const mesa = MeshBuilder.CreatePolyhedron(`sableMesa${index}`, { type: 1, size }, this.scene);
      mesa.position.set(x, size * 0.62 - 0.1, z); mesa.scaling.y = 1.4; mesa.material = sandstone;
    });
    [[-16, 20, 5.2], [-8, 21, 4.1], [2, 21, 5.8], [12, 20, 4.6], [19, 19, 6.4]].forEach(([x, z, size], index) => {
      const ridge = MeshBuilder.CreatePolyhedron(`farRidge${index}`, { type: 2, size }, this.scene);
      ridge.position.set(x, size * 0.48 - 0.1, z); ridge.scaling.y = 0.95; ridge.material = sandstone;
    });
    hut("relayHut", -7, 8, 1.15); hut("salvageHut", 8, 10, 0.85); hut("ridgeShed", 12, 3.4, 0.65);
    sandbags("relayBags", -3.3, 6.4); sandbags("gateBags", 5.4, 5.7);
    pineTree("pineA", -16, 11, 1.25); pineTree("pineB", 15, 13, 0.9); pineTree("pineC", 3, 17, 1.1);
    [[-0.7, 0.7], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]].forEach(([dx, dz], index) => {
      const leg = MeshBuilder.CreateCylinder(`relayLeg${index}`, { height: 5.3, diameter: 0.12, tessellation: 6 }, this.scene);
      leg.position.set(1 + dx, 2.65, 15 + dz); leg.material = metal;
    });
    const tank = MeshBuilder.CreateCylinder("relayTank", { height: 1.25, diameter: 1.8, tessellation: 12 }, this.scene);
    tank.position.set(1, 5.7, 15); tank.material = weathered;
    const mast = MeshBuilder.CreateCylinder("sableSignalMast", { height: 8.4, diameterTop: 0.08, diameterBottom: 0.22, tessellation: 8 }, this.scene);
    mast.position.set(-1.8, 4.2, 17.5); mast.material = metal;
    [2.2, 4.4, 6.4].forEach((y, index) => {
      const array = MeshBuilder.CreateTorus(`mastArray${index}`, { diameter: 1.45 - index * 0.15, thickness: 0.08, tessellation: 24 }, this.scene);
      array.position.set(-1.8, y, 17.5); array.rotation.x = Math.PI / 2; array.material = metal;
    });
    return ground;
  }

  private createStorm() {
    const storm = MeshBuilder.CreateTorus("stormBoundary", { diameter: 38, thickness: 0.24, tessellation: 96 }, this.scene);
    storm.rotation.x = Math.PI / 2; storm.position.y = 0.14;
    storm.material = material(this.scene, "stormBoundaryMat", violet.scale(0.38), violet);
    for (let i = 0; i < 18; i += 1) {
      const pylon = MeshBuilder.CreateCylinder(`stormPylon${i}`, { height: 0.95 + (i % 3) * 0.18, diameterTop: 0.04, diameterBottom: 0.18, tessellation: 6 }, this.scene);
      pylon.material = material(this.scene, `stormPylonMat${i}`, violet.scale(0.45), violet.scale(0.7));
      this.stormPylons.push(pylon);
    }
    return storm;
  }

  private createActor(team: Team, position: Vector3): Actor {
    const player = team === "player";
    const core = player ? new Color3(0.17, 0.21, 0.22) : coral;
    const signal = player ? amber : coral;
    const body = MeshBuilder.CreateCapsule(`${team}Body${Math.random()}`, { height: player ? 1.65 : 1.42, radius: player ? 0.50 : 0.44, tessellation: 8 }, this.scene);
    body.position = position.clone(); body.material = material(this.scene, `${team}BodyMat${Math.random()}`, core, signal.scale(player ? 0.045 : 0.22));
    const visor = MeshBuilder.CreateBox(`${team}Visor${Math.random()}`, { width: player ? 0.62 : 0.56, height: 0.16, depth: 0.09 }, this.scene);
    visor.parent = body; visor.position.set(0, 0.28, 0.44); visor.material = material(this.scene, `${team}VisorMat${Math.random()}`, charcoal, signal.scale(0.65));
    const weapon = MeshBuilder.CreateBox(`${team}Weapon${Math.random()}`, { width: 0.18, height: 0.14, depth: 0.95 }, this.scene);
    weapon.parent = body; weapon.position.set(0.34, 0, 0.50); weapon.rotation.z = -0.12; weapon.material = material(this.scene, `${team}WeaponMat${Math.random()}`, charcoal, signal.scale(0.13));
    if (player) {
      const backpack = MeshBuilder.CreateBox("survivorPack", { width: 0.66, height: 0.78, depth: 0.27 }, this.scene);
      backpack.parent = body; backpack.position.set(0, -0.08, -0.43); backpack.material = material(this.scene, "survivorPackMat", new Color3(0.09, 0.11, 0.12), new Color3(0.008, 0.01, 0.01));
      const strap = MeshBuilder.CreateBox("survivorSignalStrap", { width: 0.16, height: 0.82, depth: 0.05 }, this.scene);
      strap.parent = body; strap.position.set(-0.2, -0.02, -0.58); strap.material = material(this.scene, "survivorSignalStrapMat", amber.scale(0.6), amber.scale(0.18));
    }
    return { mesh: body, health: 100, cooldown: Math.random() * 0.6, speed: player ? 8.2 : 2.1 + Math.random() * 0.55, team, alive: true, phase: Math.random() * Math.PI * 2 };
  }

  private createMatchEntities() {
    [new Vector3(-5, 0.7, 9), new Vector3(5, 0.7, 11), new Vector3(-12, 0.7, 8), new Vector3(13, 0.7, 7), new Vector3(-8, 0.7, 15), new Vector3(7, 0.7, 16), new Vector3(14, 0.7, -1), new Vector3(-13, 0.7, 1)].forEach((position) => this.enemies.push(this.createActor("enemy", position)));
    [new Vector3(-5.5, 0, 4), new Vector3(4.5, 0, 7), new Vector3(-2, 0, 11), new Vector3(9, 0, 4.6), new Vector3(-10, 0, 10)].forEach((position, index) => this.pickups.push(this.createPickup(position, index % 2 === 0 ? "med" : "burst", index)));
  }

  private createPickup(position: Vector3, kind: "med" | "burst", index: number): Pickup {
    const root = MeshBuilder.CreateCylinder(`supplyPad${index}`, { height: 0.12, diameter: 1.8, tessellation: 6 }, this.scene);
    root.position = position.add(new Vector3(0, 0.11, 0)); root.material = material(this.scene, `supplyPadMat${index}`, amber.scale(0.24), amber.scale(0.18));
    const glow = MeshBuilder.CreateCylinder(`supplyGlow${index}`, { height: 0.34, diameter: 1.38, tessellation: 6 }, this.scene);
    glow.position = position.add(new Vector3(0, 0.24, 0)); glow.material = material(this.scene, `supplyGlowMat${index}`, amber.scale(0.56), amber.scale(0.72));
    const core = MeshBuilder.CreateCylinder(`supplyCore${index}`, { height: 0.42, diameterTop: 0.78, diameterBottom: 1.02, tessellation: 6 }, this.scene);
    core.position = position.add(new Vector3(0, 0.55, 0)); core.material = material(this.scene, `supplyCoreMat${index}`, charcoal, amber.scale(0.6));
    return { root, glow, core, kind, collected: false, phase: index * 0.72 };
  }

  private bindInputs(canvas: HTMLCanvasElement) {
    const keyDown = (event: Event) => {
      const key = (event as KeyboardEvent).key.toLowerCase();
      if (["w", "a", "s", "d", "r", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
      this.pressed.add(key); if (key === " " && this.state === "active") this.firePlayer();
      if (key === "r" && this.state === "active") this.beginReload();
    };
    const keyUp = (event: Event) => this.pressed.delete((event as KeyboardEvent).key.toLowerCase());
    const start = () => this.start(); const restart = () => this.reset();
    const mobileMove = (event: Event) => { const detail = (event as CustomEvent<{ x: number; z: number }>).detail; this.mobileMovement.set(detail.x, 0, detail.z); };
    const mobileAim = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      const nextAim = new Vector3(detail.x, 0, -detail.y);
      if (nextAim.lengthSquared() > 0.04) this.mobileAim.copyFrom(nextAim.normalize());
    };
    const mobileFire = (event: Event) => { this.mobileFiring = Boolean((event as CustomEvent<{ firing: boolean }>).detail.firing); };
    const reload = () => this.beginReload();
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp); window.addEventListener("stormfall-start", start); window.addEventListener("stormfall-restart", restart); window.addEventListener("stormfall-mobile-move", mobileMove); window.addEventListener("stormfall-mobile-aim", mobileAim); window.addEventListener("stormfall-mobile-fire", mobileFire); window.addEventListener("stormfall-reload", reload);
    this.listeners.push([window, "keydown", keyDown], [window, "keyup", keyUp], [window, "stormfall-start", start], [window, "stormfall-restart", restart], [window, "stormfall-mobile-move", mobileMove], [window, "stormfall-mobile-aim", mobileAim], [window, "stormfall-mobile-fire", mobileFire], [window, "stormfall-reload", reload]);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERMOVE || info.type === PointerEventTypes.POINTERDOWN) {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (mesh) => mesh === this.ground);
        if (pick?.hit && pick.pickedPoint) this.pointerTarget.copyFrom(pick.pickedPoint);
      }
      if (info.type === PointerEventTypes.POINTERDOWN && this.state === "active") this.firePlayer();
    });
  }

  private start() { if (this.state !== "active") { this.state = "active"; this.toast = "DROP CONFIRMED — OUTLAST THE RIDGE"; this.emitHud(); } }

  private reset() {
    [...this.enemies.map((enemy) => enemy.mesh), ...this.projectiles.map((projectile) => projectile.mesh), ...this.pickups.flatMap((pickup) => [pickup.root, pickup.glow, pickup.core])].forEach((mesh) => mesh.dispose());
    this.enemies = []; this.projectiles = []; this.pickups = []; this.player.mesh.position.set(0, 0.8, 1.5); this.player.mesh.rotation.y = 0; this.player.health = 100; this.player.alive = true; this.timer = 150; this.stormRadius = 19; this.elapsed = 0; this.burstRemaining = 0; this.streak = 0; this.magazine = 12; this.reserveAmmo = 72; this.reloadTimer = 0; this.hitConfirmTimer = 0; this.mobileMovement.setAll(0); this.mobileAim.setAll(0); this.mobileFiring = false; this.state = "briefing"; this.toast = "SABLE RIDGE UPLINK ACQUIRED"; this.createMatchEntities(); this.emitHud();
  }

  private update(delta: number) {
    this.elapsed += delta; this.animateStorm();
    if (this.state === "active") {
      this.timer = Math.max(0, this.timer - delta); this.stormRadius = Math.max(8, 19 - ((150 - this.timer) / 150) * 11);
      this.updateWeapon(delta); this.updatePlayer(delta); this.updateEnemies(delta); this.updateProjectiles(delta); this.updatePickups(delta); this.applyStormDamage(delta);
      if (this.enemies.every((enemy) => !enemy.alive)) this.finish("victory");
      if (this.player.health <= 0 || this.timer <= 0) this.finish("defeat");
    }
    this.playerRing.position.x = this.player.mesh.position.x; this.playerRing.position.z = this.player.mesh.position.z; this.playerRing.rotation.z += delta * 0.85; this.updateCamera();
    this.hudElapsed += delta; if (this.hudElapsed > 0.12) { this.hudElapsed = 0; this.emitHud(); }
  }

  private animateStorm() {
    this.storm.scaling.set(this.stormRadius / 19, this.stormRadius / 19, this.stormRadius / 19);
    this.stormPylons.forEach((pylon, index) => {
      const angle = (index / this.stormPylons.length) * Math.PI * 2 + this.elapsed * 0.08;
      pylon.position.set(Math.cos(angle) * this.stormRadius, 0.72 + Math.sin(this.elapsed * 2.2 + index) * 0.2, Math.sin(angle) * this.stormRadius);
      pylon.rotation.y = -angle; pylon.scaling.y = 0.75 + Math.sin(this.elapsed * 3 + index) * 0.22;
    });
  }

  private updatePlayer(delta: number) {
    const movement = new Vector3(0, 0, 0);
    if (this.demo) {
      const angle = this.elapsed * 0.56; movement.set(Math.cos(angle), 0, Math.sin(angle));
      const nearest = this.nearestEnemy(); if (nearest) this.pointerTarget.copyFrom(nearest.mesh.position); this.firePlayer();
    } else {
      if (this.pressed.has("w") || this.pressed.has("arrowup")) movement.z += 1;
      if (this.pressed.has("s") || this.pressed.has("arrowdown")) movement.z -= 1;
      if (this.pressed.has("a") || this.pressed.has("arrowleft")) movement.x -= 1;
      if (this.pressed.has("d") || this.pressed.has("arrowright")) movement.x += 1;
      if (this.mobileMovement.lengthSquared() > 0) movement.addInPlace(this.mobileMovement);
      if (this.mobileAim.lengthSquared() > 0.04) this.pointerTarget.copyFrom(this.player.mesh.position.add(this.mobileAim.scale(13)));
      if (this.mobileFiring) this.firePlayer();
    }
    if (movement.lengthSquared() > 0) { movement.normalize(); this.player.mesh.position.addInPlace(movement.scale(this.player.speed * delta)); }
    const aim = this.pointerTarget.subtract(this.player.mesh.position); aim.y = 0; if (aim.lengthSquared() > 0.1) this.player.mesh.rotation.y = Math.atan2(aim.x, aim.z);
    clampArena(this.player.mesh.position, 21); this.player.cooldown = Math.max(0, this.player.cooldown - delta); this.burstRemaining = Math.max(0, this.burstRemaining - delta);
  }

  private updateCamera() {
    const forward = new Vector3(Math.sin(this.player.mesh.rotation.y), 0, Math.cos(this.player.mesh.rotation.y));
    this.camera.position.copyFrom(this.player.mesh.position.subtract(forward.scale(6.8)).add(new Vector3(0, 3.15, 0)));
    this.camera.setTarget(this.player.mesh.position.add(forward.scale(4.8)).add(new Vector3(0, 0.65, 0)));
  }

  private updateEnemies(delta: number) {
    this.enemies.filter((enemy) => enemy.alive).forEach((enemy) => {
      enemy.cooldown = Math.max(0, enemy.cooldown - delta); const toPlayer = this.player.mesh.position.subtract(enemy.mesh.position); const range = Math.max(0.01, Math.hypot(toPlayer.x, toPlayer.z));
      if (range > 6.2) { toPlayer.y = 0; toPlayer.normalize(); const strafe = new Vector3(-toPlayer.z, 0, toPlayer.x).scale(Math.sin(this.elapsed * 1.2 + enemy.phase) * 0.34); enemy.mesh.position.addInPlace(toPlayer.add(strafe).normalize().scale(enemy.speed * delta)); }
      enemy.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z); if (range < 13.5 && enemy.cooldown <= 0) this.fire(enemy, this.player.mesh.position); clampArena(enemy.mesh.position, 21);
    });
  }

  private nearestEnemy() { return this.enemies.filter((enemy) => enemy.alive).sort((a, b) => distance(a.mesh.position, this.player.mesh.position) - distance(b.mesh.position, this.player.mesh.position))[0]; }
  private beginReload() {
    if (this.reloadTimer > 0 || this.magazine >= 12 || this.reserveAmmo <= 0) return;
    this.reloadTimer = 1.1;
    this.mobileFiring = false;
    this.toast = "RELOADING VOLT-9";
  }
  private updateWeapon(delta: number) {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - delta);
    if (this.reloadTimer <= 0) return;
    this.reloadTimer = Math.max(0, this.reloadTimer - delta);
    if (this.reloadTimer === 0) {
      const loaded = Math.min(12 - this.magazine, this.reserveAmmo);
      this.magazine += loaded;
      this.reserveAmmo -= loaded;
      this.toast = "MAGAZINE LOCKED — READY";
    }
  }
  private firePlayer() {
    if (!this.player.alive || this.player.cooldown > 0 || this.reloadTimer > 0) return;
    if (this.magazine <= 0) { this.beginReload(); return; }
    this.fire(this.player, this.pointerTarget);
    this.magazine -= 1;
    if (this.magazine === 0) this.beginReload();
  }

  private fire(actor: Actor, target: Vector3) {
    actor.cooldown = actor.team === "player" ? (this.burstRemaining > 0 ? 0.12 : 0.28) : 0.92 + Math.random() * 0.28;
    const origin = actor.mesh.position.add(new Vector3(0, 0.25, 0)); const direction = target.subtract(origin); direction.y = 0; if (direction.lengthSquared() < 0.1) return; direction.normalize();
    const bolt = MeshBuilder.CreateSphere(`bolt${Math.random()}`, { diameter: actor.team === "player" ? 0.28 : 0.23, segments: 8 }, this.scene);
    bolt.position.copyFrom(origin.add(direction.scale(0.76))); const color = actor.team === "player" ? amber : coral; bolt.material = material(this.scene, `boltMat${Math.random()}`, color, color);
    this.projectiles.push({ mesh: bolt, velocity: direction.scale(actor.team === "player" ? 19 : 14), team: actor.team, life: 1.3 });
  }

  private updateProjectiles(delta: number) {
    this.projectiles = this.projectiles.filter((projectile) => {
      projectile.life -= delta; projectile.mesh.position.addInPlace(projectile.velocity.scale(delta)); let hit = projectile.life <= 0;
      if (projectile.team === "player") {
        for (const enemy of this.enemies.filter((entry) => entry.alive)) if (distance(projectile.mesh.position, enemy.mesh.position) < 0.85) { this.damage(enemy, this.burstRemaining > 0 ? 42 : 30, "RIVAL SIGNAL DISRUPTED"); this.hitConfirmTimer = 0.28; hit = true; break; }
      } else if (distance(projectile.mesh.position, this.player.mesh.position) < 0.9) { this.damage(this.player, 11, "INCOMING FIRE — FIND COVER"); hit = true; }
      if (hit) projectile.mesh.dispose(); return !hit;
    });
  }

  private updatePickups(delta: number) {
    this.pickups.filter((pickup) => !pickup.collected).forEach((pickup) => {
      pickup.core.position.y = 0.55 + Math.sin(this.elapsed * 2.4 + pickup.phase) * 0.08; pickup.glow.scaling.setAll(0.94 + Math.sin(this.elapsed * 2.8 + pickup.phase) * 0.07); pickup.core.rotation.y += delta * 0.75;
      if (distance(this.player.mesh.position, pickup.root.position) < 1.42) {
        pickup.collected = true; pickup.root.dispose(); pickup.glow.dispose(); pickup.core.dispose(); this.streak += 1;
        if (pickup.kind === "med") { this.player.health = Math.min(100, this.player.health + 28); this.toast = "SUPPLY SECURED — VITALS RESTORED"; } else { this.burstRemaining = 8; this.toast = "SURGE MODULE — RAPID FIRE ONLINE"; }
      }
    });
  }

  private applyStormDamage(delta: number) { [this.player, ...this.enemies.filter((enemy) => enemy.alive)].forEach((actor) => { if (Math.hypot(actor.mesh.position.x, actor.mesh.position.z) > this.stormRadius - 0.28) this.damage(actor, delta * (actor.team === "player" ? 9 : 15), actor.team === "player" ? "STORM CONTACT — MOVE INWARD" : ""); }); }
  private damage(actor: Actor, amount: number, message: string) { if (!actor.alive) return; actor.health -= amount; if (message) this.toast = message; if (actor.health <= 0) { actor.alive = false; actor.mesh.scaling.y = 0.25; actor.mesh.visibility = 0.35; if (actor.team === "enemy") this.toast = "RIVAL ELIMINATED — FIELD THINS"; } }
  private finish(state: MatchState) { if (this.state === "active") { this.state = state; this.toast = state === "victory" ? "RIDGE SECURED — LAST SIGNAL STANDING" : "SIGNAL LOST IN THE STORM"; this.emitHud(); } }
  private emitHud() { window.dispatchEvent(new CustomEvent<HudState>("stormfall-hud", { detail: { health: Math.max(0, this.player.health), shield: this.player.health > 70 ? 3 : this.player.health > 35 ? 2 : 1, remaining: this.enemies.filter((enemy) => enemy.alive).length, timer: this.timer, stormRadius: this.stormRadius, toast: this.toast, matchState: this.state, streak: this.streak, ammo: this.magazine, reserve: this.reserveAmmo, reloading: this.reloadTimer > 0, reloadProgress: this.reloadTimer > 0 ? (1 - this.reloadTimer / 1.1) * 100 : 0, hitConfirm: this.hitConfirmTimer > 0 } })); }
  dispose() { this.listeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener)); this.projectiles.forEach((projectile) => projectile.mesh.dispose()); }
}

export async function createGameScene(engine: Engine, canvas: HTMLCanvasElement): Promise<GameHandle> {
  const scene = new Scene(engine);
  const camera = new FreeCamera("sableRidgeCamera", new Vector3(0, 5, -6), scene);
  camera.setTarget(new Vector3(0, 1, 8)); camera.fov = 0.80; camera.minZ = 0.1; camera.maxZ = 150;
  const world = new GameWorld(scene, canvas, camera);
  return { scene, dispose: () => { world.dispose(); scene.dispose(); } };
}
