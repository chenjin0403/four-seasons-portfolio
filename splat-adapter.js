/**
 * Adapter for @mkkellogg/gaussian-splats-3d.
 * Keeping the library-specific API here means the editor UI remains easy to
 * migrate if the renderer is replaced later.
 */
import * as GaussianSplats3D from './vendor/gaussian-splats-3d-0.4.7.js';
import * as THREE from './vendor/three-0.160.1.js';

const DEFAULT_SCENE_OPTIONS = {
  splatAlphaRemovalThreshold: 5,
  showLoadingUI: false,
  progressiveLoad: true,
};

export class SplatRenderer {
  constructor(container, { background = '#e8e2d7' } = {}) {
    this.container = container;
    this.background = background;
    this.viewer = null;
    this.scenes = new Map();
    this.transforms = new Map();
    this.appearances = new Map();
    this.bounds = new Map();
    this.pending = Promise.resolve();
  }

  async init() {
    this.viewer = new GaussianSplats3D.Viewer({
      cameraUp: [0, 1, 0],
      // TripoSplat assets are normalized to a roughly 1.25-unit envelope.
      // A close starting distance presents the actual painting, rather than a
      // tiny speck in the middle of the paper.
      initialCameraPosition: [0, 0, 1.3],
      initialCameraLookAt: [0, 0, 0],
      rootElement: this.container,
      sharedMemoryForWorkers: false,
      useBuiltInControls: true,
      antialiased: true,
      dynamicScene: true,
      enableOptionalEffects: true,
    });
    this.setBackground(this.background);
    // Viewer hotkeys change GLOBAL focal length / splat size (G, +, -), and
    // its click handler animates the camera target independently of controls.
    // The editor owns picking and shortcuts; retain only OrbitControls.
    this.viewer.removeEventHandlers();
    this.viewer.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    // Camera inertia otherwise continues while an individual artwork is edited.
    this.viewer.controls.enableDamping = false;
    this.viewer.controls.enabled = false;
    this.viewer.start();
  }

  get canvas() {
    return this.container.querySelector('canvas');
  }

  add(id, url, transform, format) {
    return this.enqueue(() => this.addScene(id, url, transform, format));
  }

  enqueue(operation) {
    const result = this.pending.then(async () => {
      await this.waitForPickingTree();
      const value = await operation();
      await this.waitForPickingTree();
      return value;
    });
    this.pending = result.catch(() => {});
    return result;
  }

  async waitForPickingTree() {
    // Loading resolves before the library's picking worker finishes. Starting
    // another scene rebuild in that gap can invalidate the previous tree.
    const deadline = performance.now() + 60000;
    while (this.viewer.splatMesh?.baseSplatTree) {
      if (performance.now() > deadline) throw new Error('素材选取索引仍在构建，请稍后重试。');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async addScene(id, url, transform, format) {
    const options = {
      ...DEFAULT_SCENE_OPTIONS,
      position: [transform.position.x, transform.position.y, transform.position.z],
      rotation: this.toQuaternion(transform.rotation),
      scale: [transform.scale, transform.scale, transform.scale],
    };
    // Object URLs produced by <input type=file> have no extension. Explicit
    // format selection keeps local .ply / .splat / .spz imports reliable.
    const sceneFormat = this.resolveSceneFormat(format);
    if (sceneFormat !== undefined) options.format = sceneFormat;
    const index = this.viewer.getSceneCount();
    await this.viewer.addSplatScene(url, options);
    // addSplatScene resolves when loading finishes; it does not return a scene.
    const scene = this.viewer.getSplatScene(index);
    this.scenes.set(id, scene);
    this.refreshScenes();
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i = 0; i < scene.splatBuffer.getSplatCount(); i++) {
      scene.splatBuffer.getSplatCenter(i, point);
      bounds.expandByPoint(point);
    }
    this.bounds.set(id, bounds);
    this.applyTransform(id, transform);
    return scene;
  }

  remove(id) {
    return this.enqueue(async () => {
      const index = [...this.scenes.keys()].indexOf(id);
      if (index < 0) return;
      await this.viewer.removeSplatScene(index, false);
      this.scenes.delete(id);
      this.transforms.delete(id);
      this.appearances.delete(id);
      this.bounds.delete(id);
      this.refreshScenes();
    });
  }

  refreshScenes() {
    [...this.scenes.keys()].forEach((id, index) => {
      this.scenes.set(id, this.viewer.getSplatScene(index));
      if (this.transforms.has(id)) this.applyTransform(id, this.transforms.get(id));
      if (this.appearances.has(id)) this.setAppearance(id, this.appearances.get(id));
    });
  }

  applyTransform(id, transform) {
    const scene = this.scenes.get(id);
    if (!scene) return;
    this.transforms.set(id, structuredClone(transform));
    const position = new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z);
    const rotation = new THREE.Euler(
      THREE.MathUtils.degToRad(transform.rotation.x),
      THREE.MathUtils.degToRad(transform.rotation.y),
      THREE.MathUtils.degToRad(transform.rotation.z),
      'XYZ',
    );
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);
    const scale = new THREE.Vector3(transform.mirrorX ? -transform.scale : transform.scale, transform.scale, transform.scale);

    // The renderer recomputes transform from Object3D each frame.
    scene.position.copy(position);
    scene.quaternion.copy(quaternion);
    scene.scale.copy(scale);
    scene.updateTransform(true);
    this.viewer.forceRenderNextFrame?.();
  }

  installInkShader() {
    const material = this.viewer.splatMesh?.material;
    if (!material || material.userData.inkLooks) return;
    const count = Number(material.vertexShader.match(/uniform float sceneOpacity\[(\d+)\]/)?.[1]);
    const anchor = 'vec2 ndcOffset =';
    if (!count || !material.vertexShader.includes(anchor)) throw new Error('当前渲染器不支持分层水墨着色。');
    const values = new Float32Array(count * 4).fill(1);
    material.uniforms.inkLooks = { value: values };
    material.vertexShader = material.vertexShader.replace('uniform float splatScale;',
      `uniform float splatScale;\nuniform vec4 inkLooks[${count}];`);
    material.vertexShader = material.vertexShader.replace(anchor, `
      vec4 ink = inkLooks[sceneIndex];
      // Stable local-space noise: density edits never reshuffle other layers.
      float grain = fract(sin(dot(splatCenter, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      if (ink.x < 0.999) vColor.a *= smoothstep(grain - 0.025, grain + 0.025, ink.x);
      basisVector1 *= ink.y;
      basisVector2 *= ink.y;
      vColor.a /= max(1.0, ink.y);
      float luminance = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      vColor.rgb = clamp(mix(vec3(luminance), vColor.rgb, ink.z), 0.0, 1.0);
      ${anchor}`);
    material.userData.inkLooks = true;
    material.needsUpdate = true;
  }

  setAppearance(id, { opacity, density = 1, softness = 1, saturation = 1 }) {
    const scene = this.scenes.get(id);
    if (!scene) return;
    this.appearances.set(id, { opacity, density, softness, saturation });
    // Native opacity/visibility plus per-scene custom Gaussian appearance.
    scene.opacity = opacity;
    scene.visible = opacity > 0;
    // minimumAlpha is a load-time cutoff, not a live shader control.
    this.installInkShader();
    const index = [...this.scenes.keys()].indexOf(id);
    const values = this.viewer.splatMesh.material.uniforms.inkLooks.value;
    values.set([density, softness, saturation, 1], index * 4);
    this.viewer.forceRenderNextFrame?.();
  }

  setBackground(hex) {
    this.background = hex;
    // Three.js accepts a CSS color string here. Passing {r,g,b} resulted in a
    // black clear color in Edge, hiding the intended rice-paper canvas.
    if (this.viewer?.renderer?.setClearColor) this.viewer.renderer.setClearColor(hex, 1);
    if (this.viewer?.renderer) this.viewer.renderer.setClearAlpha(1);
    this.container.style.backgroundColor = hex;
  }

  fitScene() {
    const box = new THREE.Box3();
    for (const [id, scene] of this.scenes) {
      if (scene.visible && this.bounds.has(id)) box.union(this.bounds.get(id).clone().applyMatrix4(scene.transform));
    }
    if (box.isEmpty()) return;
    const camera = this.viewer.camera;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(size.y / (2 * tan), size.x / (2 * tan * camera.aspect)) * 1.2 + size.z / 2;
    const direction = camera.position.clone().sub(this.viewer.controls.target).normalize();
    camera.position.copy(center).addScaledVector(direction, Math.max(distance, 0.5));
    this.viewer.controls.target.copy(center);
    this.viewer.controls.update();
    this.viewer.forceRenderNextFrame();
  }

  pick(clientX, clientY) {
    if (!this.viewer.splatRenderReady) return null;
    const rect = this.canvas.getBoundingClientRect();
    const mesh = this.viewer.splatMesh;
    mesh.updateTransforms();
    this.viewer.camera.updateMatrixWorld();
    const hits = [];
    this.viewer.raycaster.setFromCameraAndScreenPosition(this.viewer.camera,
      new THREE.Vector2(clientX - rect.left, clientY - rect.top), new THREE.Vector2(rect.width, rect.height));
    this.viewer.raycaster.intersectSplatMesh(mesh, hits);
    const ids = [...this.scenes.keys()];
    for (const hit of hits) {
      const id = ids[mesh.getSceneIndexForSplat(hit.splatIndex)];
      if (this.scenes.get(id)?.visible) return id;
    }
    return null;
  }

  dragPlanePoint(clientX, clientY, origin, lockZ) {
    const camera = this.viewer.camera;
    const rect = this.canvas.getBoundingClientRect();
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1,
      1 - (clientY - rect.top) / rect.height * 2), camera);
    const normal = lockZ ? new THREE.Vector3(0, 0, 1) : camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal,
      new THREE.Vector3(origin.x, origin.y, origin.z));
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }

  project(position) {
    const camera = this.viewer.camera;
    camera.updateMatrixWorld();
    const point = new THREE.Vector3(position.x, position.y, position.z).project(camera);
    return { x: (point.x + 1) * 50, y: (1 - point.y) * 50, visible: Math.abs(point.z) < 1 };
  }

  flowerOrigin(id, localPoint) {
    const scene=this.scenes.get(id),bounds=this.bounds.get(id);
    if(!scene||!bounds)return null;
    scene.updateTransform(true);
    let point;
    if(localPoint)point=new THREE.Vector3(localPoint.x,localPoint.y,localPoint.z).applyMatrix4(scene.transform);
    else {
      const world=bounds.clone().applyMatrix4(scene.transform);
      point=world.getCenter(new THREE.Vector3());point.y=world.min.y+(world.max.y-world.min.y)*.68;
    }
    const projected=this.project(point),rect=this.canvas.getBoundingClientRect();
    return projected.visible ? {x:rect.left+rect.width*projected.x/100,y:rect.top+rect.height*projected.y/100} : null;
  }

  localFlowerAnchor(id, x, y) {
    const scene=this.scenes.get(id);if(!scene)return null;
    const point=this.dragPlanePoint(x,y,scene.position,false);if(!point)return null;
    scene.updateTransform(true);point.applyMatrix4(scene.transform.clone().invert());
    return {x:point.x,y:point.y,z:point.z};
  }

  setView(kind) {
    const views = {
      front: { position: [0, 0, 1.3], lookAt: [0, 0, 0] },
      side: { position: [1.3, 0, 0], lookAt: [0, 0, 0] },
    };
    const view = views[kind];
    if (!view || !this.viewer?.camera) return;
    this.viewer.camera.position.set(...view.position);
    this.viewer.camera.lookAt(...view.lookAt);
    this.viewer.controls.target.set(...view.lookAt);
    this.viewer.controls.update();
  }

  setControlsEnabled(enabled) {
    if (this.viewer?.controls) this.viewer.controls.enabled = enabled;
  }

  setAutoRotate(enabled, speed = 0.6) {
    if (!this.viewer?.controls) return;
    this.viewer.controls.autoRotate = enabled;
    this.viewer.controls.autoRotateSpeed = speed * 0.75;
    this.viewer.forceRenderNextFrame?.();
  }

  async exportPng(width, height, overlays=[]) {
    const canvas = this.canvas;
    if (!canvas) throw new Error('渲染画布尚未创建。');
    // Rendering at native canvas size avoids recreating the splat worker. The
    // result is scaled onto a clean export canvas at the requested resolution.
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    context.fillStyle = this.background;
    context.fillRect(0, 0, width, height);
    this.viewer.render();
    context.drawImage(canvas, 0, 0, width, height);
    for(const layer of overlays){context.save();context.globalAlpha=layer.opacity;context.drawImage(layer.canvas,0,0,width,height);context.restore();}
    return new Promise((resolve) => output.toBlob(resolve, 'image/png'));
  }

  disposeObjectUrl(url) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  setVector(target, values) {
    if (!target) return;
    if (typeof target.set === 'function') target.set(...values);
    else if (Array.isArray(target)) values.forEach((value, index) => { target[index] = value; });
    else values.forEach((value, index) => { target[index] = value; });
  }

  toQuaternion(rotationDegrees) {
    const x = rotationDegrees.x * Math.PI / 180;
    const y = rotationDegrees.y * Math.PI / 180;
    const z = rotationDegrees.z * Math.PI / 180;
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    return [
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz,
    ];
  }

  resolveSceneFormat(format) {
    if (!format || !GaussianSplats3D.SceneFormat) return undefined;
    const normalized = format.toLowerCase().replace(/[^a-z]/g, '');
    const match = Object.entries(GaussianSplats3D.SceneFormat).find(([name]) =>
      name.toLowerCase().replace(/[^a-z]/g, '') === normalized,
    );
    return match?.[1];
  }
}
