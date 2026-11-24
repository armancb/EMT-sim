import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface CameraView {
  position: THREE.Vector3Tuple;
  target: THREE.Vector3Tuple;
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function makeBackground(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(512, 470, 40, 512, 512, 760);
  grad.addColorStop(0, '#0f131b');
  grad.addColorStop(0.45, '#0b0e14');
  grad.addColorStop(1, '#040507');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly keyLight: THREE.DirectionalLight;

  private tween: {
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    duration: number;
    resolve: () => void;
  } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = makeBackground();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 600);
    this.camera.position.set(0, 2, 98);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 150;
    this.controls.maxPolarAngle = Math.PI * 0.53;
    this.controls.target.set(0, -4, 0);
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 0.6;

    // lights: one warm key with soft shadows, one cool rim
    const hemi = new THREE.HemisphereLight(0x9bb4d6, 0x0a0a0c, 0.35);
    this.scene.add(hemi);
    this.keyLight = new THREE.DirectionalLight(0xfff1e0, 2.2);
    this.keyLight.position.set(30, 55, 45);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    const sc = this.keyLight.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 10;
    sc.far = 160;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.radius = 6;
    this.scene.add(this.keyLight);
    const rim = new THREE.DirectionalLight(0x7fb8ff, 1.6);
    rim.position.set(-45, 25, -50);
    this.scene.add(rim);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // threshold > 1 so only HDR emitters (beam, sparks, particles) bloom, not specular highlights
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.35, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // keep the apparatus framed on narrow (portrait) screens
    this.camera.fov = w / h < 1 ? 46 : 32;
    // portrait screens need to stand further back to fit wide scenes (the tokamak)
    this.controls.maxDistance = w / h < 1 ? 300 : 150;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
  }

  /** Smoothly move the camera (600 ms ease-in-out by default). */
  goTo(view: CameraView, duration = 600): Promise<void> {
    return new Promise((resolve) => {
      this.tween?.resolve();
      this.tween = {
        fromPos: this.camera.position.clone(),
        fromTarget: this.controls.target.clone(),
        toPos: new THREE.Vector3(...view.position),
        toTarget: new THREE.Vector3(...view.target),
        t: 0,
        duration: Math.max(1, duration),
        resolve,
      };
    });
  }

  get isTweening() {
    return this.tween !== null;
  }

  update(dt: number) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + (dt * 1000) / tw.duration);
      const k = easeInOut(tw.t);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      this.camera.lookAt(this.controls.target);
      if (tw.t >= 1) {
        this.tween = null;
        tw.resolve();
      }
    } else {
      this.controls.update(dt);
    }
  }

  render() {
    this.composer.render();
  }
}
