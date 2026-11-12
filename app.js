import { SplatRenderer } from './splat-adapter.js?v=gesture-14';
import { HandGestures } from './hand-gestures.js';

const SAMPLE_ASSETS = [
  { name: '花篮 · 一', file: './assets/TripoSplat_painting_01_00001_.spz' },
  { name: '花篮 · 二', file: './assets/TripoSplat_painting_02_00001_.spz' },
  { name: '花篮 · 三', file: './assets/TripoSplat_painting_03_00001_.spz' },
  { name: '花篮 · 四', file: './assets/TripoSplat_painting_04_00001_.spz' },
];

const state = {
  assets: [],
  selectedId: null,
  selectedIds: new Set(),
  activeTool: 'move',
  cameraMode: false,
  gridVisible: true,
  dragging: null,
  renderer: null,
  sourceImage: null,
  lockTo2D: false,
  uniformScale: true,
  autoRotate: false,
  rotateSpeed: 0.6,
  effect: { enabled: false, strength: 0.35, speed: 1, density: 0.35, frame: null, targetIds: new Set(), mode: 'breathing', startedAt: 0, rotationBefore: null },
};

const ui = {
  viewport: document.querySelector('#viewport'),
  fileInput: document.querySelector('#file-input'),
  emptyImport: document.querySelector('#empty-import'),
  emptyState: document.querySelector('#empty-state'),
  materialList: document.querySelector('#material-list'),
  materialTemplate: document.querySelector('#material-template'),
  materialCount: document.querySelector('#material-count'),
  sceneSummary: document.querySelector('#scene-summary'),
  status: document.querySelector('#render-status'),
  inspector: document.querySelector('#inspector-form'),
  emptyInspector: document.querySelector('#empty-inspector'),
  selectedName: document.querySelector('#selected-name'),
  transformHint: document.querySelector('#transform-hint'),
  background: document.querySelector('#background-color'),
  exportSize: document.querySelector('#export-size'),
  toastRegion: document.querySelector('#toast-region'),
  imageInput: document.querySelector('#image-input'),
  artworkPreview: document.querySelector('#artwork-preview'),
  artworkPlaceholder: document.querySelector('#artwork-placeholder'),
  generateButton: document.querySelector('#generate-ink'),
  generationStatus: document.querySelector('#generation-status'),
  gizmo: document.querySelector('#transform-gizmo'),
  paperPreset: document.querySelector('#paper-preset'),
  dissolveEnabled: document.querySelector('#dissolve-enabled'),
  dissolveStrength: document.querySelector('#dissolve-strength'),
  dissolveSpeed: document.querySelector('#dissolve-speed'),
  dissolveDensity: document.querySelector('#dissolve-density'),
  dissolveStrengthValue: document.querySelector('#dissolve-strength-value'),
  dissolveSpeedValue: document.querySelector('#dissolve-speed-value'),
  dissolveDensityValue: document.querySelector('#dissolve-density-value'),
  autoRotate: document.querySelector('#auto-rotate'),
  rotateSpeed: document.querySelector('#rotate-speed'),
  rotateSpeedValue: document.querySelector('#rotate-speed-value'),
};

function createAsset({ name, url, kind = 'SPZ' }) {
  return {
    id: crypto.randomUUID(),
    name,
    url,
    kind,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1,
    opacity: 1,
    density: 1,
    softness: 1,
    saturation: 1,
    mirrorX: false,
    visible: true,
    locked: false,
  };
}

function selectedAsset() {
  return state.assets.find((asset) => asset.id === state.selectedId) ?? null;
}

async function initialize() {
  try {
    state.renderer = new SplatRenderer(ui.viewport, { background: ui.background.value });
    await state.renderer.init();
    state.renderer.viewer.controls.addEventListener('change', () => renderGizmo(selectedAsset()));
    state.renderer.setAutoRotate(state.autoRotate, state.rotateSpeed);
    setStatus('渲染器已就绪');
  } catch (error) {
    setStatus('渲染器加载失败', true);
    toast('无法加载本地渲染库。请用启动程序打开，并确认 vendor 文件夹完整。', true);
    console.error(error);
  }
  bindEvents();
  render();
  await loadRequestedPainting();
}

async function loadRequestedPainting() {
  const requested = Number(new URLSearchParams(location.search).get('painting'));
  if (!Number.isInteger(requested) || requested < 1 || requested > SAMPLE_ASSETS.length) return;
  const sample = SAMPLE_ASSETS[requested - 1];
  const asset = createAsset({ name: `国画 ${String(requested).padStart(2, '0')} · 3D`, url: sample.file, kind: 'SPZ' });
  // TripoSplat's generated front side faces -Z, while the web viewer camera
  // starts on +Z. Turning it around exposes the front, and mirroring X then
  // restores the original left/right reading order of the source painting.
  asset.rotation.y = 180;
  asset.rotation.z = 180;
  asset.mirrorX = true;
  await addAsset(asset);
  state.renderer?.setView('front');
}

function bindEvents() {
  ui.fileInput.addEventListener('change', async (event) => {
    await importFiles([...event.target.files]);
    event.target.value = '';
  });
  ui.imageInput.addEventListener('change', chooseSourceImage);
  ui.generateButton.addEventListener('click', generateInkSplat);
  ui.emptyImport.addEventListener('click', () => ui.fileInput.click());
  document.querySelector('#add-sample').addEventListener('click', addSample);
  document.querySelector('#add-all-samples').addEventListener('click', addAllSamples);
  document.querySelector('#select-all').addEventListener('click', selectAllAssets);
  document.querySelector('#clear-scene').addEventListener('click', clearScene);
  document.querySelector('#remove-selected').addEventListener('click', () => removeAsset(state.selectedId));
  document.querySelector('#reset-selected').addEventListener('click', resetSelected);
  document.querySelector('#flip-facing').addEventListener('click', flipFacing);
  document.querySelector('#mirror-selected').addEventListener('click', mirrorSelected);
  document.querySelector('#duplicate-selected').addEventListener('click', duplicateSelected);
  document.querySelector('#save-composition').addEventListener('click', saveComposition);
  document.querySelector('#open-project').addEventListener('click', () => document.querySelector('#project-input').click());
  document.querySelector('#project-input').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (file) await openComposition(file);
    event.target.value = '';
  });
  document.querySelector('#mode-2d').addEventListener('change', (event) => { state.lockTo2D = event.target.checked; });
  document.querySelector('#uniform-scale').addEventListener('change', (event) => { state.uniformScale = event.target.checked; });
  document.querySelector('#fit-scene').addEventListener('click', () => state.renderer?.fitScene());
  document.querySelector('#camera-mode').addEventListener('click', () => setCameraMode(!state.cameraMode));
  document.querySelector('#view-front').addEventListener('click', () => state.renderer?.setView('front'));
  document.querySelector('#view-side').addEventListener('click', () => state.renderer?.setView('side'));
  document.querySelector('#export-png').addEventListener('click', exportPng);
  document.querySelector('#toggle-grid').addEventListener('click', toggleGrid);
  document.querySelector('#hide-ui').addEventListener('click', toggleUi);
  document.querySelector('#fullscreen').addEventListener('click', toggleFullscreen);
  document.querySelector('#exit-presentation').addEventListener('click', exitPresentation);
  document.addEventListener('fullscreenchange', () => {
    // Browsers can consume Esc themselves; restoring via this event covers it.
    if (!document.fullscreenElement) setUiHidden(false);
    syncPresentationControls();
  });
  ui.paperPreset.addEventListener('change', applyPaperPreset);
  ui.dissolveEnabled.addEventListener('change', () => {
    if (ui.dissolveEnabled.checked) startInkEffect('breathing');
    else stopInkEffect();
  });
  [ui.dissolveStrength, ui.dissolveSpeed, ui.dissolveDensity].forEach((input) => input.addEventListener('input', () => {
    state.effect.strength = Number(ui.dissolveStrength.value);
    state.effect.speed = Number(ui.dissolveSpeed.value);
    state.effect.density = Number(ui.dissolveDensity.value);
    renderEffectLabels();
    if (!state.effect.enabled) applyEffectAppearance(0);
  }));
  document.querySelector('#play-reveal').addEventListener('click', playReveal);
  document.querySelector('#stop-reveal').addEventListener('click', stopInkEffect);
  document.querySelectorAll('[data-ink-preset]').forEach(button => button.addEventListener('click', () => {
    const asset = selectedAsset();
    if (!asset || asset.locked) return;
    const presets = { original: [1, 1, 1, 1], soft: [0.9, 1, 1.16, 0.82], dry: [0.92, 0.65, 0.93, 0.7] };
    [asset.opacity, asset.density, asset.softness, asset.saturation] = presets[button.dataset.inkPreset];
    syncAsset(asset);
  }));
  ui.autoRotate.addEventListener('change', () => {
    // An explicit user change takes precedence over animation-owned rotation.
    state.effect.rotationBefore = null;
    state.autoRotate = ui.autoRotate.checked;
    if (state.autoRotate) setCameraMode(true);
    state.renderer?.setAutoRotate(state.autoRotate, state.rotateSpeed);
  });
  ui.rotateSpeed.addEventListener('input', () => {
    state.rotateSpeed = Number(ui.rotateSpeed.value);
    ui.rotateSpeedValue.value = `${state.rotateSpeed.toFixed(1)}×`;
    state.renderer?.setAutoRotate(state.autoRotate, state.rotateSpeed);
  });
  document.querySelectorAll('[data-transform]').forEach((button) => {
    button.addEventListener('click', () => setTool(button.dataset.transform));
  });
  document.querySelectorAll('[data-bind]').forEach((input) => {
    input.addEventListener('input', () => applyInspector(input));
  });
  ui.background.addEventListener('input', () => state.renderer?.setBackground(ui.background.value));
  ui.viewport.addEventListener('pointerdown', beginTransform, true);
  ui.viewport.addEventListener('wheel', scaleSelectedWithWheel, { capture: true, passive: false });
  window.addEventListener('pointermove', updateTransform);
  window.addEventListener('pointerup', endTransform);
  window.addEventListener('pointercancel', endTransform);
  window.addEventListener('blur', endTransform);
  ui.viewport.addEventListener('lostpointercapture', endTransform);
  bindLayerMenu();
  window.addEventListener('keydown', onShortcut);
  state.gestures = new HandGestures({
    canDraw:()=>state.assets.some(asset=>asset.visible),
    getOrigins:()=>state.assets.filter(asset=>state.selectedIds.has(asset.id)&&asset.visible&&!asset.locked)
      .map(asset=>state.renderer?.flowerOrigin(asset.id,asset.flowerAnchor)).filter(Boolean),
    onStop:()=>{if(state.effect.enabled)stopInkEffect();},
    onAnchor:()=>{
      const asset=selectedAsset();if(!asset||asset.locked||!asset.visible)return toast('请先选中一个可见、未锁定的花篮。',true);
      setCameraMode(false);state.settingBloomAnchor=asset.id;
      document.querySelector('#hand-status').textContent='请在选中花篮的花朵上单击，设置花瓣起点（Esc 取消）';
    },
  });
}

function bindLayerMenu() {
  const menu = document.querySelector('#layer-menu');
  const name = document.querySelector('#layer-name');
  let targetId = null;
  let rightGesture = null;
  const close = () => { menu.hidden = true; targetId = null; };
  const open = (id, x, y) => {
    const asset = state.assets.find(item => item.id === id);
    if (!asset) return close();
    endTransform();
    selectAsset(id);
    targetId = id;
    name.value = asset.name;
    menu.querySelector('[data-layer-action=visibility]').textContent = asset.visible ? '隐藏图层' : '显示图层';
    menu.querySelector('[data-layer-action=lock]').textContent = asset.locked ? '解锁图层' : '锁定图层';
    menu.querySelectorAll('[data-layer-tool]').forEach(button => { button.disabled = asset.locked || !asset.visible; });
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    name.focus({ preventScroll: true });
    name.select();
  };
  window.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target)) close();
    rightGesture = event.button === 2 ? { x: event.clientX, y: event.clientY, moved: false } : null;
  }, true);
  window.addEventListener('pointermove', event => {
    if (rightGesture && Math.hypot(event.clientX - rightGesture.x, event.clientY - rightGesture.y) > 6) rightGesture.moved = true;
  }, true);
  ui.viewport.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (rightGesture?.moved || state.dragging) return;
    const id = event.target.closest('#transform-gizmo') ? state.selectedId : state.renderer?.pick(event.clientX, event.clientY);
    open(id, event.clientX, event.clientY);
  });
  ui.materialList.addEventListener('contextmenu', event => {
    event.preventDefault();
    const row = event.target.closest('[data-asset-id]');
    if (row) open(row.dataset.assetId, event.clientX, event.clientY);
  });
  menu.addEventListener('contextmenu', event => event.preventDefault());
  menu.addEventListener('submit', event => {
    event.preventDefault();
    const asset = state.assets.find(item => item.id === targetId);
    if (asset && name.value.trim()) { asset.name = name.value.trim().slice(0, 80); render(); }
    close();
    ui.viewport.focus({ preventScroll: true });
  });
  menu.addEventListener('click', async event => {
    const button = event.target.closest('[data-layer-action], [data-layer-tool]');
    const asset = state.assets.find(item => item.id === targetId);
    if (!button || !asset || button.disabled) return;
    selectAsset(asset.id);
    close();
    if (button.dataset.layerTool) setTool(button.dataset.layerTool);
    else if (button.dataset.layerAction === 'visibility') { asset.visible = !asset.visible; applyEffectAppearance(inkPulse(), asset); render(); }
    else if (button.dataset.layerAction === 'lock') { asset.locked = !asset.locked; render(); }
    else if (button.dataset.layerAction === 'duplicate') await duplicateSelected();
    else if (button.dataset.layerAction === 'remove') await removeAsset(asset.id);
    ui.viewport.focus({ preventScroll: true });
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); close(); ui.viewport.focus(); }
  });
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
}

function chooseSourceImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (state.sourceImage?.previewUrl) URL.revokeObjectURL(state.sourceImage.previewUrl);
  state.sourceImage = { file, previewUrl: URL.createObjectURL(file) };
  ui.artworkPreview.src = state.sourceImage.previewUrl;
  ui.artworkPreview.hidden = false;
  ui.artworkPlaceholder.hidden = true;
  ui.generationStatus.textContent = `已选择：${file.name}`;
}

async function generateInkSplat() {
  if (!state.sourceImage) return toast('请先上传一幅国画或花鸟图片。', true);
  if (!state.renderer) return toast('渲染器仍在初始化，请稍候。', true);
  const requestId = `ink_${Date.now()}`;
  ui.generateButton.disabled = true;
  ui.generationStatus.textContent = '正在上传国画…';
  try {
    const form = new FormData();
    form.append('image', state.sourceImage.file);
    const upload = await fetchJson('/comfy/upload/image', { method: 'POST', body: form });
    const imageName = upload.name;
    if (!imageName) throw new Error('ComfyUI 没有返回上传文件名。');

    ui.generationStatus.textContent = '正在从水墨生成 3D Gaussian Splat…';
    const response = await fetchJson('/comfy/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildTripoPrompt(imageName, requestId), client_id: 'ink-splat-studio' }),
    });
    if (!response.prompt_id) throw new Error(response.error?.message ?? 'ComfyUI 未能创建生成任务。');

    const output = await waitForComfyResult(response.prompt_id, (seconds) => {
      ui.generationStatus.textContent = `正在生成立体水墨（${seconds}s）…`;
    });
    const model = output?.outputs?.['13']?.['3d']?.[0];
    if (!model) throw new Error('生成任务完成，但没有找到 SPZ 输出。');
    const sourceName = state.sourceImage.file.name.replace(/\.[^.]+$/, '');
    const query = new URLSearchParams({ filename: model.filename, subfolder: model.subfolder ?? '', type: model.type ?? 'output' });
    await addAsset(createAsset({ name: `${sourceName} · 3D`, url: `/comfy/view?${query}`, kind: 'SPZ' }));
    ui.generationStatus.textContent = '3D 国画已生成，并加入当前场景。';
    toast('3D 水墨素材生成完成。');
  } catch (error) {
    const localBridgeHint = location.pathname.includes('index.html') || location.port === '5173'
      ? ' 请改用 server.py 启动后的 http://127.0.0.1:5174。'
      : '';
    ui.generationStatus.textContent = '生成失败，请检查 ComfyUI 是否正在运行。';
    toast(`${error.message ?? '生成失败。'}${localBridgeHint}`, true);
    console.error(error);
  } finally {
    ui.generateButton.disabled = false;
  }
}

function buildTripoPrompt(imageName, prefix) {
  const seed = Math.floor(Math.random() * 900000000) + 100000000;
  return {
    '1': { class_type: 'LoadImage', inputs: { image: imageName } },
    '2': { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
    '3': { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['2', 0], image: ['1', 0] } },
    '4': { class_type: 'TripoSplatPreprocessImage', inputs: { image: ['1', 0], mask: ['3', 0], erode_radius: 1, size: 1024 } },
    '5': { class_type: 'CLIPVisionLoader', inputs: { clip_name: 'dino_v3_vit_h.safetensors' } },
    '6': { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    '7': { class_type: 'TripoSplatConditioning', inputs: { clip_vision: ['5', 0], vae: ['6', 0], image: ['4', 0] } },
    '8': { class_type: 'UNETLoader', inputs: { unet_name: 'triposplat_fp16.safetensors', weight_dtype: 'default' } },
    '9': { class_type: 'KSampler', inputs: { model: ['8', 0], seed, steps: 20, cfg: 3.0, sampler_name: 'dpmpp_2m', scheduler: 'simple', positive: ['7', 0], negative: ['7', 1], latent_image: ['7', 2], denoise: 1 } },
    '10': { class_type: 'VAELoader', inputs: { vae_name: 'triposplat_vae_decoder_fp16.safetensors' } },
    '11': { class_type: 'VAEDecodeTripoSplat', inputs: { samples: ['9', 0], vae: ['10', 0], num_gaussians: 131072, seed } },
    '12': { class_type: 'SplatToFile3D', inputs: { splat: ['11', 0], format: 'spz' } },
    '13': { class_type: 'SaveGLB', inputs: { mesh: ['12', 0], filename_prefix: `3d/InkStudio_${prefix}` } },
  };
}

async function waitForComfyResult(promptId, onTick) {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    await sleep(2000);
    const history = await fetchJson(`/comfy/history/${promptId}`);
    const entry = history[promptId];
    onTick(Math.round((Date.now() - started) / 1000));
    if (!entry) continue;
    if (entry.status?.status_str === 'success') return entry;
    if (entry.status?.status_str === 'error') throw new Error(entry.status?.messages?.at(-1)?.[1]?.exception_message ?? 'ComfyUI 生成任务失败。');
  }
  throw new Error('生成任务等待超时。');
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`本机 ComfyUI 服务返回 ${response.status}。`);
  return response.json();
}

function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function importFiles(files) {
  const accepted = files.filter((file) => /\.(splat|ply|spz|ksplat)$/i.test(file.name));
  if (!accepted.length) return toast('请选择 .splat、.ply、.spz 或 .ksplat 格式素材。', true);
  for (const file of accepted) {
    const url = URL.createObjectURL(file);
    await addAsset(createAsset({ name: file.name.replace(/\.[^.]+$/, ''), url, kind: file.name.split('.').pop().toUpperCase() }));
  }
}

async function addSample() {
  const sample = SAMPLE_ASSETS[state.assets.length % SAMPLE_ASSETS.length];
  const copy = createAsset({ name: sample.name, url: sample.file, kind: 'SPZ' });
  const order = state.assets.length;
  copy.position.x = (order % 3 - 1) * 1.45;
  copy.position.y = Math.floor(order / 3) * 0.35;
  copy.rotation.y = 180;
  copy.rotation.z = 180;
  copy.mirrorX = true;
  await addAsset(copy);
  state.renderer?.fitScene();
}

async function addAllSamples() {
  if (!state.renderer) return toast('渲染器尚未准备好。', true);
  const loadedUrls = new Set(state.assets.map((asset) => asset.url));
  const remaining = SAMPLE_ASSETS.filter((sample) => !loadedUrls.has(sample.file));
  if (!remaining.length) return toast('四幅成品已经都在当前画面中。');
  const startOrder = state.assets.length;
  for (const [index, sample] of remaining.entries()) {
    const copy = createAsset({ name: sample.name, url: sample.file, kind: 'SPZ' });
    const order = startOrder + index;
    copy.position.x = (order % 3 - 1) * 1.25;
    copy.position.y = Math.floor(order / 3) * 0.7 - 0.25;
    copy.scale = 0.72;
    copy.rotation.y = 180;
    copy.rotation.z = 180;
    copy.mirrorX = true;
    await addAsset(copy);
  }
  state.renderer.fitScene();
  toast(`已加入 ${remaining.length} 幅素材，点击任意一幅即可单独拖动。`);
}

async function addAsset(asset) {
  if (!state.renderer) return toast('渲染器尚未准备好。', true);
  state.assets.push(asset);
  selectAsset(asset.id);
  render();
  setStatus(`正在载入 ${asset.name}`);
  try {
    await state.renderer.add(asset.id, asset.url, asset, asset.kind);
    state.renderer.setAppearance(asset.id, asset);
    renderGizmo(selectedAsset());
    setStatus('渲染器已就绪');
    toast(`已加入素材：${asset.name}`);
    return true;
  } catch (error) {
    state.assets = state.assets.filter((item) => item.id !== asset.id);
    state.renderer.disposeObjectUrl(asset.url);
    selectAsset(state.assets.at(-1)?.id ?? null);
    render();
    setStatus('素材载入失败', true);
    toast(`${asset.name} 无法载入。请检查文件格式或尝试 .splat / .ply。`, true);
    console.error(error);
    return false;
  }
}

async function removeAsset(id) {
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return;
  endTransform();
  try { await state.renderer?.remove(id); } catch (error) {
    toast('素材移除失败，请稍后重试。', true);
    return;
  }
  if (!state.assets.some((item) => item.id !== id && item.url === asset.url)) state.renderer?.disposeObjectUrl(asset.url);
  state.assets = state.assets.filter((item) => item.id !== id);
  selectAsset(state.assets.at(-1)?.id ?? null);
  render();
}

async function clearScene() {
  for (const asset of [...state.assets]) await removeAsset(asset.id);
  toast('画面已清空。');
}

function selectAsset(id, toggle = false) {
  if (state.dragging && state.selectedId !== id) endTransform();
  if ((state.selectedId !== id || toggle || state.selectedIds.size !== 1) && state.effect.enabled) stopInkEffect();
  if (toggle) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    state.selectedId = state.selectedIds.has(id) ? id : [...state.selectedIds].at(-1) ?? null;
  } else {
    state.selectedId = id;
    state.selectedIds = new Set(id ? [id] : []);
  }
  setCameraMode(false);
  render();
}

function selectAllAssets() {
  endTransform();
  stopInkEffect();
  state.selectedIds = new Set(state.assets.map(asset => asset.id));
  if (!state.selectedIds.has(state.selectedId)) state.selectedId = state.assets[0]?.id ?? null;
  render();
}

function renderSelectionSummary() {
  const count = state.assets.filter(asset => state.selectedIds.has(asset.id)).length;
  const eligible = state.assets.filter(asset => state.selectedIds.has(asset.id) && asset.visible && !asset.locked).length;
  document.querySelector('#selection-summary').textContent = `已选 ${count} 幅 · 可播放 ${eligible} 幅（跳过隐藏／锁定）`;
  document.querySelector('#select-all').disabled = state.assets.length === 0;
  document.querySelector('#stop-reveal').disabled = !state.effect.enabled;
}

function resetSelected() {
  const asset = selectedAsset();
  if (!asset || asset.locked) return;
  Object.assign(asset.position, { x: 0, y: 0, z: 0 });
  Object.assign(asset.rotation, { x: 0, y: 0, z: 0 });
  Object.assign(asset, { scale: 1, opacity: 1, density: 1, softness: 1, saturation: 1, mirrorX: false });
  syncAsset(asset);
}

function flipFacing() {
  const asset = selectedAsset();
  if (!asset || asset.locked) return;
  asset.rotation.y = (asset.rotation.y + 180) % 360;
  syncAsset(asset);
  toast('已翻转到另一面。');
}

function mirrorSelected() {
  const asset = selectedAsset();
  if (!asset || asset.locked) return;
  asset.mirrorX = !asset.mirrorX;
  syncAsset(asset);
  toast(asset.mirrorX ? '已左右镜像。' : '已恢复原始左右方向。');
}

async function duplicateSelected() {
  const asset = selectedAsset();
  if (!asset) return;
  const copy = structuredClone(asset);
  copy.id = crypto.randomUUID();
  copy.name = `${asset.name} 副本`;
  copy.position.x += 0.35;
  copy.position.y += 0.15;
  await addAsset(copy);
}

async function saveComposition() {
  if (!state.assets.length) return toast('当前没有可以保存的素材。', true);
  const button = document.querySelector('#save-composition');
  button.disabled = true;
  try {
    const assets = structuredClone(state.assets), payload = [];
    let total = 0;
    for (const asset of assets) {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`无法读取 ${asset.name}`);
      const bytes = await response.arrayBuffer();
      total += bytes.byteLength;
      if (total > 200 * 1024 * 1024) throw new Error('项目素材超过 200 MB，请分成多个项目保存。');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('素材编码失败'));
        reader.readAsDataURL(new Blob([bytes], { type:'application/octet-stream' }));
      });
      const { id, url, ...settings } = asset;
      payload.push({ ...settings, data });
    }
    const blob = new Blob([JSON.stringify({ format:'ink-splat-project', version:2, selected:assets.findIndex(a=>a.id===state.selectedId), assets:payload, flowers:state.gestures?.serializeDrawing()??[] })], { type:'application/json' });
    const href = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href, download:`四时花开项目-${Date.now()}.ink.json` }).click();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
    toast('项目已下载，包含模型和图层参数，可复制到另一台电脑继续编辑。');
  } catch (error) { toast(`保存失败：${error.message}`, true); }
  finally { button.disabled = false; }
}

async function openComposition(file) {
  if (!state.renderer) return toast('请等待渲染器准备好。', true);
  try {
    if (file.size > 280 * 1024 * 1024) throw new Error('项目文件过大（上限 280 MB）。');
    const project = JSON.parse(await file.text());
    if (project.format !== 'ink-splat-project' || project.version !== 2 || !Array.isArray(project.assets) || !project.assets.length || project.assets.length > 32)
      throw new Error('请选择新版保存的 .ink.json 项目文件。旧版布局 JSON 未包含模型。');
    if (project.assets.length + state.assets.length > 32) throw new Error('总图层数不能超过 32，请在空场景中打开。');
    // Validate every layer before changing the existing scene; never fetch URLs from JSON.
    const records = project.assets.map(record => {
      if (!['SPZ','SPLAT','PLY','KSPLAT'].includes(record.kind) || typeof record.data !== 'string' || !/^data:application\/octet-stream;base64,[A-Za-z0-9+/]+={0,2}$/.test(record.data)) throw new Error('项目中的模型格式或内嵌数据无效。');
      const validNumber = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;
      const item = { name:String(record.name || '导入图层').slice(0,80), kind:record.kind,
        position:{}, rotation:{}, scale:validNumber(record.scale,1,0.1,10), opacity:validNumber(record.opacity,1,0,1),
        density:validNumber(record.density,1,0.08,1), softness:validNumber(record.softness,1,0.8,1.5), saturation:validNumber(record.saturation,1,0,1.2),
        visible:record.visible !== false, locked:record.locked === true, mirrorX:record.mirrorX === true };
      for(const axis of ['x','y','z']) {
        item.position[axis]=validNumber(record.position?.[axis],0,-1000000,1000000);
        item.rotation[axis]=validNumber(record.rotation?.[axis],0,-360000,360000);
      }
      if(record.flowerAnchor && ['x','y','z'].every(axis=>Number.isFinite(record.flowerAnchor[axis])))
        item.flowerAnchor=Object.fromEntries(['x','y','z'].map(axis=>[axis,validNumber(record.flowerAnchor[axis],0,-1000000,1000000)]));
      const binary=atob(record.data.split(',')[1]);
      return { settings:item, bytes:Uint8Array.from(binary, char=>char.charCodeAt(0)) };
    });
    const imported=[];
    for(const record of records) {
      const url=URL.createObjectURL(new Blob([record.bytes],{type:'application/octet-stream'}));
      const asset=Object.assign(createAsset({...record.settings,url}),record.settings);
      if(await addAsset(asset)) { applyEffectAppearance(0,asset); imported.push(asset); }
    }
    if(imported.length) { selectAsset(imported[project.selected]?.id || imported[0].id); state.renderer.fitScene(); }
    if(imported.length)state.gestures?.restoreDrawing(project.flowers);
    toast(`已追加 ${imported.length}/${records.length} 个项目图层，原有图层已保留。`, imported.length !== records.length);
  } catch(error) { toast(`打开失败：${error.message}`,true); }
}

function setTool(tool) {
  if (state.effect.enabled) stopInkEffect();
  state.activeTool = tool;
  setCameraMode(false);
  document.querySelectorAll('[data-transform]').forEach((button) => button.classList.toggle('is-active', button.dataset.transform === tool));
  renderGizmo(selectedAsset());
}

function setCameraMode(enabled) {
  endTransform();
  state.cameraMode = enabled;
  if (!enabled) {
    state.autoRotate = false;
    ui.autoRotate.checked = false;
    state.renderer?.setAutoRotate(false);
  }
  state.renderer?.setControlsEnabled(enabled);
  const button = document.querySelector('#camera-mode');
  button.classList.toggle('is-active', enabled);
  button.setAttribute('aria-pressed', String(enabled));
  button.textContent = enabled ? '退出视角调整' : '调整整体视角';
  renderGizmo(selectedAsset());
}

function beginTransform(event) {
  if(state.settingBloomAnchor && event.button===0 && !event.target.closest('button')) {
    event.preventDefault();event.stopImmediatePropagation();
    const asset=state.assets.find(item=>item.id===state.settingBloomAnchor);
    if(asset && !asset.locked){asset.flowerAnchor=state.renderer.localFlowerAnchor(asset.id,event.clientX,event.clientY);toast('花瓣起点已设置，会随当前模型一起移动。');}
    state.settingBloomAnchor=null;document.querySelector('#hand-status').textContent='花瓣起点已设置 · 可预览或开启手势';return;
  }
  if (state.dragging) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (state.cameraMode || event.target.closest('button:not(.selection-handle)')) return;
  // In object mode no button/modifier is allowed to start camera controls.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.button !== 0) return;
  if (!state.renderer) return;
  const onHandle = event.target.closest('#transform-gizmo');
  // All three tools edit the list selection, including across overlapping art.
  const pinned = state.selectedId;
  const id = onHandle || pinned ? state.selectedId : state.renderer.pick(event.clientX, event.clientY);
  // Consume the left click before the camera's controls see it.
  event.preventDefault();
  event.stopImmediatePropagation();
  selectAsset(id);
  const asset = selectedAsset();
  if (!asset || !asset.visible || asset.locked) return;
  const startPoint = state.renderer.dragPlanePoint(event.clientX, event.clientY, asset.position, state.lockTo2D);
  state.dragging = { id: asset.id, pointerId: event.pointerId, tool: state.activeTool,
    x: event.clientX, y: event.clientY, original: structuredClone(asset), startPoint, lockZ: state.lockTo2D };
  state.renderer?.setControlsEnabled(false);
  ui.viewport.focus({ preventScroll: true });
  ui.viewport.classList.add('is-transforming');
  ui.viewport.setPointerCapture?.(event.pointerId);
}

function scaleSelectedWithWheel(event) {
  if (state.cameraMode && !state.dragging) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (state.dragging) return;
  const asset = selectedAsset();
  if (!asset || asset.locked || !asset.visible) return;
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? ui.viewport.clientHeight : 1;
  const delta = clamp(event.deltaY * units, -150, 150);
  asset.scale = clamp(asset.scale * Math.exp(-delta * 0.002), 0.1, 5);
  syncAsset(asset);
}

function updateTransform(event) {
  if (!state.dragging || event.pointerId !== state.dragging.pointerId) return;
  const asset = state.assets.find((item) => item.id === state.dragging.id);
  if (!asset || asset.locked || !asset.visible) return endTransform();
  const dx = event.clientX - state.dragging.x;
  const dy = event.clientY - state.dragging.y;
  const original = state.dragging.original;
  if (state.dragging.tool === 'move') {
    const point = state.renderer.dragPlanePoint(event.clientX, event.clientY, original.position, state.dragging.lockZ);
    if (!point || !state.dragging.startPoint) return;
    const delta = point.sub(state.dragging.startPoint);
    for (const axis of ['x', 'y', 'z']) asset.position[axis] = original.position[axis] + delta[axis];
    if (state.dragging.lockZ) asset.position.z = original.position.z;
  } else if (state.dragging.tool === 'rotate') {
    if (state.dragging.lockZ) asset.rotation.z = original.rotation.z + dx * 0.45;
    else {
      asset.rotation.y = original.rotation.y + dx * 0.45;
      asset.rotation.x = original.rotation.x + dy * 0.22;
    }
  } else {
    asset.scale = clamp(original.scale * (1 + (dx - dy) * 0.006), 0.1, 5);
  }
  syncAsset(asset);
}

function endTransform(event) {
  if (!state.dragging || (event?.pointerId != null && event.pointerId !== state.dragging.pointerId)) return;
  const pointerId = state.dragging.pointerId;
  state.dragging = null;
  if (ui.viewport.hasPointerCapture(pointerId)) ui.viewport.releasePointerCapture(pointerId);
  state.renderer?.setControlsEnabled(state.cameraMode);
  ui.viewport.classList.remove('is-transforming');
}

function onShortcut(event) {
  if (event.key === 'Escape') {
    state.settingBloomAnchor=null;
    stopInkEffect();
    endTransform();
    void exitPresentation();
    return;
  }
  if (!document.querySelector('#layer-menu').hidden) return;
  if (event.target.matches('input, select, textarea')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAllAssets(); return; }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const tool = { g: 'move', r: 'rotate', s: 'scale' }[event.key.toLowerCase()];
  if (tool) { event.preventDefault(); setTool(tool); }
  if (!state.cameraMode && ['+', '=', '-'].includes(event.key)) {
    event.preventDefault();
    const asset = selectedAsset();
    if (asset && asset.visible && !asset.locked) {
      asset.scale = clamp(asset.scale * (event.key === '-' ? 1 / 1.1 : 1.1), 0.1, 5);
      syncAsset(asset);
    }
  }
  if (event.key === 'Delete' || event.key === 'Backspace') removeAsset(state.selectedId);
}

function applyInspector(input) {
  const asset = selectedAsset();
  if (!asset || asset.locked) return;
  const path = input.dataset.bind.split('.');
  const value = Number(input.value);
  if (!Number.isFinite(value) || input.value === '') return;
  if (path.length === 2) asset[path[0]][path[1]] = value;
  else asset[path[0]] = value;
  syncAsset(asset);
}

function syncAsset(asset) {
  state.renderer?.applyTransform(asset.id, asset);
  applyEffectAppearance(inkPulse(), asset);
  renderInspector(asset);
  renderMaterialList();
  renderGizmo(asset);
}

function render() {
  const asset = selectedAsset();
  ui.materialCount.textContent = state.assets.length;
  ui.sceneSummary.textContent = state.assets.length ? `场景中有 ${state.assets.length} 件素材` : '未放置素材';
  ui.emptyState.classList.toggle('is-hidden', state.assets.length > 0);
  renderMaterialList();
  renderInspector(asset);
  renderGizmo(asset);
}

function renderGizmo(asset) {
  const labels = { move: '移动', rotate: '旋转', scale: '缩放' };
  ui.transformHint.textContent = state.cameraMode
    ? '整体视角模式 · 拖动／滚轮调整相机；选中素材可返回单幅编辑'
    : asset ? `仅编辑「${asset.name}」· ${labels[state.activeTool]} · 左侧列表切换作品 · 相机已锁定`
      : '分层水墨 v9 · 请先在左侧选择作品 · 相机已锁定';
  const projected = asset && state.renderer?.project(asset.position);
  ui.gizmo.hidden = state.cameraMode || !asset || !asset.visible || asset.locked || !projected?.visible;
  if (ui.gizmo.hidden) return;
  const { x, y } = projected;
  ui.gizmo.style.left = `${x}%`;
  ui.gizmo.style.top = `${y}%`;
  ui.gizmo.style.transform = state.activeTool === 'rotate' ? 'rotate(-25deg)' : state.activeTool === 'scale' ? 'scale(1.18)' : 'none';
}

function applyPaperPreset() {
  const papers = {
    rice: { className: 'paper-rice', color: '#e8e2d7' },
    warm: { className: 'paper-warm', color: '#d9bd95' },
    mist: { className: 'paper-mist', color: '#bdc9c2' },
    night: { className: 'paper-night', color: '#121817' },
  };
  const paper = papers[ui.paperPreset.value];
  ui.viewport.classList.remove('paper-rice', 'paper-warm', 'paper-mist', 'paper-night');
  ui.viewport.classList.add(paper.className);
  ui.background.value = paper.color;
  state.renderer?.setBackground(paper.color);
}

function renderEffectLabels() {
  ui.dissolveStrengthValue.value = `${Math.round(state.effect.strength * 100)}%`;
  ui.dissolveSpeedValue.value = `${state.effect.speed.toFixed(1)}×`;
  ui.dissolveDensityValue.value = `${Math.round(state.effect.density * 100)}%`;
}

function inkPulse(time = performance.now()) {
  if (!state.effect.enabled) return 0;
  const elapsed = Math.max(0, time - state.effect.startedAt);
  if (state.effect.mode === 'reveal') {
    const progress = clamp(elapsed / (3200 / state.effect.speed), 0, 1);
    return 1 - progress * progress * (3 - 2 * progress);
  }
  return (1 - Math.cos(elapsed * 0.00125 * state.effect.speed)) / 2;
}

function applyEffectAppearance(pulse, onlyAsset = null) {
  for (const asset of onlyAsset ? [onlyAsset] : state.assets) {
    const targeted = state.effect.enabled && !asset.locked && state.effect.targetIds.has(asset.id);
    const dissolve = targeted ? pulse : 0;
    const strength = state.effect.mode === 'reveal' ? 1 : state.effect.strength;
    state.renderer?.setAppearance(asset.id, {
      opacity: asset.visible ? clamp(asset.opacity * (1 - strength * dissolve), 0, 1) : 0,
      density: clamp(asset.density * (1 - state.effect.density * dissolve), 0.08, 1),
      softness: asset.softness,
      saturation: asset.saturation,
    });
  }
}

function updateInkEffect(time = performance.now()) {
  state.effect.frame = null;
  if (!state.effect.enabled) {
    applyEffectAppearance(0);
    return;
  }
  if (state.effect.mode === 'reveal' && time - state.effect.startedAt >= 3200 / state.effect.speed) { stopInkEffect(); return; }
  applyEffectAppearance(inkPulse(time));
  state.effect.frame = requestAnimationFrame(updateInkEffect);
}

function startInkEffect(mode) {
  stopInkEffect();
  const targets = state.assets.filter(asset => state.selectedIds.has(asset.id) && asset.visible && !asset.locked);
  if (!targets.length) { ui.dissolveEnabled.checked = false; return toast('请选中至少一个可见且未锁定的图层。', true); }
  state.effect.enabled = true;
  state.effect.targetIds = new Set(targets.map(asset => asset.id));
  state.effect.mode = mode;
  state.effect.startedAt = performance.now();
  ui.dissolveEnabled.checked = true;
  if (document.querySelector('#reveal-sync-rotate').checked) {
    state.effect.rotationBefore = { enabled:state.autoRotate, cameraMode:state.cameraMode };
    setCameraMode(true);
    state.autoRotate = true;
    ui.autoRotate.checked = true;
    state.renderer?.setAutoRotate(true, state.rotateSpeed);
  }
  updateInkEffect();
  renderSelectionSummary();
}

function stopInkEffect() {
  cancelAnimationFrame(state.effect.frame);
  state.effect.frame = null;
  state.effect.enabled = false;
  ui.dissolveEnabled.checked = false;
  applyEffectAppearance(0);
  const previous = state.effect.rotationBefore;
  state.effect.rotationBefore = null;
  if (previous) {
    setCameraMode(previous.cameraMode);
    state.autoRotate = previous.enabled;
    ui.autoRotate.checked = previous.enabled;
    state.renderer?.setAutoRotate(previous.enabled, state.rotateSpeed);
  }
  renderSelectionSummary();
}

function playReveal() {
  startInkEffect('reveal');
  if (state.effect.enabled) toast(`正在同步显现 ${state.effect.targetIds.size} 幅作品。`);
}

function renderMaterialList() {
  renderSelectionSummary();
  ui.materialList.replaceChildren();
  state.assets.forEach((asset) => {
    const item = ui.materialTemplate.content.firstElementChild.cloneNode(true);
    item.classList.toggle('is-selected', state.selectedIds.has(asset.id));
    item.classList.toggle('is-active-layer', asset.id === state.selectedId);
    item.dataset.assetId = asset.id;
    item.classList.toggle('is-hidden', !asset.visible);
    item.classList.toggle('is-locked', asset.locked);
    item.querySelector('strong').textContent = asset.name;
    item.querySelector('small').textContent = `${asset.kind} · 比例 ${asset.scale.toFixed(2)}`;
    item.querySelector('.material-select').addEventListener('click', event => selectAsset(asset.id, event.ctrlKey || event.metaKey));
    item.querySelector('.material-remove').addEventListener('click', () => removeAsset(asset.id));
    const visibility = item.querySelector('.material-visibility');
    visibility.textContent = asset.visible ? '◉' : '○';
    visibility.title = asset.visible ? '隐藏素材' : '显示素材';
    visibility.addEventListener('click', () => {
      asset.visible = !asset.visible;
      applyEffectAppearance(inkPulse());
      renderMaterialList();
      renderGizmo(selectedAsset());
      toast(asset.visible ? '素材已显示。' : '素材已隐藏。');
    });
    const lock = item.querySelector('.material-lock');
    lock.textContent = asset.locked ? '▣' : '⌑';
    lock.title = asset.locked ? '解锁素材' : '锁定素材';
    lock.addEventListener('click', () => {
      asset.locked = !asset.locked;
      endTransform();
      render();
      toast(asset.locked ? '素材已锁定。' : '素材已解锁。');
    });
    ui.materialList.append(item);
  });
}

function renderInspector(asset) {
  ui.emptyInspector.hidden = Boolean(asset);
  ui.inspector.hidden = !asset;
  if (!asset) return;
  ui.selectedName.value = asset.name;
  ui.inspector.querySelectorAll('[data-bind], [data-ink-preset], #reset-selected, #flip-facing, #mirror-selected').forEach((input) => { input.disabled = asset.locked; });
  document.querySelectorAll('[data-bind]').forEach((input) => {
    const path = input.dataset.bind.split('.');
    const value = path.length === 2 ? asset[path[0]][path[1]] : asset[path[0]];
    input.value = Number(value).toFixed(path[0] === 'rotation' ? 0 : 2);
  });
  document.querySelector('#scale-range').value = asset.scale;
  document.querySelector('#scale-number').value = asset.scale.toFixed(2);
  document.querySelector('#opacity-range').value = asset.opacity;
  document.querySelector('#density-range').value = asset.density;
  document.querySelector('#opacity-value').value = `${Math.round(asset.opacity * 100)}%`;
  document.querySelector('#density-value').value = `${Math.round(asset.density * 100)}%`;
  document.querySelector('#softness-value').value = `${asset.softness.toFixed(2)}×`;
  document.querySelector('#saturation-value').value = `${Math.round(asset.saturation * 100)}%`;
}

function toggleGrid() {
  state.gridVisible = !state.gridVisible;
  ui.viewport.classList.toggle('no-grid', !state.gridVisible);
  document.querySelector('#toggle-grid').classList.toggle('is-active', state.gridVisible);
  ui.viewport.style.backgroundImage = state.gridVisible
    ? 'radial-gradient(rgba(53, 58, 47, .08) .65px, transparent .65px), linear-gradient(135deg, rgba(251,249,241,.38), rgba(210,201,183,.18))'
    : 'linear-gradient(135deg, rgba(251,249,241,.38), rgba(210,201,183,.18))';
}

function toggleUi() {
  setUiHidden(!document.querySelector('.app-shell').classList.contains('ui-hidden'));
}

function setUiHidden(hidden) {
  endTransform();
  document.querySelector('.app-shell').classList.toggle('ui-hidden', hidden);
  document.querySelector('#hide-ui').textContent = hidden ? '显示界面' : '隐藏界面';
  document.querySelector('#hide-ui').setAttribute('aria-pressed', String(hidden));
  syncPresentationControls();
}

function syncPresentationControls() {
  const fullscreen = Boolean(document.fullscreenElement);
  const hidden = document.querySelector('.app-shell').classList.contains('ui-hidden');
  document.querySelector('#presentation-controls').hidden = !fullscreen && !hidden;
  document.querySelector('#fullscreen').textContent = fullscreen ? '退出全屏' : '全屏';
  document.querySelector('#fullscreen').setAttribute('aria-pressed', String(fullscreen));
  document.querySelector('#exit-presentation').textContent = fullscreen ? '退出全屏 · 返回编辑（Esc）' : '显示界面 · 返回编辑（Esc）';
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => renderGizmo(selectedAsset()));
  });
}

async function exitPresentation() {
  setUiHidden(false);
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); }
    catch (error) { toast('暂时无法退出全屏，请按 Esc；也可再次点击返回编辑。', true); }
  }
  ui.viewport.focus({ preventScroll: true });
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ui.viewport.requestFullscreen();
    syncPresentationControls();
  } catch (error) {
    toast('浏览器未允许进入全屏。', true);
    console.warn(error);
  }
}

async function exportPng() {
  if (!state.assets.length) return toast('请先放置至少一个素材。', true);
  const [width, height] = ui.exportSize.value.split('x').map(Number);
  try {
    setStatus('正在生成 PNG…');
    const blob = await state.renderer.exportPng(width, height, state.gestures?.drawingOverlays()??[]);
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: `ink-splat-${Date.now()}.png` });
    link.click();
    URL.revokeObjectURL(url);
    setStatus('渲染器已就绪');
    toast(`已导出 ${width} × ${height} PNG。`);
  } catch (error) {
    setStatus('导出失败', true);
    toast('PNG 导出失败，请确认渲染器已完成加载。', true);
    console.error(error);
  }
}

function setStatus(text, error = false) {
  ui.status.textContent = text;
  ui.status.classList.toggle('is-loading', error || /准备|载入|生成/.test(text));
}

function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = `toast${isError ? ' error' : ''}`;
  element.textContent = message;
  ui.toastRegion.append(element);
  setTimeout(() => element.remove(), 3600);
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

initialize();
