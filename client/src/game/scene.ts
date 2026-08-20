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
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/loaders/glTF";

type MatchState = "briefing" | "active" | "victory" | "defeat";
type Team = "player" | "enemy";
type WeaponKind = "volt" | "scatter";
type RivalBehavior = "patrol" | "pursuit" | "cover" | "retreat";

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
  weaponName: string;
  altWeaponName: string;
  altAmmo: number;
  muzzleFlash: boolean;
  damageFlash: boolean;
  damageDirection: number;
  stormIntensity: number;
  lightning: boolean;
  mapStatus: "loading" | "ready" | "fallback";
};

export type GameHandle = { scene: Scene; dispose: () => void };

type Actor = { mesh: Mesh; health: number; cooldown: number; speed: number; team: Team; alive: boolean; phase: number; anchor: Vector3; behavior: RivalBehavior };
type Projectile = { mesh: Mesh; velocity: Vector3; team: Team; life: number; weapon: WeaponKind };
type Pickup = { root: Mesh; glow: Mesh; core: Mesh; kind: "med" | "burst" | "ammo" | "armor"; collected: boolean; phase: number };

const amber = new Color3(0.961, 0.71, 0.267);
const coral = new Color3(0.95, 0.30, 0.27);
const violet = new Color3(0.53, 0.28, 1.0);
const charcoal = new Color3(0.06, 0.08, 0.12);
const uploadedMapUrl = "/manus-storage/atlas-sector-user-optimized_415eddfe.glb";
const uploadedRoadPhotoUrl = "/manus-storage/breakwater-lakeside-road_48f1d55e.jpg";

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
  private readonly environmentMeshes: AbstractMesh[];
  private readonly player: Actor;
  private readonly playerRing: Mesh;
  private readonly storm: Mesh;
  private readonly stormHalo: Mesh;
  private readonly stormPylons: Mesh[] = [];
  private lightningLight!: PointLight;
  private enemies: Actor[] = [];
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private readonly playerSpawn = new Vector3(3.55, 0.8, -16.8);
  private readonly coverNodes = [new Vector3(9.2, 0, -10.8), new Vector3(-9.2, 0, -8.8), new Vector3(9.4, 0, -1.5), new Vector3(-9.3, 0, 3.8), new Vector3(9.4, 0, 8.5), new Vector3(-9.2, 0, 14.6)];
  private pressed = new Set<string>();
  private mobileMovement = new Vector3(0, 0, 0);
  private mobileAim = new Vector3(0, 0, 0);
  private mobileFiring = false;
  private autoFire = false;
  private pointerTarget = new Vector3(0, 0, 12);
  private state: MatchState = "briefing";
  private timer = 150;
  private stormRadius = 19;
  private elapsed = 0;
  private burstRemaining = 0;
  private activeWeapon: WeaponKind = "volt";
  private magazine = 12;
  private reserveAmmo = 72;
  private scatterMagazine = 5;
  private scatterReserve = 30;
  private reloadTimer = 0;
  private hitConfirmTimer = 0;
  private muzzleFlashTimer = 0;
  private damageFlashTimer = 0;
  private damageDirection = 0;
  private lightningTimer = 1.5;
  private lightningFlashTimer = 0;
  private soundEnabled = true;
  private audioContext?: AudioContext;
  private ambientOscillator?: OscillatorNode;
  private streak = 0;
  private toast = "BREAKWATER RELAY UPLINK ACQUIRED";
  private mapStatus: HudState["mapStatus"] = "ready";
  private hudElapsed = 0;
  private demo = new URLSearchParams(window.location.search).has("demo");
  private readonly listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(scene: Scene, canvas: HTMLCanvasElement, camera: FreeCamera) {
    this.scene = scene;
    this.camera = camera;
    this.ground = this.createEnvironment();
    this.environmentMeshes = [...scene.meshes];
    this.storm = this.createStorm();
    this.stormHalo = this.createStormHalo();
    this.player = this.createActor("player", this.playerSpawn);
    this.playerRing = MeshBuilder.CreateTorus("playerSignal", { diameter: 2.4, thickness: 0.07, tessellation: 32 }, scene);
    this.playerRing.rotation.x = Math.PI / 2;
    this.playerRing.position.y = 0.055;
    this.playerRing.material = material(scene, "playerSignalMat", amber, amber.scale(0.4));
    this.createSectorCover();
    this.createMatchEntities();
    this.bindInputs(canvas);
    scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.05, scene.getEngine().getDeltaTime() / 1000)));
    if (this.demo) window.setTimeout(() => this.start(), 350);
    this.updateCamera();
    this.emitHud();
  }

  async loadUploadedMap() {
    try {
      const imported = await SceneLoader.ImportMeshAsync("", "", uploadedMapUrl, this.scene);
      const visibleMeshes = imported.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
      if (visibleMeshes.length === 0) throw new Error("The uploaded model did not contain visible mesh geometry.");

      const root = new TransformNode("uploadedTerrainRoot", this.scene);
      imported.meshes.filter((mesh) => !mesh.parent).forEach((mesh) => { mesh.parent = root; });
      visibleMeshes.forEach((mesh) => { mesh.isPickable = false; });

      const calculateBounds = () => {
        let minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        let maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
        visibleMeshes.forEach((mesh) => {
          mesh.computeWorldMatrix(true);
          const bounds = mesh.getBoundingInfo().boundingBox;
          minimum = Vector3.Minimize(minimum, bounds.minimumWorld);
          maximum = Vector3.Maximize(maximum, bounds.maximumWorld);
        });
        return { minimum, maximum };
      };

      const initial = calculateBounds();
      const span = Math.max(initial.maximum.x - initial.minimum.x, initial.maximum.z - initial.minimum.z);
      const height = initial.maximum.y - initial.minimum.y;
      if (!Number.isFinite(span) || span <= 0) throw new Error("The uploaded model did not expose usable terrain bounds.");

      const horizontalScale = Math.max(0.02, Math.min(1, 36 / span));
      const verticalScale = Number.isFinite(height) && height > 0 ? Math.min(horizontalScale, 0.68 / height) : horizontalScale;
      root.scaling.set(horizontalScale, verticalScale, horizontalScale);
      root.computeWorldMatrix(true);
      const scaled = calculateBounds();
      root.position.x -= (scaled.minimum.x + scaled.maximum.x) / 2;
      root.position.z -= (scaled.minimum.z + scaled.maximum.z) / 2;
      root.position.y -= scaled.minimum.y + 0.42;

      // The user photo and exact procedural reconstruction are now the visible map.
      // Keep the legacy GLB available in memory without letting its terrain alter the photo match.
      visibleMeshes.forEach((mesh) => { mesh.setEnabled(false); });
      this.ground.visibility = 1;
      this.mapStatus = "ready";
      this.toast = "LAKESIDE PARK ROAD MAP READY";
    } catch (error) {
      console.warn("Uploaded GLB map did not load; retaining the procedural arena.", error);
      this.mapStatus = "ready";
      this.toast = "LAKESIDE PARK ROAD MAP ACTIVE";
    }
    this.emitHud();
  }

  private createEnvironment() {
    this.scene.clearColor = new Color4(0.48, 0.72, 0.95, 1);
    this.scene.ambientColor = new Color3(0.58, 0.66, 0.61);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = new Color3(0.48, 0.72, 0.95);
    this.scene.fogDensity = 0.001;
    const ground = MeshBuilder.CreateGround("breakwaterLand", { width: 46, height: 46, subdivisions: 2 }, this.scene);
    ground.material = material(this.scene, "coastalLandMat", new Color3(0.22, 0.31, 0.24), new Color3(0.014, 0.024, 0.017));
    ground.isPickable = true;
    const outer = MeshBuilder.CreateGround("outerTide", { width: 82, height: 82 }, this.scene);
    outer.position.y = -0.12;
    outer.material = material(this.scene, "outerTideMat", new Color3(0.018, 0.14, 0.20), new Color3(0.008, 0.046, 0.075));

    const sun = new HemisphericLight("ridgeSun", new Vector3(-0.35, 1, 0.45), this.scene);
    sun.intensity = 1.38;
    sun.diffuse = new Color3(1.0, 0.89, 0.70);
    sun.groundColor = new Color3(0.19, 0.24, 0.18);
    const stormLight = new PointLight("stormLight", new Vector3(0, 11, 0), this.scene);
    stormLight.diffuse = violet;
    stormLight.intensity = 0.42;
    stormLight.range = 25;
    this.lightningLight = new PointLight("lightningFlash", new Vector3(0, 12, 0), this.scene);
    this.lightningLight.diffuse = new Color3(0.72, 0.77, 1);
    this.lightningLight.intensity = 0;
    this.lightningLight.range = 54;
    const signalLight = new PointLight("signalLight", new Vector3(0, 4, 0), this.scene);
    signalLight.diffuse = amber;
    signalLight.intensity = 0.78;
    signalLight.range = 15;
    new GlowLayer("outpostGlow", this.scene, { blurKernelSize: 28 }).intensity = 0.11;

    return this.createLakesideParkEnvironment();

    const sandstone = material(this.scene, "coastalStoneMat", new Color3(0.23, 0.22, 0.19), new Color3(0.018, 0.018, 0.015));
    const weathered = material(this.scene, "harborWallMat", new Color3(0.15, 0.22, 0.25), new Color3(0.009, 0.016, 0.02));
    const roof = material(this.scene, "harborRoofMat", new Color3(0.08, 0.13, 0.17), new Color3(0.008, 0.012, 0.017));
    const pine = material(this.scene, "autumnPineMat", new Color3(0.10, 0.24, 0.16), new Color3(0.007, 0.02, 0.01));
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
    hut("freightWarehouse", -7, 8, 1.15); hut("harborWorkshop", 8, 10, 0.85); hut("marinaShed", 12, 3.4, 0.65);
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

    const tide = material(this.scene, "breakwaterTideMat", new Color3(0.015, 0.19, 0.28), new Color3(0.006, 0.075, 0.12));
    tide.specularColor = new Color3(0.38, 0.66, 0.76);
    tide.specularPower = 64;
    const asphalt = material(this.scene, "harborAsphaltMat", new Color3(0.065, 0.085, 0.09), new Color3(0.006, 0.008, 0.01));
    const photoRoad = new StandardMaterial("userPhotoRoadMat", this.scene);
    const roadTexture = new Texture(uploadedRoadPhotoUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    roadTexture.uScale = 0.9;
    roadTexture.vScale = 3.1;
    photoRoad.diffuseTexture = roadTexture;
    photoRoad.emissiveTexture = roadTexture;
    photoRoad.specularColor = Color3.Black();
    const photoBackdrop = new StandardMaterial("userPhotoBackdropMat", this.scene);
    photoBackdrop.diffuseTexture = new Texture(uploadedRoadPhotoUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
    photoBackdrop.emissiveTexture = photoBackdrop.diffuseTexture;
    photoBackdrop.specularColor = Color3.Black();
    photoBackdrop.backFaceCulling = false;
    const dockWood = material(this.scene, "dockWoodMat", new Color3(0.26, 0.20, 0.13), new Color3(0.025, 0.018, 0.009));
    const autumn = [new Color3(0.76, 0.29, 0.12), new Color3(0.83, 0.54, 0.12), new Color3(0.42, 0.16, 0.09), new Color3(0.16, 0.34, 0.16)];
    const makeTile = (name: string, x: number, z: number, width: number, depth: number, y: number, mat: StandardMaterial, rotation = 0) => {
      const tile = MeshBuilder.CreateBox(name, { width, height: 0.08, depth }, this.scene);
      tile.position.set(x, y, z); tile.rotation.y = rotation; tile.material = mat;
      return tile;
    };
    const makeHome = (name: string, x: number, z: number, tint: Color3, scale = 1) => {
      const homeMat = material(this.scene, `${name}Mat`, tint, tint.scale(0.035));
      const home = MeshBuilder.CreateBox(`${name}Base`, { width: 2.1 * scale, height: 1.65 * scale, depth: 1.85 * scale }, this.scene);
      home.position.set(x, 0.82 * scale, z); home.material = homeMat;
      const cap = MeshBuilder.CreateBox(`${name}Cap`, { width: 2.35 * scale, height: 0.26 * scale, depth: 2.08 * scale }, this.scene);
      cap.position.set(x, 1.74 * scale, z); cap.rotation.z = 0.13; cap.material = roof;
    };
    const makeAutumnTree = (name: string, x: number, z: number, index: number) => {
      const trunk = MeshBuilder.CreateCylinder(`${name}Trunk`, { height: 1.6, diameter: 0.2, tessellation: 7 }, this.scene);
      trunk.position.set(x, 0.8, z); trunk.material = sandstone;
      const crown = MeshBuilder.CreateSphere(`${name}Crown`, { diameter: 1.45 + (index % 3) * 0.18, segments: 8 }, this.scene);
      crown.position.set(x, 2.0, z); crown.scaling.y = 0.82; crown.material = material(this.scene, `${name}CrownMat`, autumn[index % autumn.length], autumn[index % autumn.length].scale(0.04));
    };
    const windowMat = material(this.scene, "townWindowMat", new Color3(0.20, 0.48, 0.59), new Color3(0.04, 0.17, 0.24));
    const roadMark = material(this.scene, "roadMarkMat", new Color3(0.66, 0.70, 0.63), new Color3(0.025, 0.03, 0.02));
    const storefrontMats = [new Color3(0.24, 0.41, 0.47), new Color3(0.45, 0.31, 0.21), new Color3(0.34, 0.27, 0.38), new Color3(0.24, 0.39, 0.30)];
    const makeTownhouse = (name: string, x: number, z: number, tint: Color3, scale = 1, rotation = 0) => {
      const homeMat = material(this.scene, `${name}Mat`, tint, tint.scale(0.04));
      const root = MeshBuilder.CreateBox(`${name}Base`, { width: 2.55 * scale, height: 2.2 * scale, depth: 2.05 * scale }, this.scene);
      root.position.set(x, 1.1 * scale, z); root.rotation.y = rotation; root.material = homeMat;
      const roofCap = MeshBuilder.CreateBox(`${name}Roof`, { width: 2.82 * scale, height: 0.3 * scale, depth: 2.3 * scale }, this.scene);
      roofCap.parent = root; roofCap.position.set(0, 1.24 * scale, 0); roofCap.rotation.z = 0.14; roofCap.material = roof;
      [-0.64, 0.64].forEach((offset, index) => {
        const pane = MeshBuilder.CreateBox(`${name}Window${index}`, { width: 0.42 * scale, height: 0.56 * scale, depth: 0.04 * scale }, this.scene);
        pane.parent = root; pane.position.set(offset * scale, 0.28 * scale, -1.04 * scale); pane.material = windowMat;
      });
      const door = MeshBuilder.CreateBox(`${name}Door`, { width: 0.46 * scale, height: 0.92 * scale, depth: 0.055 * scale }, this.scene);
      door.parent = root; door.position.set(0, -0.64 * scale, -1.045 * scale); door.material = roof;
    };
    const makeStorefront = (name: string, x: number, z: number, width: number, tint: Color3, rotation = 0) => {
      const body = MeshBuilder.CreateBox(`${name}Body`, { width, height: 2.45, depth: 2.45 }, this.scene);
      body.position.set(x, 1.23, z); body.rotation.y = rotation; body.material = material(this.scene, `${name}Mat`, tint, tint.scale(0.045));
      const cap = MeshBuilder.CreateBox(`${name}Cap`, { width: width + 0.35, height: 0.26, depth: 2.7 }, this.scene);
      cap.parent = body; cap.position.set(0, 1.36, 0); cap.material = roof;
      const awning = MeshBuilder.CreateBox(`${name}Awning`, { width: width + 0.12, height: 0.18, depth: 0.65 }, this.scene);
      awning.parent = body; awning.position.set(0, 0.3, -1.48); awning.material = material(this.scene, `${name}AwningMat`, amber.scale(0.52), amber.scale(0.12));
      [-0.9, 0.9].forEach((offset, index) => {
        const glass = MeshBuilder.CreateBox(`${name}Glass${index}`, { width: 0.92, height: 0.92, depth: 0.04 }, this.scene);
        glass.parent = body; glass.position.set(offset, -0.10, -1.25); glass.material = windowMat;
      });
    };
    const makeVehicle = (name: string, x: number, z: number, tint: Color3, rotation = 0) => {
      const chassis = MeshBuilder.CreateBox(`${name}Chassis`, { width: 1.35, height: 0.48, depth: 2.45 }, this.scene);
      chassis.position.set(x, 0.43, z); chassis.rotation.y = rotation; chassis.material = material(this.scene, `${name}Mat`, tint, tint.scale(0.05));
      const cab = MeshBuilder.CreateBox(`${name}Cab`, { width: 1.18, height: 0.52, depth: 1.12 }, this.scene);
      cab.parent = chassis; cab.position.set(0, 0.43, -0.18); cab.material = windowMat;
      [-0.52, 0.52].forEach((side, index) => [-0.72, 0.72].forEach((front, inner) => {
        const wheel = MeshBuilder.CreateCylinder(`${name}Wheel${index}${inner}`, { height: 0.20, diameter: 0.43, tessellation: 8 }, this.scene);
        wheel.parent = chassis; wheel.position.set(side, -0.27, front); wheel.rotation.z = Math.PI / 2; wheel.material = roof;
      }));
    };
    const makeStreetlight = (name: string, x: number, z: number) => {
      const pole = MeshBuilder.CreateCylinder(`${name}Pole`, { height: 3.7, diameter: 0.09, tessellation: 7 }, this.scene);
      pole.position.set(x, 1.85, z); pole.material = metal;
      const lamp = MeshBuilder.CreateSphere(`${name}Lamp`, { diameter: 0.28, segments: 8 }, this.scene);
      lamp.position.set(x, 3.68, z); lamp.material = material(this.scene, `${name}LampMat`, amber, amber);
      const light = new PointLight(`${name}Light`, new Vector3(x, 3.5, z), this.scene);
      light.diffuse = new Color3(1, 0.62, 0.26); light.intensity = 0.48; light.range = 5.5;
    };
    const makeUtilityPole = (name: string, x: number, z: number) => {
      const pole = MeshBuilder.CreateCylinder(`${name}Pole`, { height: 7.2, diameter: 0.13, tessellation: 7 }, this.scene);
      pole.position.set(x, 3.6, z); pole.material = material(this.scene, `${name}Wood`, new Color3(0.25, 0.19, 0.12));
      const crossbar = MeshBuilder.CreateBox(`${name}Crossbar`, { width: 1.45, height: 0.1, depth: 0.12 }, this.scene);
      crossbar.position.set(x, 6.68, z); crossbar.material = metal;
    };
    const makeCampTent = (name: string, x: number, z: number, tint: Color3, rotation = 0) => {
      const tent = MeshBuilder.CreateCylinder(`${name}Tent`, { height: 1.45, diameterTop: 0.08, diameterBottom: 2.05, tessellation: 3 }, this.scene);
      tent.position.set(x, 0.73, z); tent.rotation.y = rotation; tent.material = material(this.scene, `${name}Mat`, tint, tint.scale(0.05));
      const fire = MeshBuilder.CreateSphere(`${name}Fire`, { diameter: 0.26, segments: 7 }, this.scene);
      fire.position.set(x + 1.35, 0.25, z - 0.1); fire.material = material(this.scene, `${name}FireMat`, amber, amber);
    };
    makeTile("eastSea", 27, 0, 38, 57, 0.045, tide);
    makeTile("northInlet", 6.5, 18.5, 28, 10, 0.05, tide, -0.16);
    makeTile("riverCut", -3.2, -3.6, 6.2, 43, 0.07, tide, 0.18);
    makeTile("mainRoad", -4.5, 2.5, 4.0, 41, 0.09, asphalt, 0.22);
    makeTile("ridgeRoad", -10.2, 6.2, 19, 2.6, 0.1, asphalt, -0.08);
    makeTile("marinaApron", 12.2, 6.8, 10, 9, 0.10, asphalt, 0.06);
    [[15, 7, 8, 0.6], [17, 10.5, 6, 0.5], [19, 4.5, 8, 0.5]].forEach(([x, z, width, depth], index) => makeTile(`pier${index}`, x, z, width, depth, 0.16, dockWood, -0.10));
    [[-13, 12], [-10.4, 12.6], [-7.8, 12.3], [-12.6, 9.3], [-9.9, 9.6], [-7.3, 9.4], [-14, 4.8], [-11.4, 5.1], [-8.8, 5.3], [-12.5, 1.2], [-9.8, 1.4]].forEach(([x, z], index) => makeHome(`rowHome${index}`, x, z, [new Color3(0.28, 0.40, 0.43), new Color3(0.46, 0.34, 0.25), new Color3(0.34, 0.29, 0.37)][index % 3], 0.75));
    [[-16, -6], [-14, -8], [-12, -6], [-9, -8], [-7, -6], [-15, -11], [-11, -11], [-7, -11], [-4, -12], [2, 14], [4, 15], [6, 14], [8, 15]].forEach(([x, z], index) => makeAutumnTree(`parkTree${index}`, x, z, index));
    [[-14.0, 14.5], [-11.0, 14.7], [-8.0, 14.5], [-5.0, 14.7], [-14.0, 7.0], [-11.0, 7.0], [-8.0, 7.0], [-14.0, 2.1], [-11.0, 2.1], [-8.0, 2.1], [-12.0, -1.8], [-9.0, -1.8], [-6.0, -1.8]].forEach(([x, z], index) => makeTownhouse(`townhouse${index}`, x, z, storefrontMats[index % storefrontMats.length], 0.72 + (index % 3) * 0.08, index % 2 ? 0.03 : -0.03));
    [[-2.4, 5.6, 3.6], [2.0, 6.1, 3.0], [6.0, 6.5, 3.3], [9.2, 8.7, 3.2]].forEach(([x, z, width], index) => makeStorefront(`mainStreet${index}`, x, z, width, storefrontMats[(index + 1) % storefrontMats.length], 0.08));
    [[-4.8, 2.8], [-3.6, 0.2], [-6.9, 4.7], [2.4, 5.0], [7.2, 7.3], [10.8, 5.3], [13.6, 7.0]].forEach(([x, z], index) => makeVehicle(`parkedVehicle${index}`, x, z, [new Color3(0.22, 0.48, 0.58), new Color3(0.56, 0.24, 0.16), new Color3(0.30, 0.35, 0.35)][index % 3], index % 2 ? 0.22 : -0.07));
    [[-6, 1], [-4.1, 4.0], [-2.0, 7.0], [1.4, 7.3], [5.0, 7.8], [8.8, 7.5], [12.5, 5.8], [15.0, 9.4]].forEach(([x, z], index) => makeStreetlight(`streetlight${index}`, x, z));
    for (let mark = -13; mark < 13; mark += 2.6) makeTile(`roadDash${mark}`, -4.6 + mark * 0.09, 3.3 + mark, 0.18, 1.0, 0.15, roadMark, 0.22);
    [[14.5, 7.2], [16.8, 10.6], [19.0, 4.6]].forEach(([x, z], index) => {
      const boat = MeshBuilder.CreateBox(`marinaBoat${index}`, { width: 1.1, height: 0.38, depth: 2.7 }, this.scene);
      boat.position.set(x, 0.34, z); boat.rotation.y = -0.1; boat.material = material(this.scene, `marinaBoatMat${index}`, new Color3(0.75, 0.78, 0.72), new Color3(0.03, 0.03, 0.025));
      const cabin = MeshBuilder.CreateBox(`marinaCabin${index}`, { width: 0.76, height: 0.38, depth: 0.85 }, this.scene);
      cabin.parent = boat; cabin.position.set(0, 0.34, -0.22); cabin.material = windowMat;
    });
    const centerLineMat = material(this.scene, "highwayCenterMat", new Color3(0.78, 0.58, 0.12), new Color3(0.08, 0.04, 0.006));
    const shoreGravel = material(this.scene, "shoreGravelMat", new Color3(0.26, 0.25, 0.20), new Color3(0.012, 0.012, 0.01));
    makeTile("shorelineHighway", -4.8, 0.5, 6.4, 54, 0.18, asphalt, 0.01);
    const photoRoadSurface = MeshBuilder.CreateGround("userPhotoRoadSurface", { width: 5.9, height: 43 }, this.scene);
    photoRoadSurface.position.set(-4.8, 0.235, -0.8); photoRoadSurface.material = photoRoad;
    makeTile("shorelineShoulderWest", -7.82, 0.5, 0.36, 54, 0.205, roadMark, 0.01);
    makeTile("shorelineShoulderEast", -1.78, 0.5, 0.36, 54, 0.205, roadMark, 0.01);
    for (let z = -22; z < 24; z += 4.2) makeTile(`highwayCenterDash${z}`, -4.8, z, 0.18, 1.95, 0.225, centerLineMat, 0.01);
    makeTile("lakesideGravel", -10.6, 0.5, 5.2, 54, 0.12, shoreGravel, 0.01);
    makeTile("lakesideWater", -18.2, 1.0, 12.5, 57, 0.09, tide, 0.01);
    [[-8.2, -18], [-8.2, -9], [-8.2, 0], [-8.2, 9], [-8.2, 18]].forEach(([x, z], index) => makeUtilityPole(`lakesidePole${index}`, x, z));
    [[-7.2, -13.5], [-7.2, -4.5], [-7.2, 4.5], [-7.2, 13.5]].forEach(([x, z], index) => {
      const line = MeshBuilder.CreateBox(`utilityLine${index}`, { width: 0.045, height: 0.045, depth: 9 }, this.scene);
      line.position.set(x, 6.35, z); line.material = metal;
    });
    [[-12.3, -9.6], [-14.1, -6.8], [-11.5, -4.0], [-13.5, -1.4]].forEach(([x, z], index) => makeCampTent(`tidegateTent${index}`, x, z, [new Color3(0.15, 0.33, 0.28), new Color3(0.36, 0.22, 0.14), new Color3(0.20, 0.27, 0.34)][index % 3], index * 0.7));
    const parkSignPost = MeshBuilder.CreateCylinder("tidegateParkSignPost", { height: 2.3, diameter: 0.12, tessellation: 7 }, this.scene);
    parkSignPost.position.set(-12.2, 1.15, -13.0); parkSignPost.material = material(this.scene, "tidegateSignPostMat", new Color3(0.25, 0.16, 0.09));
    const parkSign = MeshBuilder.CreateBox("tidegateParkSign", { width: 2.7, height: 0.82, depth: 0.12 }, this.scene);
    parkSign.position.set(-12.2, 2.2, -13.0); parkSign.material = material(this.scene, "tidegateSignMat", new Color3(0.13, 0.36, 0.25), new Color3(0.01, 0.05, 0.025));
    [[-11.8, 7.2], [-13.8, 12.0], [-10.8, 15.8], [-12.2, 19.1], [-14.8, 2.6]].forEach(([x, z], index) => makeStreetlight(`roadLight${index}`, x, z));
    const photoMapBackdrop = MeshBuilder.CreatePlane("userRoadPhotoMap", { width: 30, height: 40 }, this.scene);
    photoMapBackdrop.position.set(-4.8, 12.5, 23.5); photoMapBackdrop.rotation.y = Math.PI; photoMapBackdrop.material = photoBackdrop;
    const beacon = MeshBuilder.CreateCylinder("breakwaterBeacon", { height: 5.8, diameterTop: 0.12, diameterBottom: 0.42, tessellation: 8 }, this.scene);
    beacon.position.set(20, 2.9, 9); beacon.material = material(this.scene, "beaconMat", new Color3(0.85, 0.52, 0.18), amber.scale(0.34));
    const beaconLight = MeshBuilder.CreateSphere("breakwaterBeaconLight", { diameter: 0.52, segments: 8 }, this.scene);
    beaconLight.position.set(20, 5.9, 9); beaconLight.material = material(this.scene, "beaconLightMat", amber, amber);
    return ground;
  }

  /** Lakeside Park daylight visual system: literal photo composition, straight rising road, left shore, right campground. */
  private createLakesideParkEnvironment() {
    const grass = material(this.scene, "parkGrassMat", new Color3(0.18, 0.33, 0.12), new Color3(0.018, 0.034, 0.01));
    const gravel = material(this.scene, "parkGravelMat", new Color3(0.38, 0.34, 0.26), new Color3(0.014, 0.012, 0.009));
    const asphalt = material(this.scene, "parkAsphaltMat", new Color3(0.12, 0.13, 0.13), new Color3(0.006, 0.006, 0.006));
    const whiteMark = material(this.scene, "parkWhiteMarkMat", new Color3(0.85, 0.86, 0.82), new Color3(0.04, 0.04, 0.035));
    const yellowMark = material(this.scene, "parkYellowMarkMat", new Color3(0.94, 0.64, 0.12), new Color3(0.10, 0.055, 0.006));
    const wood = material(this.scene, "parkWoodMat", new Color3(0.31, 0.20, 0.11), new Color3(0.018, 0.010, 0.004));
    const poleMetal = material(this.scene, "parkPoleMetalMat", new Color3(0.42, 0.41, 0.36), new Color3(0.018, 0.018, 0.014));
    const water = material(this.scene, "parkWaterMat", new Color3(0.07, 0.31, 0.42), new Color3(0.025, 0.11, 0.16));
    water.specularColor = new Color3(0.78, 0.88, 0.92); water.specularPower = 96;
    const ground = MeshBuilder.CreateGround("lakesideParkLand", { width: 58, height: 66, subdivisions: 2 }, this.scene);
    ground.material = grass; ground.isPickable = true;

    const tile = (name: string, x: number, z: number, width: number, depth: number, y: number, mat: StandardMaterial) => {
      const mesh = MeshBuilder.CreateBox(name, { width, height: 0.09, depth }, this.scene);
      mesh.position.set(x, y, z); mesh.material = mat; return mesh;
    };
    const tree = (name: string, x: number, z: number, scale: number, tint: Color3) => {
      const trunk = MeshBuilder.CreateCylinder(`${name}Trunk`, { height: 2.3 * scale, diameter: 0.25 * scale, tessellation: 7 }, this.scene);
      trunk.position.set(x, 1.15 * scale, z); trunk.material = wood;
      const crown = MeshBuilder.CreateSphere(`${name}Crown`, { diameter: 2.45 * scale, segments: 8 }, this.scene);
      crown.position.set(x, 3.0 * scale, z); crown.scaling.set(1.08, 1.16, 0.94); crown.material = material(this.scene, `${name}LeafMat`, tint, tint.scale(0.035));
    };
    const rv = (name: string, x: number, z: number, rotation: number, stripe: Color3) => {
      const body = MeshBuilder.CreateBox(`${name}Body`, { width: 2.65, height: 1.7, depth: 5.6 }, this.scene);
      body.position.set(x, 1.02, z); body.rotation.y = rotation; body.material = material(this.scene, `${name}BodyMat`, new Color3(0.78, 0.78, 0.70), new Color3(0.022, 0.022, 0.018));
      const cap = MeshBuilder.CreateBox(`${name}Cap`, { width: 2.83, height: 0.15, depth: 5.82 }, this.scene);
      cap.parent = body; cap.position.set(0, 0.93, 0); cap.material = poleMetal;
      const stripeBand = MeshBuilder.CreateBox(`${name}Stripe`, { width: 2.69, height: 0.25, depth: 4.4 }, this.scene);
      stripeBand.parent = body; stripeBand.position.set(0, -0.15, -0.12); stripeBand.material = material(this.scene, `${name}StripeMat`, stripe, stripe.scale(0.06));
      for (const offset of [-0.92, 0.92]) {
        const window = MeshBuilder.CreateBox(`${name}Window${offset}`, { width: 2.70, height: 0.48, depth: 0.74 }, this.scene);
        window.parent = body; window.position.set(0, 0.27, offset); window.material = material(this.scene, `${name}WindowMat${offset}`, new Color3(0.11, 0.30, 0.38), new Color3(0.018, 0.07, 0.09));
      }
    };
    const utilityPole = (name: string, x: number, z: number, height = 9.3) => {
      const pole = MeshBuilder.CreateCylinder(`${name}Pole`, { height, diameter: 0.16, tessellation: 8 }, this.scene);
      pole.position.set(x, height / 2, z); pole.material = poleMetal;
      const crossbar = MeshBuilder.CreateBox(`${name}Crossbar`, { width: 2.25, height: 0.12, depth: 0.16 }, this.scene);
      crossbar.position.set(x, height - 1.05, z); crossbar.material = poleMetal;
    };

    // Exact photo road: camera begins on the right lane, looking uphill along the double-yellow route.
    tile("parkHighway", 0, 2.2, 15.8, 58, 0.12, asphalt);
    tile("westGravelVerge", -8.95, 2.2, 2.25, 58, 0.085, gravel);
    tile("eastGravelVerge", 8.95, 2.2, 2.25, 58, 0.085, gravel);
    tile("whiteShoulderWest", -6.88, 2.2, 0.22, 58, 0.18, whiteMark);
    tile("whiteShoulderEast", 6.88, 2.2, 0.22, 58, 0.18, whiteMark);
    tile("doubleYellowWest", -0.20, 2.2, 0.16, 58, 0.19, yellowMark);
    tile("doubleYellowEast", 0.20, 2.2, 0.16, 58, 0.19, yellowMark);

    // Left shore: the photo’s lake edge, wooden rail, small beach, seating, and campground sign.
    tile("lakesideWater", -17.5, 1.8, 18, 57, 0.065, water);
    tile("lakesideBeach", -11.0, 3.8, 5.5, 18, 0.10, gravel);
    for (let z = -11; z <= 12; z += 4.6) {
      const post = MeshBuilder.CreateCylinder(`shoreRailPost${z}`, { height: 1.2, diameter: 0.16, tessellation: 7 }, this.scene);
      post.position.set(-8.4, 0.66, z); post.material = wood;
      const rail = MeshBuilder.CreateBox(`shoreRail${z}`, { width: 0.16, height: 0.14, depth: 4.75 }, this.scene);
      rail.position.set(-8.4, 0.98, z + 2.3); rail.material = wood;
    }
    [[-13.4, -0.6, new Color3(0.86, 0.20, 0.13)], [-14.4, 1.0, new Color3(0.88, 0.23, 0.16)]].forEach(([x, z, tint], index) => {
      const chair = MeshBuilder.CreateBox(`beachChair${index}`, { width: 0.72, height: 0.34, depth: 0.86 }, this.scene);
      chair.position.set(x as number, 0.30, z as number); chair.rotation.x = -0.28; chair.material = material(this.scene, `beachChairMat${index}`, tint as Color3, (tint as Color3).scale(0.05));
    });
    const signTexture = new DynamicTexture("lakesideParkSignTexture", { width: 900, height: 560 }, this.scene, true);
    const signContext = signTexture.getContext() as unknown as CanvasRenderingContext2D;
    signContext.fillStyle = "#d34f38"; signContext.fillRect(0, 0, 900, 560);
    signContext.strokeStyle = "#f7e4a4"; signContext.lineWidth = 24; signContext.strokeRect(22, 22, 856, 516);
    signContext.fillStyle = "#fff4cf"; signContext.font = "bold 128px sans-serif"; signContext.textAlign = "center";
    signContext.fillText("Lakeside", 450, 205); signContext.fillText("Park", 450, 335);
    signContext.font = "bold 62px sans-serif"; signContext.fillText("Campground", 450, 445); signTexture.update();
    const signMaterial = new StandardMaterial("lakesideParkSignMat", this.scene);
    signMaterial.diffuseTexture = signTexture; signMaterial.emissiveTexture = signTexture; signMaterial.specularColor = Color3.Black(); signMaterial.backFaceCulling = false;
    const signPost = MeshBuilder.CreateCylinder("lakesideParkSignPost", { height: 3.05, diameter: 0.18, tessellation: 8 }, this.scene);
    signPost.position.set(-10.5, 1.52, 4.1); signPost.material = wood;
    const sign = MeshBuilder.CreatePlane("lakesideParkCampgroundSign", { width: 4.15, height: 2.58 }, this.scene);
    sign.position.set(-10.5, 3.15, 4.03); sign.material = signMaterial;

    // Right side: dense daylight treeline, utility corridor and the visible RV campground.
    const leafPalette = [new Color3(0.09, 0.31, 0.10), new Color3(0.16, 0.42, 0.13), new Color3(0.35, 0.43, 0.09), new Color3(0.43, 0.30, 0.08)];
    [[-15, 1.05], [-10, 0.92], [-5, 1.06], [1, 0.94], [7, 1.04], [13, 0.92], [19, 1.08], [25, 0.94]].forEach(([z, scale], index) => tree(`rightTree${index}`, 16.2 + (index % 2) * 1.25, z, scale, leafPalette[index % leafPalette.length]));
    [[-13, 0.98], [-7, 0.88], [0, 0.95], [8, 0.91], [15, 1.03], [22, 0.90]].forEach(([z, scale], index) => tree(`leftTree${index}`, -14.6 - (index % 2) * 1.3, z, scale, leafPalette[(index + 2) % leafPalette.length]));
    [[-17, 9.2], [-7, 9.5], [4, 9.8], [15, 10.1], [26, 10.4]].forEach(([z, height], index) => utilityPole(`roadUtility${index}`, 8.0, z, height));
    for (let z = -12; z <= 20; z += 10.7) {
      const wire = MeshBuilder.CreateBox(`utilityWire${z}`, { width: 0.045, height: 0.045, depth: 10.8 }, this.scene);
      wire.position.set(8.0, 8.15, z); wire.material = poleMetal;
      const secondWire = wire.clone(`utilityWireSecond${z}`); secondWire.position.x += 0.62; secondWire.position.y += 0.26;
    }
    rv("campRvOne", 13.1, -5.6, -0.05, new Color3(0.24, 0.54, 0.53));
    rv("campRvTwo", 14.1, 6.1, -0.04, new Color3(0.55, 0.32, 0.15));
    rv("campRvThree", 12.4, 17.3, -0.04, new Color3(0.23, 0.37, 0.62));
    [[11.0, -9.2], [11.8, 1.7], [11.2, 12.2]].forEach(([x, z], index) => {
      const utilityBox = MeshBuilder.CreateBox(`campUtilityBox${index}`, { width: 1.2, height: 1.25, depth: 0.85 }, this.scene);
      utilityBox.position.set(x, 0.62, z); utilityBox.material = material(this.scene, `campUtilityMat${index}`, new Color3(0.34, 0.36, 0.32), new Color3(0.02, 0.02, 0.018));
    });

    // The user’s actual photograph stays in the forward view as the literal horizon and road-matching backdrop.
    const photoMaterial = new StandardMaterial("lakesidePhotoBackdropMat", this.scene);
    const photoTexture = new Texture(uploadedRoadPhotoUrl, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    photoMaterial.diffuseTexture = photoTexture; photoMaterial.emissiveTexture = photoTexture; photoMaterial.specularColor = Color3.Black(); photoMaterial.backFaceCulling = false;
    const photoBackdrop = MeshBuilder.CreatePlane("lakesidePhotoGroundTruth", { width: 31, height: 41.3 }, this.scene);
    photoBackdrop.position.set(0, -6.4, 31.5); photoBackdrop.material = photoMaterial;
    return ground;
  }

  private createStorm() {
    const storm = MeshBuilder.CreateTorus("stormBoundary", { diameter: 38, thickness: 0.24, tessellation: 96 }, this.scene);
    storm.rotation.x = Math.PI / 2; storm.position.y = 0.14;
    storm.material = material(this.scene, "stormBoundaryMat", violet.scale(0.08), violet.scale(0.14));
    for (let i = 0; i < 18; i += 1) {
      const pylon = MeshBuilder.CreateCylinder(`stormPylon${i}`, { height: 0.95 + (i % 3) * 0.18, diameterTop: 0.04, diameterBottom: 0.18, tessellation: 6 }, this.scene);
      pylon.material = material(this.scene, `stormPylonMat${i}`, violet.scale(0.45), violet.scale(0.7));
      pylon.visibility = 0.05;
      this.stormPylons.push(pylon);
    }
    return storm;
  }

  private createStormHalo() {
    const halo = MeshBuilder.CreateTorus("stormSkyHalo", { diameter: 38, thickness: 0.14, tessellation: 96 }, this.scene);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 3.9;
    halo.material = material(this.scene, "stormSkyHaloMat", violet.scale(0.04), violet.scale(0.08));
    halo.visibility = 0.04;
    return halo;
  }

  private createSectorCover() {
    const coverMat = material(this.scene, "sectorCoverMat", new Color3(0.11, 0.13, 0.15), new Color3(0.015, 0.018, 0.02));
    const stripeMat = material(this.scene, "sectorCoverStripeMat", amber.scale(0.55), amber.scale(0.18));
    this.coverNodes.forEach((node, index) => {
      const width = index % 2 === 0 ? 2.9 : 2.1;
      const cover = MeshBuilder.CreateBox(`breakwaterCover${index}`, { width, height: 1.8, depth: 0.76 }, this.scene);
      cover.position.set(node.x, 0.9, node.z);
      cover.rotation.y = index % 2 === 0 ? 0.18 : -0.32;
      cover.material = coverMat;
      const stripe = MeshBuilder.CreateBox(`breakwaterCoverStripe${index}`, { width: width * 0.68, height: 0.14, depth: 0.78 }, this.scene);
      stripe.position.set(node.x, 1.42, node.z - 0.01);
      stripe.rotation.y = cover.rotation.y;
      stripe.material = stripeMat;
    });
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
    return { mesh: body, health: 100, cooldown: Math.random() * 0.6, speed: player ? 8.2 : 2.1 + Math.random() * 0.55, team, alive: true, phase: Math.random() * Math.PI * 2, anchor: position.clone(), behavior: "patrol" };
  }

  private createMatchEntities() {
    [new Vector3(-9.6, 0.7, -8.0), new Vector3(9.8, 0.7, -4.0), new Vector3(-9.5, 0.7, 1.8), new Vector3(9.9, 0.7, 5.4), new Vector3(-9.4, 0.7, 10.2), new Vector3(9.9, 0.7, 13.8), new Vector3(-11.6, 0.7, 15.4), new Vector3(13.2, 0.7, 17.4)].forEach((position) => this.enemies.push(this.createActor("enemy", position)));
    const lootRoute: Array<[Vector3, Pickup["kind"]]> = [
      [new Vector3(6.8, 0, -12.2), "med"], [new Vector3(-7.2, 0, -5.2), "ammo"], [new Vector3(7.0, 0, 1.8), "burst"], [new Vector3(-7.1, 0, 8.8), "armor"],
      [new Vector3(-10.4, 0, -1.8), "med"], [new Vector3(11.1, 0, 5.6), "ammo"], [new Vector3(-9.6, 0, 14.0), "burst"], [new Vector3(11.6, 0, 15.5), "armor"],
    ];
    lootRoute.forEach(([position, kind], index) => this.pickups.push(this.createPickup(position, kind, index)));
  }

  private createPickup(position: Vector3, kind: Pickup["kind"], index: number): Pickup {
    const signal = kind === "med" ? new Color3(0.36, 0.95, 0.62) : kind === "armor" ? new Color3(0.36, 0.67, 1) : amber;
    const root = MeshBuilder.CreateCylinder(`supplyPad${index}`, { height: 0.12, diameter: 1.8, tessellation: 6 }, this.scene);
    root.position = position.add(new Vector3(0, 0.11, 0)); root.material = material(this.scene, `supplyPadMat${index}`, signal.scale(0.24), signal.scale(0.18));
    const glow = MeshBuilder.CreateCylinder(`supplyGlow${index}`, { height: 0.34, diameter: 1.38, tessellation: 6 }, this.scene);
    glow.position = position.add(new Vector3(0, 0.24, 0)); glow.material = material(this.scene, `supplyGlowMat${index}`, signal.scale(0.56), signal.scale(0.72));
    const core = MeshBuilder.CreateCylinder(`supplyCore${index}`, { height: 0.42, diameterTop: 0.78, diameterBottom: 1.02, tessellation: 6 }, this.scene);
    core.position = position.add(new Vector3(0, 0.55, 0)); core.material = material(this.scene, `supplyCoreMat${index}`, charcoal, signal.scale(0.6));
    return { root, glow, core, kind, collected: false, phase: index * 0.72 };
  }

  private bindInputs(canvas: HTMLCanvasElement) {
    const keyDown = (event: Event) => {
      const key = (event as KeyboardEvent).key.toLowerCase();
      if (["w", "a", "s", "d", "r", "q", "1", "2", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
      this.pressed.add(key); if (key === " " && this.state === "active") this.firePlayer();
      if (key === "r" && this.state === "active") this.beginReload();
      if ((key === "q" || key === "1" || key === "2") && this.state === "active") this.switchWeapon(key === "2" ? "scatter" : key === "1" ? "volt" : undefined);
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
    const controls = (event: Event) => { const detail = (event as CustomEvent<{ autoFire?: boolean; soundOn?: boolean }>).detail; this.autoFire = Boolean(detail.autoFire); this.soundEnabled = detail.soundOn !== false; };
    const reload = () => this.beginReload();
    const switchWeapon = (event: Event) => this.switchWeapon((event as CustomEvent<{ weapon?: WeaponKind }>).detail?.weapon);
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp); window.addEventListener("stormfall-start", start); window.addEventListener("stormfall-restart", restart); window.addEventListener("stormfall-mobile-move", mobileMove); window.addEventListener("stormfall-mobile-aim", mobileAim); window.addEventListener("stormfall-mobile-fire", mobileFire); window.addEventListener("stormfall-controls", controls); window.addEventListener("stormfall-reload", reload); window.addEventListener("stormfall-switch-weapon", switchWeapon);
    this.listeners.push([window, "keydown", keyDown], [window, "keyup", keyUp], [window, "stormfall-start", start], [window, "stormfall-restart", restart], [window, "stormfall-mobile-move", mobileMove], [window, "stormfall-mobile-aim", mobileAim], [window, "stormfall-mobile-fire", mobileFire], [window, "stormfall-controls", controls], [window, "stormfall-reload", reload], [window, "stormfall-switch-weapon", switchWeapon]);
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERMOVE || info.type === PointerEventTypes.POINTERDOWN) {
        const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (mesh) => mesh === this.ground);
        if (pick?.hit && pick.pickedPoint) this.pointerTarget.copyFrom(pick.pickedPoint);
      }
      if (info.type === PointerEventTypes.POINTERDOWN && this.state === "active") this.firePlayer();
    });
  }

  private start() { if (this.state !== "active") { this.state = "active"; this.beginAudioField(); this.pulseTone(190, 0.08, "triangle", 0.05); this.toast = "DROP CONFIRMED — CONTROL THE SECTOR"; this.emitHud(); } }

  private reset() {
    [...this.enemies.map((enemy) => enemy.mesh), ...this.projectiles.map((projectile) => projectile.mesh), ...this.pickups.flatMap((pickup) => [pickup.root, pickup.glow, pickup.core])].forEach((mesh) => mesh.dispose());
    this.enemies = []; this.projectiles = []; this.pickups = []; this.player.mesh.position.copyFrom(this.playerSpawn); this.player.mesh.rotation.y = 0; this.player.health = 100; this.player.alive = true; this.timer = 150; this.stormRadius = 19; this.elapsed = 0; this.burstRemaining = 0; this.streak = 0; this.activeWeapon = "volt"; this.magazine = 12; this.reserveAmmo = 72; this.scatterMagazine = 5; this.scatterReserve = 30; this.reloadTimer = 0; this.hitConfirmTimer = 0; this.muzzleFlashTimer = 0; this.damageFlashTimer = 0; this.mobileMovement.setAll(0); this.mobileAim.setAll(0); this.mobileFiring = false; this.state = "briefing"; this.toast = "BREAKWATER RELAY UPLINK ACQUIRED"; this.createMatchEntities(); this.emitHud();
  }

  private update(delta: number) {
    this.elapsed += delta; this.animateStorm(delta);
    if (this.state === "active") {
      this.timer = Math.max(0, this.timer - delta); this.stormRadius = Math.max(8, 19 - ((150 - this.timer) / 150) * 11);
      this.updateWeapon(delta); this.updatePlayer(delta); this.updateEnemies(delta); this.updateProjectiles(delta); this.updatePickups(delta); this.applyStormDamage(delta);
      if (this.enemies.every((enemy) => !enemy.alive)) this.finish("victory");
      if (this.player.health <= 0 || this.timer <= 0) this.finish("defeat");
    }
    this.playerRing.position.x = this.player.mesh.position.x; this.playerRing.position.z = this.player.mesh.position.z; this.playerRing.rotation.z += delta * 0.85; this.updateCamera();
    this.hudElapsed += delta; if (this.hudElapsed > 0.12) { this.hudElapsed = 0; this.emitHud(); }
  }

  private animateStorm(delta: number) {
    const pressure = this.stormPressure();
    this.storm.scaling.set(this.stormRadius / 19, this.stormRadius / 19, this.stormRadius / 19);
    this.stormHalo.scaling.set(this.stormRadius / 19, this.stormRadius / 19, this.stormRadius / 19);
    this.stormHalo.rotation.z += delta * (0.16 + pressure * 0.32);
    this.scene.fogDensity = 0.001 + pressure * 0.012;
    this.scene.fogColor = new Color3(0.48 - pressure * 0.18, 0.72 - pressure * 0.30, 0.95 - pressure * 0.40);
    this.lightningTimer -= delta;
    this.lightningFlashTimer = Math.max(0, this.lightningFlashTimer - delta);
    if (this.lightningTimer <= 0) {
      this.lightningTimer = 1.35 + Math.random() * 2.8 - pressure * 0.75;
      this.lightningFlashTimer = 0.10 + pressure * 0.07;
      this.lightningLight.position.copyFrom(this.player.mesh.position.add(new Vector3((Math.random() - 0.5) * 20, 11, (Math.random() - 0.5) * 20)));
      this.pulseTone(85 + Math.random() * 35, 0.16, "sawtooth", 0.028 + pressure * 0.025);
    }
    this.lightningLight.intensity = this.lightningFlashTimer > 0 ? 10 + pressure * 13 : 0;
    this.stormPylons.forEach((pylon, index) => {
      const angle = (index / this.stormPylons.length) * Math.PI * 2 + this.elapsed * 0.08;
      pylon.position.set(Math.cos(angle) * this.stormRadius, 0.72 + Math.sin(this.elapsed * 2.2 + index) * 0.2, Math.sin(angle) * this.stormRadius);
      pylon.rotation.y = -angle; pylon.scaling.y = 0.75 + Math.sin(this.elapsed * 3 + index) * 0.22;
    });
  }

  private updatePlayer(delta: number) {
    const movement = new Vector3(0, 0, 0);
    if (this.demo) {
      this.pointerTarget.copyFrom(new Vector3(0, 0, 28));
      this.firePlayer();
    } else {
      if (this.pressed.has("w") || this.pressed.has("arrowup")) movement.z += 1;
      if (this.pressed.has("s") || this.pressed.has("arrowdown")) movement.z -= 1;
      if (this.pressed.has("a") || this.pressed.has("arrowleft")) movement.x -= 1;
      if (this.pressed.has("d") || this.pressed.has("arrowright")) movement.x += 1;
      if (this.mobileMovement.lengthSquared() > 0) movement.addInPlace(this.mobileMovement);
      if (this.mobileAim.lengthSquared() > 0.04) this.pointerTarget.copyFrom(this.player.mesh.position.add(this.mobileAim.scale(13)));
      if (this.mobileFiring || (this.autoFire && this.mobileAim.lengthSquared() > 0.04)) this.firePlayer();
    }
    if (movement.lengthSquared() > 0) { movement.normalize(); this.player.mesh.position.addInPlace(movement.scale(this.player.speed * delta)); }
    const aim = this.pointerTarget.subtract(this.player.mesh.position); aim.y = 0; if (aim.lengthSquared() > 0.1) this.player.mesh.rotation.y = Math.atan2(aim.x, aim.z);
    clampArena(this.player.mesh.position, 21); this.resolveCoverCollision(this.player.mesh.position); this.player.cooldown = Math.max(0, this.player.cooldown - delta); this.burstRemaining = Math.max(0, this.burstRemaining - delta);
  }

  private updateCamera() {
    const forward = new Vector3(Math.sin(this.player.mesh.rotation.y), 0, Math.cos(this.player.mesh.rotation.y));
    this.camera.position.copyFrom(this.player.mesh.position.subtract(forward.scale(6.8)).add(new Vector3(0, 3.15, 0)));
    this.camera.setTarget(this.player.mesh.position.add(forward.scale(4.8)).add(new Vector3(0, 0.65, 0)));
  }

  private updateEnemies(delta: number) {
    this.enemies.filter((enemy) => enemy.alive).forEach((enemy) => {
      enemy.cooldown = Math.max(0, enemy.cooldown - delta); const toPlayer = this.player.mesh.position.subtract(enemy.mesh.position); const range = Math.max(0.01, Math.hypot(toPlayer.x, toPlayer.z));
      const nearbyCover = this.coverNodes.slice().sort((a, b) => distance(a, enemy.mesh.position) - distance(b, enemy.mesh.position))[0];
      let goal = enemy.anchor;
      if (enemy.health < 40 && range < 11) { enemy.behavior = "retreat"; goal = enemy.mesh.position.subtract(toPlayer.normalize().scale(6)); }
      else if (range < 9 && Math.sin(this.elapsed * 0.85 + enemy.phase) > 0.45) { enemy.behavior = "cover"; goal = nearbyCover; }
      else if (range < 15) { enemy.behavior = "pursuit"; goal = this.player.mesh.position; }
      else { enemy.behavior = "patrol"; goal = enemy.anchor.add(new Vector3(Math.cos(this.elapsed * 0.45 + enemy.phase) * 2.1, 0, Math.sin(this.elapsed * 0.45 + enemy.phase) * 2.1)); }
      const toGoal = goal.subtract(enemy.mesh.position); toGoal.y = 0;
      if (toGoal.lengthSquared() > 0.65) enemy.mesh.position.addInPlace(toGoal.normalize().scale(enemy.speed * delta));
      enemy.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z); if (range < 13.5 && enemy.cooldown <= 0) this.fire(enemy, this.player.mesh.position); clampArena(enemy.mesh.position, 21); this.resolveCoverCollision(enemy.mesh.position);
    });
  }

  private resolveCoverCollision(position: Vector3) {
    this.coverNodes.forEach((node) => {
      const offset = position.subtract(node); offset.y = 0;
      const range = offset.length();
      if (range > 0.001 && range < 1.55) position.addInPlace(offset.scale((1.55 - range) / range));
    });
  }

  private nearestEnemy() { return this.enemies.filter((enemy) => enemy.alive).sort((a, b) => distance(a.mesh.position, this.player.mesh.position) - distance(b.mesh.position, this.player.mesh.position))[0]; }
  private beginReload() {
    const capacity = this.activeWeapon === "volt" ? 12 : 5;
    if (this.reloadTimer > 0 || this.currentMagazine() >= capacity || this.currentReserve() <= 0) return;
    this.reloadTimer = 1.1;
    this.mobileFiring = false;
    this.toast = `RELOADING ${this.weaponName()}`;
  }
  private updateWeapon(delta: number) {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - delta);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - delta);
    this.damageFlashTimer = Math.max(0, this.damageFlashTimer - delta);
    if (this.reloadTimer <= 0) return;
    this.reloadTimer = Math.max(0, this.reloadTimer - delta);
    if (this.reloadTimer === 0) {
      const capacity = this.activeWeapon === "volt" ? 12 : 5;
      const loaded = Math.min(capacity - this.currentMagazine(), this.currentReserve());
      this.setCurrentMagazine(this.currentMagazine() + loaded);
      this.setCurrentReserve(this.currentReserve() - loaded);
      this.toast = "MAGAZINE LOCKED — READY";
      this.pulseTone(this.activeWeapon === "volt" ? 250 : 180, 0.08, "square", 0.045);
    }
  }
  private firePlayer() {
    if (!this.player.alive || this.player.cooldown > 0 || this.reloadTimer > 0) return;
    if (this.currentMagazine() <= 0) { this.beginReload(); return; }
    if (this.activeWeapon === "scatter") {
      const base = this.pointerTarget.subtract(this.player.mesh.position); base.y = 0; base.normalize();
      [-0.22, -0.11, 0, 0.11, 0.22].forEach((spread) => this.fire(this.player, this.player.mesh.position.add(new Vector3(base.x * 13 - base.z * spread, 0, base.z * 13 + base.x * spread)), "scatter"));
    } else this.fire(this.player, this.pointerTarget, "volt");
    this.setCurrentMagazine(this.currentMagazine() - 1);
    this.muzzleFlashTimer = 0.12;
    this.pulseTone(this.activeWeapon === "volt" ? 165 : 104, this.activeWeapon === "volt" ? 0.045 : 0.07, "square", this.activeWeapon === "volt" ? 0.035 : 0.055);
    if (this.currentMagazine() === 0) this.beginReload();
  }

  private fire(actor: Actor, target: Vector3, weapon: WeaponKind = "volt") {
    actor.cooldown = actor.team === "player" ? (weapon === "scatter" ? 0.72 : this.burstRemaining > 0 ? 0.12 : 0.28) : 0.92 + Math.random() * 0.28;
    const origin = actor.mesh.position.add(new Vector3(0, 0.25, 0)); const direction = target.subtract(origin); direction.y = 0; if (direction.lengthSquared() < 0.1) return; direction.normalize();
    const bolt = MeshBuilder.CreateSphere(`bolt${Math.random()}`, { diameter: actor.team === "player" ? 0.28 : 0.23, segments: 8 }, this.scene);
    bolt.position.copyFrom(origin.add(direction.scale(0.76))); const color = actor.team === "player" ? weapon === "scatter" ? new Color3(0.70, 0.86, 1) : amber : coral; bolt.material = material(this.scene, `boltMat${Math.random()}`, color, color);
    this.projectiles.push({ mesh: bolt, velocity: direction.scale(actor.team === "player" ? weapon === "scatter" ? 15 : 19 : 14), team: actor.team, life: 1.3, weapon });
  }

  private updateProjectiles(delta: number) {
    this.projectiles = this.projectiles.filter((projectile) => {
      projectile.life -= delta; projectile.mesh.position.addInPlace(projectile.velocity.scale(delta)); let hit = projectile.life <= 0;
      if (projectile.team === "player") {
        for (const enemy of this.enemies.filter((entry) => entry.alive)) if (distance(projectile.mesh.position, enemy.mesh.position) < 0.85) { const damage = projectile.weapon === "scatter" ? 16 : this.burstRemaining > 0 ? 42 : 30; this.damage(enemy, damage, `HIT +${damage}`); this.hitConfirmTimer = 0.28; hit = true; break; }
      } else if (distance(projectile.mesh.position, this.player.mesh.position) < 0.9) { this.damage(this.player, 11, "INCOMING FIRE — FIND COVER", projectile.velocity); hit = true; }
      if (hit) projectile.mesh.dispose(); return !hit;
    });
  }

  private updatePickups(delta: number) {
    this.pickups.filter((pickup) => !pickup.collected).forEach((pickup) => {
      pickup.core.position.y = 0.55 + Math.sin(this.elapsed * 2.4 + pickup.phase) * 0.08; pickup.glow.scaling.setAll(0.94 + Math.sin(this.elapsed * 2.8 + pickup.phase) * 0.07); pickup.core.rotation.y += delta * 0.75;
      if (distance(this.player.mesh.position, pickup.root.position) < 1.42) {
        pickup.collected = true; pickup.root.dispose(); pickup.glow.dispose(); pickup.core.dispose(); this.streak += 1;
        if (pickup.kind === "med") { this.player.health = Math.min(100, this.player.health + 28); this.toast = "MED KIT SECURED — VITALS RESTORED"; }
        else if (pickup.kind === "armor") { this.player.health = Math.min(100, this.player.health + 16); this.toast = "ARMOR PLATE FITTED — HOLD THE LINE"; }
        else if (pickup.kind === "ammo") { this.reserveAmmo += 24; this.scatterReserve += 8; this.toast = "AMMO CACHE SECURED — LOADOUT FED"; }
        else { this.burstRemaining = 8; this.toast = "SURGE MODULE — RAPID FIRE ONLINE"; }
        this.pulseTone(420, 0.08, "sine", 0.05);
      }
    });
  }

  private applyStormDamage(delta: number) { [this.player, ...this.enemies.filter((enemy) => enemy.alive)].forEach((actor) => { if (Math.hypot(actor.mesh.position.x, actor.mesh.position.z) > this.stormRadius - 0.28) this.damage(actor, delta * (actor.team === "player" ? 9 : 15), actor.team === "player" ? "STORM CONTACT — MOVE INWARD" : ""); }); }
  private switchWeapon(requested?: WeaponKind) { const next = requested ?? (this.activeWeapon === "volt" ? "scatter" : "volt"); if (next === this.activeWeapon || this.reloadTimer > 0) return; this.activeWeapon = next; this.pulseTone(320, 0.06, "triangle", 0.04); this.toast = `${this.weaponName()} EQUIPPED — ${this.currentMagazine()} ROUNDS READY`; }
  private weaponName() { return this.activeWeapon === "volt" ? "VOLT-9" : "BREACH-5"; }
  private currentMagazine() { return this.activeWeapon === "volt" ? this.magazine : this.scatterMagazine; }
  private currentReserve() { return this.activeWeapon === "volt" ? this.reserveAmmo : this.scatterReserve; }
  private setCurrentMagazine(value: number) { if (this.activeWeapon === "volt") this.magazine = value; else this.scatterMagazine = value; }
  private setCurrentReserve(value: number) { if (this.activeWeapon === "volt") this.reserveAmmo = value; else this.scatterReserve = value; }
  private damage(actor: Actor, amount: number, message: string, incoming?: Vector3) { if (!actor.alive) return; actor.health -= amount; if (actor.team === "player" && incoming) { this.damageFlashTimer = 0.22; this.damageDirection = Math.atan2(incoming.x, incoming.z); this.pulseTone(72, 0.08, "sawtooth", 0.045); } if (message) this.toast = message; if (actor.health <= 0) { actor.alive = false; actor.mesh.scaling.y = 0.25; actor.mesh.visibility = 0.35; if (actor.team === "enemy") this.toast = "RIVAL ELIMINATED — FIELD THINS"; } }
  private finish(state: MatchState) { if (this.state === "active") { this.state = state; this.pulseTone(state === "victory" ? 520 : 74, 0.24, state === "victory" ? "sine" : "sawtooth", 0.07); this.toast = state === "victory" ? "SECTOR SECURED — LAST SIGNAL STANDING" : "SIGNAL LOST IN THE STORM"; this.emitHud(); } }
  private stormPressure() { return Math.max(0, Math.min(1, (19 - this.stormRadius) / 11)); }
  private beginAudioField() { if (!this.soundEnabled || typeof AudioContext === "undefined") return; if (!this.audioContext) this.audioContext = new AudioContext(); const context = this.audioContext; if (context.state === "suspended") context.resume().catch(() => undefined); if (!this.ambientOscillator) { const gain = context.createGain(); gain.gain.value = 0.012; const oscillator = context.createOscillator(); oscillator.type = "sine"; oscillator.frequency.value = 52; oscillator.connect(gain).connect(context.destination); oscillator.start(); this.ambientOscillator = oscillator; } }
  private pulseTone(frequency: number, duration: number, type: OscillatorType, gainValue: number) { if (!this.soundEnabled || !this.audioContext) return; const context = this.audioContext; const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = type; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(gainValue, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration); }
  private emitHud() { const alternate = this.activeWeapon === "volt" ? this.scatterMagazine : this.magazine; window.dispatchEvent(new CustomEvent<HudState>("stormfall-hud", { detail: { health: Math.max(0, this.player.health), shield: this.player.health > 70 ? 3 : this.player.health > 35 ? 2 : 1, remaining: this.enemies.filter((enemy) => enemy.alive).length, timer: this.timer, stormRadius: this.stormRadius, toast: this.toast, matchState: this.state, streak: this.streak, ammo: this.currentMagazine(), reserve: this.currentReserve(), reloading: this.reloadTimer > 0, reloadProgress: this.reloadTimer > 0 ? (1 - this.reloadTimer / 1.1) * 100 : 0, hitConfirm: this.hitConfirmTimer > 0, weaponName: this.weaponName(), altWeaponName: this.activeWeapon === "volt" ? "BREACH-5" : "VOLT-9", altAmmo: alternate, muzzleFlash: this.muzzleFlashTimer > 0, damageFlash: this.damageFlashTimer > 0, damageDirection: this.damageDirection, stormIntensity: this.stormPressure(), lightning: this.lightningFlashTimer > 0, mapStatus: this.mapStatus } })); }
  dispose() { this.listeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener)); this.projectiles.forEach((projectile) => projectile.mesh.dispose()); this.ambientOscillator?.stop(); this.audioContext?.close().catch(() => undefined); }
}

export async function createGameScene(engine: Engine, canvas: HTMLCanvasElement): Promise<GameHandle> {
  const scene = new Scene(engine);
  const camera = new FreeCamera("sableRidgeCamera", new Vector3(0, 5, -6), scene);
  camera.setTarget(new Vector3(0, 1, 8)); camera.fov = 0.80; camera.minZ = 0.1; camera.maxZ = 150;
  const world = new GameWorld(scene, canvas, camera);
  void world.loadUploadedMap();
  return { scene, dispose: () => { world.dispose(); scene.dispose(); } };
}
