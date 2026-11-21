/**
 * Three.js flight scene. Coordinates: three X = lateral axis (platform motion
 * direction, sim y), three Y = altitude (sim z), three Z = depth (lanes for
 * comparison mode). The camera rides with the platform; the sea scrolls by the
 * platform's inertial displacement so its speed reads at a glance.
 *
 * Look: physically based materials lit by a studio environment map, a sky dome
 * with horizon haze, and a palette that follows the app's light/dark appearance.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { Trial } from '../sim/trial';
import { theme, FONT } from '../ui/theme';

export type CameraMode = 'chase' | 'side' | 'top' | 'deck';
const CAM_OFFSETS: Record<CameraMode, THREE.Vector3> = {
  chase: new THREE.Vector3(-4.8, 2.6, 8.4),
  side: new THREE.Vector3(0, 1.1, 11.5),
  top: new THREE.Vector3(0.01, 12.5, 0.6),
  deck: new THREE.Vector3(5.4, 0.6, 3.8),
};

const DECK_L = 9;
const DECK_W = 5.2;
const LANES = [0, -1.0, 1.0, -2.0, 2.0];
const LIFT = 0.19; // skid height above the body origin, scaled

interface Palette {
  skyTop: THREE.Color; skyHorizon: THREE.Color; skyBottom: THREE.Color;
  seaDeep: THREE.Color; seaShallow: THREE.Color; seaLine: THREE.Color;
  particle: THREE.Color; particleAdditive: boolean;
  label: string; ladder: THREE.Color; exposure: number; env: number;
  hemiSky: THREE.Color; hemiGround: THREE.Color; key: number;
}

function palette(): Palette {
  const dark = theme().dark;
  return dark
    ? {
        skyTop: new THREE.Color('#0b0f16'), skyHorizon: new THREE.Color('#1d2632'), skyBottom: new THREE.Color('#0b0f16'),
        seaDeep: new THREE.Color('#0a1118'), seaShallow: new THREE.Color('#122030'), seaLine: new THREE.Color('#2a3a4c'),
        particle: new THREE.Color('#b9cde0'), particleAdditive: true,
        label: 'rgba(235,235,245,0.6)', ladder: new THREE.Color('#5d6976'), exposure: 0.95, env: 0.55,
        hemiSky: new THREE.Color('#9fb6cc'), hemiGround: new THREE.Color('#0a0c0f'), key: 2.2,
      }
    : {
        skyTop: new THREE.Color('#9fc2e6'), skyHorizon: new THREE.Color('#e9eef3'), skyBottom: new THREE.Color('#dfe6ec'),
        seaDeep: new THREE.Color('#7d99b1'), seaShallow: new THREE.Color('#93adc2'), seaLine: new THREE.Color('#6f8aa1'),
        particle: new THREE.Color('#6d8296'), particleAdditive: false,
        label: 'rgba(60,60,67,0.7)', ladder: new THREE.Color('#8f9aa5'), exposure: 1.0, env: 0.85,
        hemiSky: new THREE.Color('#ffffff'), hemiGround: new THREE.Color('#b8c2cc'), key: 2.6,
      };
}

interface DroneRig {
  group: THREE.Group;
  tilt: THREE.Group;
  props: THREE.Object3D[];
  trail: Line2;
  reticle: THREE.Mesh;
  geRing: THREE.Mesh;
  arcTrue: Line2;
  arcEst: Line2;
  lane: number;
  trailN: number;
}

export class FlightScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private container: HTMLElement;
  private pal: Palette;
  private sky: THREE.ShaderMaterial;
  private seaMat: THREE.ShaderMaterial;
  private hemi: THREE.HemisphereLight;
  private key: THREE.DirectionalLight;
  private rigs: DroneRig[] = [];
  private trials: Trial[] = [];
  private target = new THREE.Vector3(0, 2, 0);
  private offset = CAM_OFFSETS.chase.clone();
  private offsetGoal = CAM_OFFSETS.chase.clone();
  private deckLights: THREE.MeshStandardMaterial[] = [];
  private beacon!: THREE.MeshStandardMaterial;
  private deckTex!: THREE.CanvasTexture;
  private particles: THREE.Points;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pAlpha: Float32Array;
  private pHead = 0;
  private time = 0;
  private lineMats: LineMaterial[] = [];
  private ro: ResizeObserver;
  private ladder = new THREE.Group();
  private isDragging = false;
  private zoom = 1;

  constructor(container: HTMLElement) {
    this.container = container;
    this.pal = palette();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Studio reflections for every PBR material
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 40;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('start', () => { this.isDragging = true; });
    this.controls.addEventListener('end', () => {
      this.isDragging = false;
      this.offset.copy(this.camera.position).sub(this.controls.target).divideScalar(this.zoom);
      this.offsetGoal.copy(this.offset);
    });

    this.hemi = new THREE.HemisphereLight(this.pal.hemiSky, this.pal.hemiGround, 0.7);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight('#fff6ec', this.pal.key);
    this.key.position.set(-6, 14, 9);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10; sc.near = 1; sc.far = 40;
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);

    this.sky = this.buildSky();
    this.seaMat = this.buildSea();
    this.buildVessel();
    this.scene.add(this.ladder);

    // Downwash particles
    const N = 1400;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pAlpha = new Float32Array(N);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1));
    const pm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 1 }, uColor: { value: new THREE.Color() } },
      vertexShader: `
        attribute float alpha; varying float vA; uniform float uScale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = uScale * 26.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying float vA; uniform vec3 uColor;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
          if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
    });
    this.particles = new THREE.Points(pg, pm);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.applyPalette();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.controls.target.copy(this.target);
    this.camera.position.copy(this.target).add(this.offset);

    document.fonts?.ready.then(() => { this.drawDeckTexture(); this.rebuildLadder(); });
  }

  /** Re-tone the whole scene after an appearance change. */
  setTheme() {
    this.pal = palette();
    this.applyPalette();
    this.setTrials(this.trials);
  }

  private applyPalette() {
    const p = this.pal;
    this.renderer.toneMappingExposure = p.exposure;
    this.scene.environmentIntensity = p.env;
    this.scene.background = p.skyHorizon.clone();
    this.scene.fog = new THREE.Fog(p.skyHorizon, 26, 95);
    this.sky.uniforms.uTop.value.copy(p.skyTop);
    this.sky.uniforms.uHorizon.value.copy(p.skyHorizon);
    this.sky.uniforms.uBottom.value.copy(p.skyBottom);
    const su = this.seaMat.uniforms;
    su.uDeep.value.copy(p.seaDeep);
    su.uShallow.value.copy(p.seaShallow);
    su.uLine.value.copy(p.seaLine);
    su.uFog.value.copy(p.skyHorizon);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.key.intensity = p.key;
    const pm = this.particles.material as THREE.ShaderMaterial;
    pm.uniforms.uColor.value.copy(p.particle);
    pm.blending = p.particleAdditive ? THREE.AdditiveBlending : THREE.NormalBlending;
    pm.needsUpdate = true;
    this.rebuildLadder();
  }

  private buildSky(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vP; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
        void main(){ float h = vP.y;
          vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.65, h), 0.8)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.2, h));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), mat);
    dome.renderOrder = -1;
    this.scene.add(dome);
    return mat;
  }

  private buildSea(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uOffset: { value: 0 }, uTime: { value: 0 },
        uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() },
        uLine: { value: new THREE.Color() }, uFog: { value: new THREE.Color() },
      },
      vertexShader: `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        varying vec3 vW; uniform float uOffset; uniform float uTime;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uLine; uniform vec3 uFog;
        float line(float x, float w){ float f = abs(fract(x) - 0.5); return smoothstep(w, 0.0, 0.5 - f); }
        void main(){
          vec2 p = vec2(vW.x + uOffset, vW.z);
          float r = length(vW.xz);
          float w1 = sin(p.x * 0.8 + uTime * 0.9 + sin(p.y * 0.3) * 1.5);
          float w2 = sin(p.y * 0.55 - uTime * 0.6 + p.x * 0.21);
          float w3 = sin((p.x + p.y) * 1.7 + uTime * 1.4) * 0.35;
          float wave = (w1 + w2 + w3) * 0.2 + 0.5;
          vec3 col = mix(uDeep, uShallow, 0.25 + wave * 0.5);
          float major = max(line(p.x / 5.0, 0.006), line(p.y / 5.0, 0.006));
          col = mix(col, uLine, major * 0.35 * (1.0 - smoothstep(6.0, 30.0, r)));
          float fog = smoothstep(16.0, 85.0, r);
          gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.45;
    this.scene.add(sea);
    return mat;
  }

  private buildVessel() {
    const g = new THREE.Group();
    const L = DECK_L / 2;
    const s = new THREE.Shape();
    s.moveTo(-L, -0.3);
    s.lineTo(L + 0.35, -0.3);
    s.quadraticCurveTo(L + 0.1, -1.2, L - 0.7, -1.58);
    s.lineTo(-L + 0.2, -1.58);
    s.lineTo(-L, -1.15);
    s.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(s, { depth: DECK_W - 0.4, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 4, curveSegments: 18 });
    hullGeo.translate(0, 0, -(DECK_W - 0.4) / 2);
    const hullMat = new THREE.MeshPhysicalMaterial({ color: '#eef0f2', roughness: 0.32, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    g.add(hull);

    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(DECK_L - 0.1, 0.07, DECK_W - 0.22),
      new THREE.MeshStandardMaterial({ color: '#1f2a37', roughness: 0.5 }),
    );
    stripe.position.set(0.15, -1.3, 0);
    g.add(stripe);

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(DECK_L, 0.3, DECK_W),
      new THREE.MeshStandardMaterial({ color: '#d9dde1', roughness: 0.5, metalness: 0.05 }),
    );
    deck.position.y = -0.15;
    deck.receiveShadow = true;
    deck.castShadow = true;
    g.add(deck);

    this.deckTex = new THREE.CanvasTexture(document.createElement('canvas'));
    this.deckTex.colorSpace = THREE.SRGBColorSpace;
    this.deckTex.anisotropy = 8;
    this.drawDeckTexture();
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(DECK_L - 0.16, DECK_W - 0.16),
      new THREE.MeshStandardMaterial({ map: this.deckTex, roughness: 0.82, metalness: 0.05 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.003;
    top.receiveShadow = true;
    g.add(top);

    // perimeter lights
    const lightGeo = new THREE.SphereGeometry(0.03, 12, 8);
    for (let i = 0; i <= 8; i++) {
      const x = -L + 0.3 + ((DECK_L - 0.6) * i) / 8;
      for (const z of [DECK_W / 2 - 0.12, -DECK_W / 2 + 0.12]) {
        const m = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffd9a8', emissiveIntensity: 1.2 });
        const b = new THREE.Mesh(lightGeo, m);
        b.position.set(x, 0.03, z);
        this.deckLights.push(m);
        g.add(b);
      }
    }

    // superstructure
    const white = new THREE.MeshPhysicalMaterial({ color: '#f4f5f7', roughness: 0.35, clearcoat: 0.4 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#1b2430', roughness: 0.08, metalness: 0.4 });
    const house = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 1.5), white);
    house.position.set(-L + 0.62, 0.375, -(DECK_W / 2 - 1.0));
    house.castShadow = true;
    house.receiveShadow = true;
    g.add(house);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.16, 1.52), glass);
    win.position.set(-L + 0.62, 0.55, -(DECK_W / 2 - 1.0));
    g.add(win);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.5, 12), new THREE.MeshStandardMaterial({ color: '#c9ced4', metalness: 0.8, roughness: 0.3 }));
    mast.position.set(-L + 0.62, 1.5, -(DECK_W / 2 - 1.0));
    g.add(mast);
    this.beacon = new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 2 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), this.beacon);
    beacon.position.set(-L + 0.62, 2.28, -(DECK_W / 2 - 1.0));
    g.add(beacon);

    this.scene.add(g);
  }

  private drawDeckTexture() {
    const ppm = 180;
    const c = this.deckTex.image as HTMLCanvasElement;
    c.width = (DECK_L - 0.16) * ppm;
    c.height = (DECK_W - 0.16) * ppm;
    const x = c.getContext('2d')!;
    x.fillStyle = '#2b3036';
    x.fillRect(0, 0, c.width, c.height);
    // fine non-skid grain
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 30000; i++) {
      const v = 38 + rnd() * 12;
      x.fillStyle = `rgb(${v},${v + 4},${v + 9})`;
      x.fillRect(rnd() * c.width, rnd() * c.height, 2, 2);
    }
    const cx = c.width / 2;
    const cy = c.height / 2;
    // perimeter line
    x.strokeStyle = 'rgba(255,255,255,0.92)';
    x.lineWidth = 0.07 * ppm;
    const ins = 0.18 * ppm;
    x.strokeRect(ins, ins, c.width - 2 * ins, c.height - 2 * ins);
    // touchdown circle
    x.lineWidth = 0.1 * ppm;
    x.beginPath(); x.arc(cx, cy, 1.25 * ppm, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 0.03 * ppm;
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.setLineDash([0.16 * ppm, 0.11 * ppm]);
    x.beginPath(); x.arc(cx, cy, 0.78 * ppm, 0, Math.PI * 2); x.stroke();
    x.setLineDash([]);
    x.strokeStyle = '#ffcc00';
    x.lineWidth = 0.05 * ppm;
    x.beginPath(); x.arc(cx, cy, 0.3 * ppm, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#ffcc00';
    x.beginPath(); x.arc(cx, cy, 0.05 * ppm, 0, Math.PI * 2); x.fill();
    // lateral ticks along the direction of travel
    x.fillStyle = 'rgba(255,255,255,0.4)';
    for (let m = -3.5; m <= 3.5; m += 0.5) {
      const h = Number.isInteger(m) ? 0.24 : 0.13;
      x.fillRect(cx + m * ppm - 2, c.height - ins - h * ppm - 0.12 * ppm, 4, h * ppm);
    }
    // identification
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.font = `700 ${0.3 * ppm}px ${FONT}`;
    x.textBaseline = 'alphabetic';
    x.fillText('DAGE 01', ins + 0.3 * ppm, ins + 0.55 * ppm);
    x.font = `500 ${0.13 * ppm}px ${FONT}`;
    x.fillStyle = 'rgba(255,255,255,0.55)';
    x.fillText('Recovery deck · touchdown zone 2.5 m', ins + 0.3 * ppm, ins + 0.8 * ppm);
    // heading chevrons
    x.fillStyle = 'rgba(255,255,255,0.8)';
    for (let k = 0; k < 3; k++) {
      const ax = c.width - ins - (1.15 - k * 0.24) * ppm;
      const ay = ins + 0.45 * ppm;
      x.beginPath();
      x.moveTo(ax, ay - 0.13 * ppm); x.lineTo(ax + 0.13 * ppm, ay); x.lineTo(ax, ay + 0.13 * ppm);
      x.lineTo(ax - 0.06 * ppm, ay + 0.13 * ppm); x.lineTo(ax + 0.07 * ppm, ay); x.lineTo(ax - 0.06 * ppm, ay - 0.13 * ppm);
      x.closePath(); x.fill();
    }
    this.deckTex.needsUpdate = true;
  }

  private rebuildLadder() {
    for (const ch of [...this.ladder.children]) {
      this.ladder.remove(ch);
      const m = ch as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material & { map?: THREE.Texture };
      mat?.map?.dispose();
      mat?.dispose();
    }
    const col = this.pal.ladder;
    const mat = new THREE.LineDashedMaterial({ color: col, dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.8 });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4.2, 0)]), mat);
    line.computeLineDistances();
    this.ladder.add(line);
    for (let m = 1; m <= 4; m++) {
      this.ladder.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.12, m, 0), new THREE.Vector3(0.12, m, 0)]),
        new THREE.LineBasicMaterial({ color: col }),
      ));
      this.ladder.add(this.label(`${m} m`, -0.42, m, this.pal.label));
    }
    this.ladder.position.z = -2.45;
  }

  private label(text: string, x: number, y: number, color: string): THREE.Sprite {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const fs = 44;
    ctx.font = `600 ${fs}px ${FONT}`;
    c.width = Math.ceil(ctx.measureText(text).width) + 16;
    c.height = fs + 16;
    ctx.font = `600 ${fs}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    const h = 0.16;
    sp.scale.set((h * c.width) / c.height, h, 1);
    sp.position.set(x, y, 0);
    return sp;
  }

  private lineMat(color: string, width: number, dashed = false, opacity = 1): LineMaterial {
    const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: true, opacity, dashed, dashSize: 0.07, gapSize: 0.05, worldUnits: false });
    m.resolution.set(this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.lineMats.push(m);
    return m;
  }

  private buildDrone(color: string, primary: boolean): { group: THREE.Group; tilt: THREE.Group; props: THREE.Object3D[] } {
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    group.add(tilt);
    const shell = new THREE.MeshPhysicalMaterial({ color: '#f5f6f8', roughness: 0.28, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.12, transparent: !primary, opacity: primary ? 1 : 0.94 });
    const graphite = new THREE.MeshStandardMaterial({ color: '#2a2d32', roughness: 0.55, metalness: 0.3 });
    const alu = new THREE.MeshStandardMaterial({ color: '#b8bdc4', roughness: 0.3, metalness: 0.9 });
    const lens = new THREE.MeshPhysicalMaterial({ color: '#0d1117', roughness: 0.05, metalness: 0.5, clearcoat: 1 });
    const accent = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.35 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.12, 6, 16), shell);
    body.rotation.z = Math.PI / 2;
    body.scale.set(1, 1, 1.35);
    body.castShadow = true;
    tilt.add(body);
    const camPod = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), lens);
    camPod.position.set(0.105, -0.022, 0);
    tilt.add(camPod);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.007, 8, 40), accent);
    band.rotation.y = Math.PI / 2;
    band.scale.set(1, 1, 1.35);
    band.position.x = -0.02;
    tilt.add(band);

    const props: THREE.Object3D[] = [];
    const armLen = 0.2;
    const bladeMat = new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 0.5 });
    const discMat = new THREE.MeshBasicMaterial({ color: '#9aa6b2', transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const ax = Math.cos(a) * armLen;
      const az = Math.sin(a) * armLen;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, armLen, 12), graphite);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = -a;
      arm.position.set(ax / 2, 0, az / 2);
      arm.castShadow = true;
      tilt.add(arm);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.04, 20), alu);
      motor.position.set(ax, 0.018, az);
      motor.castShadow = true;
      tilt.add(motor);
      const hub = new THREE.Group();
      hub.position.set(ax, 0.042, az);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.0025, 0.014), bladeMat);
      hub.add(blade);
      const blade2 = blade.clone();
      blade2.rotation.y = Math.PI / 2;
      hub.add(blade2);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.088, 36), discMat);
      disc.rotation.x = -Math.PI / 2;
      hub.add(disc);
      hub.userData.dir = i % 2 ? 1 : -1;
      tilt.add(hub);
      props.push(hub);
      const nav = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 10, 8),
        new THREE.MeshStandardMaterial({ color: '#000', emissive: i === 0 || i === 3 ? '#30d158' : '#ff453a', emissiveIntensity: 3 }),
      );
      nav.position.set(ax, -0.004, az);
      tilt.add(nav);
    }
    for (const z of [-0.055, 0.055]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.19, 8), graphite);
      skid.rotation.z = Math.PI / 2;
      skid.position.set(0, -0.085, z);
      tilt.add(skid);
      for (const x of [-0.05, 0.05]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.06, 8), graphite);
        leg.position.set(x, -0.055, z);
        leg.rotation.x = z > 0 ? -0.25 : 0.25;
        tilt.add(leg);
      }
    }
    group.scale.setScalar(2.1);
    return { group, tilt, props };
  }

  setTrials(trials: Trial[]) {
    this.trials = trials;
    for (const r of this.rigs) {
      this.scene.remove(r.group, r.trail, r.reticle, r.geRing, r.arcTrue, r.arcEst);
      r.trail.geometry.dispose();
    }
    this.lineMats = [];
    const th = theme();
    this.rigs = trials.map((tr, i) => {
      const color = th.ctrl[tr.cfg.controller];
      const primary = i === 0;
      const { group, tilt, props } = this.buildDrone(color, primary);
      const lane = trials.length > 1 ? LANES[i] : 0;
      group.position.z = lane;
      this.scene.add(group);

      const trail = new Line2(new LineGeometry(), this.lineMat(color, primary ? 2.6 : 1.8, false, primary ? 0.95 : 0.8));
      trail.frustumCulled = false;
      this.scene.add(trail);

      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.15, 0.185, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      reticle.rotation.x = -Math.PI / 2;
      reticle.position.set(0, 0.012, lane);
      this.scene.add(reticle);

      const geRing = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.8, 64),
        new THREE.MeshBasicMaterial({ color: th.warn, transparent: true, opacity: 0, depthWrite: false }),
      );
      geRing.rotation.x = -Math.PI / 2;
      geRing.position.set(0, 0.014, lane);
      this.scene.add(geRing);

      const arcTrue = new Line2(new LineGeometry(), this.lineMat(th.disturb, 3.2));
      const arcEst = new Line2(new LineGeometry(), this.lineMat(th.dark ? '#ffffff' : '#1d1d1f', 2, true, 0.9));
      arcTrue.frustumCulled = false;
      arcEst.frustumCulled = false;
      arcTrue.visible = primary;
      arcEst.visible = primary;
      this.scene.add(arcTrue, arcEst);

      return { group, tilt, props, trail, reticle, geRing, arcTrue, arcEst, lane, trailN: -1 };
    });
    for (let i = 0; i < this.pLife.length; i++) { this.pLife[i] = 0; this.pAlpha[i] = 0; }
    this.resize();
  }

  setCameraMode(m: CameraMode) { this.offsetGoal.copy(CAM_OFFSETS[m]); }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(w, h);
    (this.particles.material as THREE.ShaderMaterial).uniforms.uScale.value = (h / 700) * this.renderer.getPixelRatio();
  }

  update(trials: Trial[], dt: number) {
    this.time += dt;
    const primary = trials[0];
    if (!primary) return;
    const xp = primary.hist ? primary.hist.xp[Math.max(0, primary.step - 1)] : 0;
    this.seaMat.uniforms.uOffset.value = xp;
    this.seaMat.uniforms.uTime.value = this.time;

    const breathe = 0.9 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 2.2));
    for (const m of this.deckLights) m.emissiveIntensity = breathe;
    this.beacon.emissiveIntensity = Math.sin(this.time * 3.2) > 0.55 ? 3 : 0.15;

    trials.forEach((tr, i) => {
      const r = this.rigs[i];
      if (!r) return;
      const s = tr.state;
      const x = s[2];
      const y = Math.max(s[0], 0) + LIFT;
      r.group.position.set(x, y, r.lane);
      r.tilt.rotation.z = -s[4];
      const spin = tr.done ? 6 : 95;
      for (const p of r.props) p.rotation.y += p.userData.dir * spin * dt;
      r.reticle.position.x = x;
      const err = Math.min(1, Math.abs(x) / 1.25);
      (r.reticle.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.5 * (1 - err);
      r.reticle.scale.setScalar(1 + Math.min(s[0], 4) * 0.25);
      const ge = tr.trueGE() / tr.plant.A_GE;
      r.geRing.position.x = x;
      (r.geRing.material as THREE.MeshBasicMaterial).opacity = tr.done ? 0 : Math.max(0, ge - 0.05) * 0.4;
      r.geRing.scale.setScalar(0.7 + ge * 0.6);

      if (tr.hist && tr.step !== r.trailN && (tr.step - r.trailN > 4 || tr.done)) {
        r.trailN = tr.step;
        const n = Math.max(2, tr.step + 1);
        const stride = Math.max(1, Math.floor(n / 300));
        const pts: number[] = [];
        for (let k = 0; k < n; k += stride) pts.push(tr.hist.y[k], Math.max(tr.hist.z[k], 0) + LIFT, r.lane);
        pts.push(x, y, r.lane);
        if (pts.length >= 6) {
          r.trail.geometry.dispose();
          const g = new LineGeometry();
          g.setPositions(pts);
          r.trail.geometry = g;
          r.trail.computeLineDistances();
        }
      }

      if (i === 0) {
        const tauT = tr.trueTau();
        const est = tr.cfg.controller === 'PID+DOB' ? tr.dobEst : tr.tauHat * tr.sigma;
        const hasEst = tr.cfg.controller.startsWith('Res') || tr.cfg.controller === 'PID+DOB';
        this.setArc(r.arcTrue, x, y, r.lane, 0.66, tauT, !tr.done);
        this.setArc(r.arcEst, x, y, r.lane, 0.78, est, hasEst && !tr.done);
      }
    });

    this.updateParticles(primary, this.rigs[0], dt);

    const px = primary.state[2];
    const pz = Math.max(primary.state[0], 0);
    const goal = new THREE.Vector3(px * 0.55, 0.45 + pz * 0.55, 0);
    const prev = this.target.clone();
    this.target.lerp(goal, 1 - Math.exp(-dt * 3));
    const delta = this.target.clone().sub(prev);
    if (!this.isDragging) this.offset.lerp(this.offsetGoal, 1 - Math.exp(-dt * 2.6));
    this.controls.target.add(delta);
    const zoom = (this.zoom = 0.72 + 0.28 * Math.min(1, pz / 4));
    if (!this.isDragging) this.camera.position.copy(this.controls.target).addScaledVector(this.offset, zoom);
    else this.camera.position.add(delta);
    this.key.position.set(this.target.x - 6, 14, 9);
    this.key.target.position.copy(this.target);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private setArc(line: Line2, x: number, y: number, z: number, rad: number, tau: number, visible: boolean) {
    const span = Math.max(-2.6, Math.min(2.6, tau * 28));
    line.visible = visible && Math.abs(span) > 0.04;
    if (!line.visible) return;
    const pts: number[] = [];
    const N = 28;
    const a0 = Math.PI / 2;
    for (let k = 0; k <= N; k++) {
      const a = a0 - (span * k) / N;
      pts.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad, z);
    }
    const ae = a0 - span;
    const dirS = Math.sign(span);
    const hx = x + Math.cos(ae) * rad;
    const hy = y + Math.sin(ae) * rad;
    const tx = Math.sin(ae) * dirS;
    const ty = -Math.cos(ae) * dirS;
    pts.push(hx - tx * 0.07 + Math.cos(ae) * 0.04, hy - ty * 0.07 + Math.sin(ae) * 0.04, z);
    pts.push(hx, hy, z);
    pts.push(hx - tx * 0.07 - Math.cos(ae) * 0.04, hy - ty * 0.07 - Math.sin(ae) * 0.04, z);
    line.geometry.dispose();
    const g = new LineGeometry();
    g.setPositions(pts);
    line.geometry = g;
    line.computeLineDistances();
  }

  private updateParticles(tr: Trial, rig: DroneRig | undefined, dt: number) {
    const N = this.pLife.length;
    const P = this.pPos;
    const V = this.pVel;
    if (rig && !tr.done) {
      const s = tr.state;
      const z = Math.max(s[0], 0);
      const emit = Math.round(dt * (260 + 520 * Math.exp(-z / 1.2)));
      const phi = s[4];
      for (let e = 0; e < emit; e++) {
        const i = this.pHead;
        this.pHead = (this.pHead + 1) % N;
        const rot = Math.floor(Math.random() * 4);
        const a = Math.PI / 4 + (rot * Math.PI) / 2;
        const lx = Math.cos(a) * 0.42 + (Math.random() - 0.5) * 0.12;
        const lz = Math.sin(a) * 0.42 + (Math.random() - 0.5) * 0.12;
        P[i * 3] = rig.group.position.x + lx * Math.cos(phi);
        P[i * 3 + 1] = rig.group.position.y - 0.02 - lx * Math.sin(-phi);
        P[i * 3 + 2] = rig.lane + lz;
        const sp = 3.2 + Math.random() * 1.2;
        V[i * 3] = Math.sin(phi) * sp + (Math.random() - 0.5) * 0.35;
        V[i * 3 + 1] = -Math.cos(phi) * sp;
        V[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
        this.pLife[i] = 0.75 + Math.random() * 0.5;
      }
    }
    const drift = -tr.plant.vp * 0.32; // relative wind over the deck (platform frame)
    const base = this.pal.particleAdditive ? 0.26 : 0.32;
    for (let i = 0; i < N; i++) {
      if (this.pLife[i] <= 0) { this.pAlpha[i] = 0; continue; }
      this.pLife[i] -= dt;
      const j = i * 3;
      V[j] += drift * dt * 1.2;
      P[j] += V[j] * dt;
      P[j + 1] += V[j + 1] * dt;
      P[j + 2] += V[j + 2] * dt;
      const onDeck = Math.abs(P[j]) < DECK_L / 2 && Math.abs(P[j + 2]) < DECK_W / 2;
      const floor = onDeck ? 0.02 : -1.43;
      if (P[j + 1] < floor && V[j + 1] < 0) {
        // impingement → radial outwash, biased downstream by relative wind (the asymmetry)
        P[j + 1] = floor;
        const sp = Math.abs(V[j + 1]) * 0.75;
        const ang = Math.random() * Math.PI * 2;
        V[j] = Math.cos(ang) * sp + drift * 1.4;
        V[j + 1] = 0.08 + Math.random() * 0.25;
        V[j + 2] = Math.sin(ang) * sp;
      }
      this.pAlpha[i] = Math.min(1, this.pLife[i] * 1.6) * base;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.alpha.needsUpdate = true;
  }

  dispose() {
    this.ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
