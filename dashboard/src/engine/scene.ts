/**
 * Three.js flight scene. Coordinates: three X = lateral axis (platform motion
 * direction, sim y), three Y = altitude (sim z), three Z = depth (lanes for
 * comparison mode). The camera rides with the platform; the sea scrolls by the
 * platform's inertial displacement so the speed is legible.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { Trial } from '../sim/trial';
import { COLORS } from './flight';

export type CameraMode = 'chase' | 'side' | 'top' | 'deck';
const CAM_OFFSETS: Record<CameraMode, THREE.Vector3> = {
  chase: new THREE.Vector3(-4.6, 2.9, 8.2),
  side: new THREE.Vector3(0, 1.2, 11.5),
  top: new THREE.Vector3(0.01, 12.5, 0.6),
  deck: new THREE.Vector3(5.2, 0.55, 3.6),
};

const DECK_L = 9;
const DECK_W = 5.2;
const LANES = [0, -1.0, 1.0, -2.0, 2.0];

interface DroneRig {
  group: THREE.Group;
  tilt: THREE.Group;
  props: THREE.Object3D[];
  stripe: THREE.MeshStandardMaterial;
  trail: Line2;
  trailMat: LineMaterial;
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
  private seaMat: THREE.ShaderMaterial;
  private rigs: DroneRig[] = [];
  private target = new THREE.Vector3(0, 2, 0);
  private offset = CAM_OFFSETS.chase.clone();
  private offsetGoal = CAM_OFFSETS.chase.clone();
  private deckLights: THREE.MeshBasicMaterial[] = [];
  private particles: THREE.Points;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private pAlpha: Float32Array;
  private pHead = 0;
  private time = 0;
  private lineMats: LineMaterial[] = [];
  private ro: ResizeObserver;
  private ladder: THREE.Group;
  private isDragging = false;
  private zoom = 1;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#07090b');
    this.scene.fog = new THREE.Fog('#07090b', 22, 70);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.05, 300);
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

    // Lighting
    this.scene.add(new THREE.HemisphereLight('#9fb6cc', '#0a0c0f', 0.55));
    const key = new THREE.DirectionalLight('#fff3e6', 2.4);
    key.position.set(-6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10; sc.near = 1; sc.far = 40;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    this.scene.add(key.target);
    const rim = new THREE.DirectionalLight('#5b8fd6', 0.9);
    rim.position.set(8, 4, -10);
    this.scene.add(rim);

    this.seaMat = this.buildSea();
    this.buildVessel();
    this.ladder = this.buildLadder();
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
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `
        attribute float alpha; varying float vA; uniform float uScale;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = uScale * 26.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying float vA;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
          if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d) * vA;
          gl_FragColor = vec4(0.62, 0.74, 0.86, a); }`,
    });
    this.particles = new THREE.Points(pg, pm);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.controls.target.copy(this.target);
    this.camera.position.copy(this.target).add(this.offset);
  }

  private buildSea(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uOffset: { value: 0 }, uTime: { value: 0 }, uFogColor: { value: new THREE.Color('#07090b') } },
      vertexShader: `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        varying vec3 vW; uniform float uOffset; uniform float uTime; uniform vec3 uFogColor;
        float line(float x, float w){ float f = abs(fract(x) - 0.5); return smoothstep(w, 0.0, 0.5 - f); }
        void main(){
          vec2 p = vec2(vW.x + uOffset, vW.z);
          float r = length(vW.xz);
          float wave = sin(p.x*0.9 + uTime*0.8 + sin(p.y*0.35)) * 0.5 + 0.5;
          wave *= sin(p.y*0.6 - uTime*0.5 + p.x*0.15) * 0.5 + 0.5;
          vec3 base = mix(vec3(0.020,0.028,0.036), vec3(0.030,0.044,0.056), wave);
          float minor = max(line(p.x, 0.012), line(p.y, 0.012));
          float major = max(line(p.x/5.0, 0.004), line(p.y/5.0, 0.004));
          vec3 col = base + vec3(0.05,0.065,0.08)*minor*0.55 + vec3(0.09,0.11,0.13)*major*0.8;
          float fog = smoothstep(14.0, 62.0, r);
          gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
        }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.45;
    sea.receiveShadow = false;
    this.scene.add(sea);

    // wake streaks behind the vessel
    return mat;
  }

  private buildVessel() {
    const g = new THREE.Group();
    // Hull: extruded side profile, bow toward +X (direction of travel)
    const s = new THREE.Shape();
    const L = DECK_L / 2;
    s.moveTo(-L, -0.32);
    s.lineTo(L + 0.3, -0.32);
    s.lineTo(L - 0.6, -1.55);
    s.lineTo(-L + 0.2, -1.55);
    s.lineTo(-L, -1.2);
    s.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(s, { depth: DECK_W - 0.4, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    hullGeo.translate(0, 0, -(DECK_W - 0.4) / 2);
    const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: '#1a2027', metalness: 0.55, roughness: 0.55 }));
    hull.castShadow = true;
    g.add(hull);

    // Boot stripe
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(DECK_L - 0.2, 0.06, DECK_W - 0.25),
      new THREE.MeshStandardMaterial({ color: '#ff6b1a', emissive: '#ff6b1a', emissiveIntensity: 0.25, roughness: 0.6 }),
    );
    stripe.position.set(0.1, -1.2, 0);
    g.add(stripe);

    // Deck slab
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(DECK_L, 0.32, DECK_W),
      new THREE.MeshStandardMaterial({ color: '#20262d', metalness: 0.4, roughness: 0.75 }),
    );
    deck.position.y = -0.16;
    deck.receiveShadow = true;
    deck.castShadow = true;
    g.add(deck);

    // Deck markings
    const tex = new THREE.CanvasTexture(this.drawDeckTexture());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(DECK_L, DECK_W),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.15 }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.002;
    top.receiveShadow = true;
    g.add(top);

    // Perimeter lights
    const lightGeo = new THREE.SphereGeometry(0.035, 10, 8);
    const perim: [number, number][] = [];
    for (let i = 0; i <= 8; i++) {
      const x = -DECK_L / 2 + 0.25 + ((DECK_L - 0.5) * i) / 8;
      perim.push([x, DECK_W / 2 - 0.08], [x, -DECK_W / 2 + 0.08]);
    }
    for (const [x, z] of perim) {
      const m = new THREE.MeshBasicMaterial({ color: '#ffb27a' });
      const b = new THREE.Mesh(lightGeo, m);
      b.position.set(x, 0.03, z);
      b.userData.phase = (x + DECK_L / 2) / DECK_L;
      this.deckLights.push(m);
      m.userData.phase = b.userData.phase;
      g.add(b);
    }

    // Mast / superstructure at stern
    const mastMat = new THREE.MeshStandardMaterial({ color: '#2a323b', metalness: 0.5, roughness: 0.5 });
    const house = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 1.4), mastMat);
    house.position.set(-L + 0.55, 0.35, DECK_W / 2 - 0.95);
    house.castShadow = true;
    g.add(house);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.6, 8), mastMat);
    mast.position.set(-L + 0.55, 1.5, DECK_W / 2 - 0.95);
    g.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshBasicMaterial({ color: '#ff3b30' }));
    beacon.position.set(-L + 0.55, 2.32, DECK_W / 2 - 0.95);
    beacon.userData.beacon = true;
    g.add(beacon);
    this.deckLights.push(beacon.material as THREE.MeshBasicMaterial);
    (beacon.material as THREE.MeshBasicMaterial).userData.beacon = true;

    this.scene.add(g);
  }

  private drawDeckTexture(): HTMLCanvasElement {
    const ppm = 180;
    const c = document.createElement('canvas');
    c.width = DECK_L * ppm;
    c.height = DECK_W * ppm;
    const x = c.getContext('2d')!;
    x.fillStyle = '#171b20';
    x.fillRect(0, 0, c.width, c.height);
    // non-skid speckle
    for (let i = 0; i < 26000; i++) {
      const v = 20 + Math.random() * 14;
      x.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
      x.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
    }
    // panel seams
    x.strokeStyle = 'rgba(0,0,0,0.45)';
    x.lineWidth = 3;
    for (let i = 1; i < DECK_L; i++) { x.beginPath(); x.moveTo(i * ppm, 0); x.lineTo(i * ppm, c.height); x.stroke(); }
    // hazard border
    const bw = 0.14 * ppm;
    x.save();
    x.beginPath();
    x.rect(0, 0, c.width, c.height);
    x.rect(bw, bw, c.width - 2 * bw, c.height - 2 * bw);
    x.clip('evenodd');
    x.fillStyle = '#d9a21f';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#111';
    for (let i = -c.height; i < c.width + c.height; i += 60) {
      x.beginPath();
      x.moveTo(i, 0); x.lineTo(i + 30, 0); x.lineTo(i + 30 - c.height, c.height); x.lineTo(i - c.height, c.height);
      x.fill();
    }
    x.restore();
    const cx = c.width / 2;
    const cy = c.height / 2;
    // touchdown zone
    x.strokeStyle = '#e8ecef';
    x.lineWidth = 0.07 * ppm;
    x.beginPath(); x.arc(cx, cy, 1.25 * ppm, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 0.025 * ppm;
    x.setLineDash([0.18 * ppm, 0.12 * ppm]);
    x.beginPath(); x.arc(cx, cy, 0.75 * ppm, 0, Math.PI * 2); x.stroke();
    x.setLineDash([]);
    x.strokeStyle = '#ff6b1a';
    x.lineWidth = 0.035 * ppm;
    x.beginPath(); x.arc(cx, cy, 0.3 * ppm, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(232,236,239,0.6)';
    x.lineWidth = 0.02 * ppm;
    x.beginPath();
    x.moveTo(cx - 1.6 * ppm, cy); x.lineTo(cx - 0.4 * ppm, cy);
    x.moveTo(cx + 0.4 * ppm, cy); x.lineTo(cx + 1.6 * ppm, cy);
    x.moveTo(cx, cy - 1.6 * ppm); x.lineTo(cx, cy - 0.4 * ppm);
    x.moveTo(cx, cy + 0.4 * ppm); x.lineTo(cx, cy + 1.6 * ppm);
    x.stroke();
    // lateral ticks every 0.5 m along motion axis
    x.fillStyle = 'rgba(232,236,239,0.5)';
    for (let m = -3.5; m <= 3.5; m += 0.5) {
      const px = cx + m * ppm;
      const h = Number.isInteger(m) ? 0.22 : 0.12;
      x.fillRect(px - 2, c.height - bw - h * ppm - 6, 4, h * ppm);
    }
    // heading arrow + id
    x.fillStyle = 'rgba(232,236,239,0.85)';
    x.font = `600 ${0.26 * ppm}px "IBM Plex Mono", monospace`;
    x.textAlign = 'left';
    x.fillText('DAGE-01', bw + 0.25 * ppm, bw + 0.45 * ppm);
    x.font = `500 ${0.13 * ppm}px "IBM Plex Mono", monospace`;
    x.fillStyle = 'rgba(232,236,239,0.45)';
    x.fillText('USV RECOVERY DECK · TDZ Ø2.5 m', bw + 0.25 * ppm, bw + 0.68 * ppm);
    x.save();
    x.translate(c.width - bw - 1.0 * ppm, bw + 0.42 * ppm);
    x.fillStyle = 'rgba(255,107,26,0.9)';
    x.beginPath();
    x.moveTo(0.5 * ppm, 0); x.lineTo(0.2 * ppm, -0.16 * ppm); x.lineTo(0.2 * ppm, -0.05 * ppm);
    x.lineTo(-0.4 * ppm, -0.05 * ppm); x.lineTo(-0.4 * ppm, 0.05 * ppm); x.lineTo(0.2 * ppm, 0.05 * ppm);
    x.lineTo(0.2 * ppm, 0.16 * ppm); x.closePath(); x.fill();
    x.restore();
    return c;
  }

  private buildLadder(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.LineDashedMaterial({ color: '#56616c', dashSize: 0.08, gapSize: 0.08, transparent: true, opacity: 0.7 });
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4.2, 0)]);
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    g.add(line);
    for (let m = 1; m <= 4; m++) {
      const tick = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.12, m, 0), new THREE.Vector3(0.12, m, 0)]),
        new THREE.LineBasicMaterial({ color: '#7c8794' }),
      );
      g.add(tick);
      g.add(this.label(`${m}.0 m`, -0.5, m, 0, '#7c8794'));
    }
    const ge = this.label('R_z ground effect', 0.95, 0.55, 0, '#f5b83d');
    g.add(ge);
    const geTick = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.08, 0.55, 0), new THREE.Vector3(0.08, 0.55, 0)]),
      new THREE.LineBasicMaterial({ color: '#f5b83d' }),
    );
    g.add(geTick);
    return g;
  }

  private label(text: string, x: number, y: number, z: number, color: string): THREE.Sprite {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const fs = 44;
    ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    c.width = w;
    c.height = fs + 16;
    ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    const h = 0.17;
    sp.scale.set((h * c.width) / c.height, h, 1);
    sp.position.set(x, y, z);
    return sp;
  }

  private lineMat(color: string, width: number, dashed = false, opacity = 1): LineMaterial {
    const m = new LineMaterial({ color: new THREE.Color(color).getHex(), linewidth: width, transparent: opacity < 1, opacity, dashed, dashSize: 0.06, gapSize: 0.05, worldUnits: false });
    m.resolution.set(this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.lineMats.push(m);
    return m;
  }

  private buildDrone(color: string, primary: boolean): { group: THREE.Group; tilt: THREE.Group; props: THREE.Object3D[]; stripe: THREE.MeshStandardMaterial } {
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    group.add(tilt);
    const opacity = primary ? 1 : 0.92;
    const dark = new THREE.MeshStandardMaterial({ color: '#1b2026', metalness: 0.6, roughness: 0.45, transparent: !primary, opacity });
    const mid = new THREE.MeshStandardMaterial({ color: '#39424c', metalness: 0.5, roughness: 0.5, transparent: !primary, opacity });
    const stripe = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: primary ? 0.6 : 0.9, roughness: 0.4 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.15), dark);
    body.castShadow = true;
    tilt.add(body);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.1), mid);
    canopy.position.y = 0.045;
    canopy.castShadow = true;
    tilt.add(canopy);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.205, 0.012, 0.155), stripe);
    band.position.y = 0.012;
    tilt.add(band);

    const props: THREE.Object3D[] = [];
    const armLen = 0.2;
    const bladeMat = new THREE.MeshStandardMaterial({ color: '#0e1114', roughness: 0.6 });
    const discMat = new THREE.MeshBasicMaterial({ color: '#a8b8c8', transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const ax = Math.cos(a) * armLen;
      const az = Math.sin(a) * armLen;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen * 1.05, 0.018, 0.022), mid);
      arm.position.set(ax / 2, 0, az / 2);
      arm.rotation.y = -a;
      arm.castShadow = true;
      tilt.add(arm);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.045, 14), dark);
      motor.position.set(ax, 0.02, az);
      motor.castShadow = true;
      tilt.add(motor);
      const hub = new THREE.Group();
      hub.position.set(ax, 0.047, az);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.003, 0.016), bladeMat);
      hub.add(blade);
      const blade2 = blade.clone();
      blade2.rotation.y = Math.PI / 2;
      blade2.scale.set(0.98, 1, 1);
      hub.add(blade2);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.088, 28), discMat);
      disc.rotation.x = -Math.PI / 2;
      hub.add(disc);
      hub.userData.dir = i % 2 ? 1 : -1;
      tilt.add(hub);
      props.push(hub);
      // nav light at arm tip
      const nav = new THREE.Mesh(
        new THREE.SphereGeometry(0.011, 8, 6),
        new THREE.MeshBasicMaterial({ color: i === 0 || i === 3 ? '#3dd68c' : '#ff4d4f' }),
      );
      nav.position.set(ax * 1.08, -0.012, az * 1.08);
      tilt.add(nav);
    }
    // landing skids
    for (const z of [-0.06, 0.06]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.008), mid);
      skid.position.set(0, -0.075, z);
      tilt.add(skid);
      for (const x of [-0.06, 0.06]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.05, 0.008), mid);
        leg.position.set(x, -0.05, z);
        tilt.add(leg);
      }
    }
    group.scale.setScalar(2.1);
    return { group, tilt, props, stripe };
  }

  setTrials(trials: Trial[]) {
    for (const r of this.rigs) {
      this.scene.remove(r.group, r.trail, r.reticle, r.geRing, r.arcTrue, r.arcEst);
      r.trail.geometry.dispose();
    }
    this.rigs = trials.map((tr, i) => {
      const color = COLORS[tr.cfg.controller];
      const primary = i === 0;
      const { group, tilt, props, stripe } = this.buildDrone(color, primary);
      const lane = trials.length > 1 ? LANES[i] : 0;
      group.position.z = lane;
      this.scene.add(group);

      const trailMat = this.lineMat(color, primary ? 2.4 : 1.6, false, primary ? 1 : 0.85);
      const trail = new Line2(new LineGeometry(), trailMat);
      trail.frustumCulled = false;
      this.scene.add(trail);

      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.19, 40),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
      );
      reticle.rotation.x = -Math.PI / 2;
      reticle.position.set(0, 0.012, lane);
      this.scene.add(reticle);

      const geRing = new THREE.Mesh(
        new THREE.RingGeometry(0.2, 0.75, 48),
        new THREE.MeshBasicMaterial({ color: '#f5b83d', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      geRing.rotation.x = -Math.PI / 2;
      geRing.position.set(0, 0.014, lane);
      this.scene.add(geRing);

      const arcTrue = new Line2(new LineGeometry(), this.lineMat('#ff6b1a', 3));
      const arcEst = new Line2(new LineGeometry(), this.lineMat('#e8ecef', 2, true));
      arcTrue.frustumCulled = false;
      arcEst.frustumCulled = false;
      arcTrue.visible = primary;
      arcEst.visible = primary;
      this.scene.add(arcTrue, arcEst);

      return { group, tilt, props, stripe, trail, trailMat, reticle, geRing, arcTrue, arcEst, lane, trailN: -1 };
    });
    for (let i = 0; i < this.pLife.length; i++) { this.pLife[i] = 0; this.pAlpha[i] = 0; }
    this.ladder.position.z = -2.45;
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
    (this.particles.material as THREE.ShaderMaterial).uniforms.uScale.value = h / 700 * this.renderer.getPixelRatio();
  }

  update(trials: Trial[], dt: number) {
    this.time += dt;
    const primary = trials[0];
    if (!primary) return;
    const xp = primary.hist ? primary.hist.xp[Math.max(0, primary.step - 1)] : 0;
    this.seaMat.uniforms.uOffset.value = xp;
    this.seaMat.uniforms.uTime.value = this.time;

    // deck lights chase + beacon
    for (const m of this.deckLights) {
      if (m.userData.beacon) { m.color.set(Math.sin(this.time * 3.2) > 0.6 ? '#ff3b30' : '#3a1010'); continue; }
      const ph = (this.time * 0.7 - m.userData.phase) % 1;
      const k = ph < 0 ? ph + 1 : ph;
      m.color.setRGB(1, 0.62 + 0.3 * (k < 0.12 ? 1 : 0), 0.4).multiplyScalar(k < 0.12 ? 1.4 : 0.45);
    }

    trials.forEach((tr, i) => {
      const r = this.rigs[i];
      if (!r) return;
      const s = tr.state;
      const x = s[2];
      const y = Math.max(s[0], 0) + 0.175;
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
      (r.geRing.material as THREE.MeshBasicMaterial).opacity = tr.done ? 0 : Math.max(0, ge - 0.05) * 0.5;
      r.geRing.scale.setScalar(0.7 + ge * 0.6);

      // trail (decimated)
      if (tr.hist && tr.step !== r.trailN && (tr.step - r.trailN > 4 || tr.done)) {
        r.trailN = tr.step;
        const n = Math.max(2, tr.step + 1);
        const stride = Math.max(1, Math.floor(n / 300));
        const pts: number[] = [];
        for (let k = 0; k < n; k += stride) pts.push(tr.hist.y[k], Math.max(tr.hist.z[k], 0) + 0.175, r.lane);
        pts.push(x, y, r.lane);
        if (pts.length >= 6) {
          r.trail.geometry.dispose();
          const g = new LineGeometry();
          g.setPositions(pts);
          r.trail.geometry = g;
          r.trail.computeLineDistances();
        }
      }

      // torque arcs (primary)
      if (i === 0) {
        const tauT = tr.trueTau();
        const est = tr.cfg.controller === 'PID+DOB' ? tr.dobEst : tr.tauHat * tr.sigma;
        const hasEst = tr.cfg.controller.startsWith('Res') || tr.cfg.controller === 'PID+DOB';
        this.setArc(r.arcTrue, x, y, r.lane, 0.66, tauT, !tr.done);
        this.setArc(r.arcEst, x, y, r.lane, 0.78, est, hasEst && !tr.done);
      }
    });

    this.updateParticles(primary, this.rigs[0], dt);

    // camera follow
    const px = primary.state[2];
    const pz = Math.max(primary.state[0], 0);
    const goal = new THREE.Vector3(px * 0.55, 0.45 + pz * 0.55, trials.length > 1 ? 0 : 0);
    const prev = this.target.clone();
    this.target.lerp(goal, 1 - Math.exp(-dt * 3));
    const delta = this.target.clone().sub(prev);
    if (!this.isDragging) this.offset.lerp(this.offsetGoal, 1 - Math.exp(-dt * 2.6));
    this.controls.target.add(delta);
    const zoom = (this.zoom = 0.72 + 0.28 * Math.min(1, pz / 4));
    if (!this.isDragging) this.camera.position.copy(this.controls.target).addScaledVector(this.offset, zoom);
    else this.camera.position.add(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private setArc(line: Line2, x: number, y: number, z: number, rad: number, tau: number, visible: boolean) {
    const span = Math.max(-2.6, Math.min(2.6, tau * 28));
    line.visible = visible && Math.abs(span) > 0.04;
    if (!line.visible) return;
    const pts: number[] = [];
    const N = 24;
    const a0 = Math.PI / 2;
    for (let k = 0; k <= N; k++) {
      const a = a0 - (span * k) / N;
      pts.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad, z);
    }
    // arrow head
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
        const cx = rig.group.position.x + lx * Math.cos(phi);
        P[i * 3] = cx;
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
        // impinge → radial outwash, biased downstream by relative wind (the asymmetry)
        P[j + 1] = floor;
        const sp = Math.abs(V[j + 1]) * 0.75;
        const ang = Math.random() * Math.PI * 2;
        V[j] = Math.cos(ang) * sp + drift * 1.4;
        V[j + 1] = 0.08 + Math.random() * 0.25;
        V[j + 2] = Math.sin(ang) * sp;
      }
      const life = this.pLife[i];
      this.pAlpha[i] = Math.min(1, life * 1.6) * 0.28;
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
