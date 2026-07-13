/**
 * main.js - メインキャンバス・パノラマ・3D空間制御
 */

const NODES = mapGraph.nodes;

/* ---- 短縮ヘルパー関数 ---- */
function $(id) { return document.getElementById(id); }
function setLoadBar(p){ const bar = $('load-bar'); if(bar) bar.style.width = p+'%'; }

/* ---- Main Three.js ---- */
const canvas   = document.getElementById('sv-canvas');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));

function updateRendererSize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  renderer.setSize(width, height, false);
  
  if (typeof camera !== 'undefined' && camera) {
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 600);

updateRendererSize();

let gridEdgesA, gridPointsA;
let gridEdgesB, gridPointsB;

const routeLinesGroup = new THREE.Group();
scene.add(routeLinesGroup);

function makeSphere(radius, isB = false){
  const g = new THREE.SphereGeometry(radius, 60, 60);
  g.scale(-1,1,1);
  
  const m = new THREE.MeshBasicMaterial({
    transparent: true, 
    opacity: isB ? 0 : 1,
    depthTest: true,
    depthWrite: true
  });
  const s = new THREE.Mesh(g, m);
  
  s.renderOrder = isB ? 2 : 1;
  scene.add(s);

  const edgeGeo = new THREE.EdgesGeometry(g);
  const edgeMat = new THREE.LineBasicMaterial({
    color: isB ? 0xa78bfa : 0x5a7fff,
    transparent: true,
    opacity: isB ? 0 : 0.15,
    depthTest: false,
    depthWrite: false
  });
  const lines = new THREE.LineSegments(edgeGeo, edgeMat);
  lines.renderOrder = 3;
  s.add(lines);

  const pointMat = new THREE.PointsMaterial({
    color: isB ? 0xc084fc : 0x93c5fd,
    size: 0.15,
    transparent: true,
    opacity: isB ? 0 : 0.25,
    depthTest: false,
    depthWrite: false
  });
  const points = new THREE.Points(g, pointMat);
  points.renderOrder = 4;
  s.add(points);

  if(!isB) {
    gridEdgesA = lines; gridPointsA = points;
  } else {
    gridEdgesB = lines; gridPointsB = points;
  }

  return s;
}

const sphereA = makeSphere(50, false);
const sphereB = makeSphere(50, true);

const tLoader   = new THREE.TextureLoader();
const raycaster = new THREE.Raycaster();
const mouse2    = new THREE.Vector2();

/* ---- ORBITAL DEBUG MONITOR ---- */
const debugCanvas = document.getElementById('debug-canvas');
const debugRenderer = new THREE.WebGLRenderer({canvas: debugCanvas, antialias: true});
debugRenderer.setSize(220 * 2, 135 * 2); 

const debugOrtho = new THREE.OrthographicCamera(-400, 400, 300, -300, 1, 2000);
const debugPersp = new THREE.PerspectiveCamera(75, (220 * 2)/ (135 *2), 1, 2000);
let activeDebugCamera = debugOrtho;
let isOrtho = true;

const cameraHelper = new THREE.CameraHelper(camera);
cameraHelper.renderOrder = 999;
cameraHelper.material.depthTest = false;
cameraHelper.material.depthWrite = false;
scene.add(cameraHelper);

/* ---- state ---- */
let currentId   = '13_corridor_0010,0020';
let nextId      = null;
let yaw=0, pitch=0, tYaw=0, tPitch=0;
let fov=75, tFov=75;
let isDragging  = false;
let autoRotate  = false;

let walkPhase   = 'idle';
let walkT       = 0;
const WALK_DUR  = 1.1;

let lastTS      = 0;

/* ---- UI Visibility Config ---- */
const uiConfig = {
  edges: true,
  points: true,
  routes: true,
  textSizeMode: 'constant' 
};

/* ---- 進路パス・先端テキスト・ピンの生成関数 ---- */
function buildRouteLines(node) {
  // nodeが不正な場合は中断（データ読み込み待ち対応）
  if (!node || !node.links) return;

  while(routeLinesGroup.children.length) {
    const child = routeLinesGroup.children[0];
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
    routeLinesGroup.remove(child);
  }
  
  if(!uiConfig.routes) return;

  const yOffset = -3.8; 

  node.links.forEach(lk => {
    if (!lk.pos) return;

    const targetX = lk.pos[0] / 4;
    const targetY = lk.pos[1] / 4;
    const targetZ = lk.pos[2] / 4;

    const startPoint = new THREE.Vector3(0, yOffset, 0);
    const endPoint = new THREE.Vector3(targetX, yOffset, targetZ); 

    const distance = startPoint.distanceTo(endPoint);
    const direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();

    const geo = new THREE.PlaneGeometry(0.8, distance);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5a7fff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(startPoint).add(direction.clone().multiplyScalar(distance / 2));
    mesh.lookAt(endPoint);
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = 20;

    mesh.userData = { isRoute: true, link: lk, isLine: true };
    routeLinesGroup.add(mesh);

    const canvas = document.createElement('canvas');
    canvas.width = 512;  
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    
    ctx.font = 'Bold 54px sans-serif';
    ctx.fillStyle = '#55ff7f'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const textTarget = lk.label || lk.hint || lk.targetId || "NEXT";
    ctx.fillText(textTarget, 256, 64);

    const txtTex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: txtTex,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    
    spriteMat.center = new THREE.Vector2(0.5, 0.0);

    const textSprite = new THREE.Sprite(spriteMat);
    textSprite.position.set(targetX, yOffset + 1.0, targetZ);
    textSprite.renderOrder = 22;
    textSprite.scale.set(4, 1, 1);
    
    textSprite.userData = { isRoute: true, link: lk, isText: true, targetX: targetX, targetZ: targetZ };
    routeLinesGroup.add(textSprite);

    const shape = new THREE.Shape();
    shape.moveTo(-0.2, 0.3);
    shape.lineTo(0.1, 0.3);
    shape.lineTo(0, 0);
    shape.lineTo(-0.1, 0.3);

    const pinGeo = new THREE.ShapeGeometry(shape);
    const pinMat = new THREE.MeshBasicMaterial({
      color: 0x55ff7f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false
    });
    const pinMesh = new THREE.Mesh(pinGeo, pinMat);
    
    pinMesh.position.set(targetX, yOffset + 1.0, targetZ);
    pinMesh.renderOrder = 22; 
    
    pinMesh.userData = { isRoute: true, link: lk, isPin: true };
    routeLinesGroup.add(pinMesh);
  });
}

/* ---- walk-through transition ---- */
let walkDir = new THREE.Vector3(0,0,-1);

function startWalk(targetNodeId, hotspotPos){
  if(walkPhase !== 'idle') return;

  if (typeof mmSrcNode !== 'undefined') {
    mmSrcNode = NODES[currentId];
  }

  nextId    = targetNodeId;
  walkPhase = 'walk';
  walkT     = 0;

  walkDir = new THREE.Vector3(...hotspotPos).normalize();
  const speedHud = $('hud-speed');
  if(speedHud) speedHud.style.opacity='1';

  setLoadBar(30);
  const node=NODES[targetNodeId];
  tLoader.load(node.asset.url, tex=>{
    tex.wrapS=THREE.RepeatWrapping; tex.wrapT=THREE.RepeatWrapping;
    tex.minFilter=THREE.LinearMipMapLinearFilter; tex.generateMipmaps=true;
    tex.offset.x = 0.5; 

    sphereB.material.map=tex; sphereB.material.needsUpdate=true;
    setLoadBar(80);
  });
}

function finishWalk(){
  walkPhase='settle';
  const node=NODES[nextId];

  sphereA.material.map=sphereB.material.map;
  sphereA.material.needsUpdate=true;
  sphereA.material.opacity=1;
  sphereB.material.opacity=0;

  gridEdgesA.material.opacity = uiConfig.edges ? 0.15 : 0;
  gridPointsA.material.opacity = uiConfig.points ? 0.25 : 0;
  gridEdgesB.material.opacity = 0;
  gridPointsB.material.opacity = 0;

  camera.position.set(0,0,0);
  
  sphereA.matrixAutoUpdate = true;
  sphereB.matrixAutoUpdate = true;
  sphereA.scale.set(1, 1, 1);
  sphereB.scale.set(1, 1, 1);
  sphereA.quaternion.set(0,0,0,1);
  sphereB.quaternion.set(0,0,0,1);

  routeLinesGroup.matrixAutoUpdate = true;
  routeLinesGroup.position.set(0,0,0);
  routeLinesGroup.scale.set(1,1,1);

  sphereA.renderOrder = 1;
  sphereB.renderOrder = 2;

  buildRouteLines(node);

  currentId=nextId; nextId=null;
  $('loc-name').textContent=node.name;
  $('loc-sub').textContent=node.sub;
  
  if (typeof mmSrcNode !== 'undefined') mmSrcNode = null;

  if (typeof updateMinimap === 'function') updateMinimap();
  if (typeof focusCurrentNodeOnMinimap === 'function') focusCurrentNodeOnMinimap();

  yaw = tYaw; pitch = tPitch;

  setLoadBar(100); setTimeout(()=>setLoadBar(0),400);
  const speedHud = $('hud-speed');
  if(speedHud) speedHud.style.opacity='0';

  setTimeout(()=>{ walkPhase='idle'; },200);
}

function loadInitial(nodeId){
  const node=NODES[nodeId];
  $('loc-name').textContent=node.name;
  $('loc-sub').textContent=node.sub;
  currentId=nodeId;
  
  if (typeof updateMinimap === 'function') updateMinimap();
  if (typeof focusCurrentNodeOnMinimap === 'function') focusCurrentNodeOnMinimap();
  
  setLoadBar(20);
  tLoader.load(node.asset.url, tex=>{
    tex.wrapS=THREE.RepeatWrapping; tex.wrapT=THREE.RepeatWrapping;
    tex.minFilter=THREE.LinearMipMapLinearFilter; tex.generateMipmaps=true;
    tex.offset.x = 0.5; 

    sphereA.material.map=tex; sphereA.material.needsUpdate=true;
    tYaw=node.initYaw; tPitch=0; yaw=node.initYaw; pitch=0;
    buildRouteLines(node);
    setLoadBar(100); setTimeout(()=>setLoadBar(0),400);
  });
  sphereB.position.set(0,0,-100);
}

function updateCamera(){
  const x=Math.cos(pitch)*Math.sin(yaw);
  const y=Math.sin(pitch);
  const z=-Math.cos(pitch)*Math.cos(yaw);
  camera.lookAt(camera.position.x+x, camera.position.y+y, camera.position.z+z);
}

function updateCompass(angle){
  const deg=-angle*180/Math.PI;
  $('compass-needle').setAttribute('transform',`rotate(${deg},36,36)`);
}

/* ---- events (モバイル・マルチデバイス対応版) ---- */
let lastX=0, lastY=0;

canvas.addEventListener('touchstart', e => {
  if (e.touches.length > 1) return; 
  if (walkPhase !== 'idle') return;

  isDragging = false; 
  lastX = e.touches[0].clientX; 
  lastY = e.touches[0].clientY;
}, { passive: true });

canvas.addEventListener('touchmove', e => {
  if (e.touches.length > 1) return;
  if (walkPhase !== 'idle') return;

  const dx = e.touches[0].clientX - lastX;
  const dy = e.touches[0].clientY - lastY;

  if (Math.abs(dx) + Math.abs(dy) > 2) isDragging = true;

  tYaw   -= dx * 0.004;
  tPitch += dy * 0.004;
  tPitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, tPitch));

  lastX = e.touches[0].clientX;
  lastY = e.touches[0].clientY;
}, { passive: true });

canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') return; 
  if (walkPhase !== 'idle') return;
  isDragging = false; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return; 
  if (walkPhase !== 'idle') { canvas.style.cursor = 'default'; return; }
  if (e.buttons === 0) {
    let canvasBounds = renderer.domElement.getBoundingClientRect();
    mouse2.x = ((e.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
    mouse2.y = -((e.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;
    raycaster.setFromCamera(mouse2, camera);

    const hits = raycaster.intersectObjects(routeLinesGroup.children);
    const tip = $('tooltip');
    
    const hitObj = hits.length ? hits[0].object : null;
    if (hitObj && hitObj.userData && hitObj.userData.isRoute && (hitObj.userData.isText || hitObj.userData.isPin)) {
      const lk = hitObj.userData.link;
      canvas.style.cursor = 'pointer';
      tip.textContent = lk.hint || lk.label || "移動する";
      tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
      tip.style.opacity = '1';
    } else {
      canvas.style.cursor = 'grab'; tip.style.opacity = '0';
    }
    return;
  }
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 3) isDragging = true;
  tYaw   -= dx * 0.0038;
  tPitch += dy * 0.0038;
  tPitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, tPitch));
  lastX = e.clientX; lastY = e.clientY;
});

canvas.addEventListener('pointerup',e=>{
  if (e.pointerType === 'touch') return;
  if (walkPhase !== 'idle' || isDragging) return;
});

canvas.addEventListener('dblclick', e => {
  if (walkPhase !== 'idle') return;

  let canvasBounds = renderer.domElement.getBoundingClientRect();
  mouse2.x = ((e.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
  mouse2.y = -((e.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;
  
  raycaster.setFromCamera(mouse2, camera);
  const hits = raycaster.intersectObjects(routeLinesGroup.children);
  
  if (hits.length) {
    const hitObj = hits[0].object;
    if (hitObj.userData && hitObj.userData.isRoute && hitObj.userData.link) {
      if (hitObj.userData.isText || hitObj.userData.isPin) {
        const lk = hitObj.userData.link;
        const targetPos = lk.pos ? [lk.pos[0] / 4, -3.8 + 1.0, lk.pos[2] / 4] : [0, 0, 0];
        startWalk(lk.targetId, targetPos);
      }
    }
  }
});

canvas.addEventListener('wheel',e=>{
  if(walkPhase!=='idle') return;
  e.preventDefault();
  tFov=Math.max(30,Math.min(110,tFov+e.deltaY*0.05));
},{passive:false});

let lastPinch=0;
canvas.addEventListener('touchstart',e=>{ if(e.touches.length===2) lastPinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); });
canvas.addEventListener('touchmove',e=>{ if(e.touches.length===2){ const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); tFov=Math.max(30,Math.min(110,tFov-(d-lastPinch)*0.3)); lastPinch=d; } },{passive:true});

window.addEventListener('resize', updateRendererSize);

/* ---- Helpers ---- */
function setupToggle(id, targetEl, callback) {
  const el = $(id);
  if (!el) return;

  const isChecked = el.checked;
  if (targetEl) {
    targetEl.style.display = isChecked ? '' : 'none';
    targetEl.style.opacity = isChecked ? '1' : '0';
  }
  if (callback) {
    callback(isChecked);
  }

  el.addEventListener('change', e => {
    const visible = e.target.checked;
    if (targetEl) {
      targetEl.style.display = visible ? '' : 'none';
      targetEl.style.opacity = visible ? '1' : '0';
    }
    if (callback) callback(visible);
  });
}

function onWorkspaceClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(routeLinesGroup.children);

  if (intersects.length > 0) {
    const hitObj = intersects[0].object;

    if (hitObj.userData && hitObj.userData.isRoute && hitObj.userData.link) {
      const targetLink = hitObj.userData.link;

      const targetX = targetLink.pos[0] / 4;
      const targetZ = targetLink.pos[2] / 4;
      
      tYaw = Math.atan2(targetX, -targetZ); 
      tPitch = 0;

      console.log("ルートクリックによるカメラ旋回＆移動開始:", targetLink);
      return;
    }
  }
}

renderer.domElement.addEventListener('click', onWorkspaceClick);

/* ---- animation loop ---- */
function animate(now){
  requestAnimationFrame(animate);
  const dt=Math.min((now-lastTS)/1000,0.1);
  lastTS=now;

  if(walkPhase=='walk'){
    walkT=Math.min(walkT+dt/WALK_DUR,1);

    routeLinesGroup.children.forEach(l => {
      if (l.material) {
        if (Array.isArray(l.material)) l.material.forEach(m => m.opacity = 0);
        else l.material.opacity = 0;
      }
    });

    yaw = tYaw;
    pitch = tPitch;

    camera.position.set(0, 0, 0);

    const s = 1.0 - 0.85 * walkT; 

    sphereA.matrixAutoUpdate = false;
    const n = walkDir;
    const m = new THREE.Matrix4().set(
      1 + (s - 1) * n.x * n.x,     (s - 1) * n.x * n.y,     (s - 1) * n.x * n.z, 0,
          (s - 1) * n.y * n.x, 1 + (s - 1) * n.y * n.y,     (s - 1) * n.y * n.z, 0,
          (s - 1) * n.z * n.x,     (s - 1) * n.z * n.y, 1 + (s - 1) * n.z * n.z, 0,
                                0,                       0,                       0, 1
    );

    const flipMatrix = new THREE.Matrix4().makeScale(1, 1, 1);
    sphereA.matrix.copy(m).multiply(flipMatrix);

    sphereB.matrixAutoUpdate = false;
    sphereB.matrix.copy(flipMatrix);

    routeLinesGroup.matrixAutoUpdate = true;
    routeLinesGroup.scale.set(1, 1, 1); 

    if (walkT < 0.9) {
      sphereA.material.opacity = 1.0;
      sphereB.material.opacity = 0.0;
      
      gridEdgesA.material.opacity = uiConfig.edges ? 0.25 : 0;
      gridPointsA.material.opacity = uiConfig.points ? 0.35 : 0;
      gridEdgesB.material.opacity = 0;
      gridPointsB.material.opacity = 0;
    } else {
      const fadeProgress = (walkT - 0.9) / 0.1; 
      sphereB.material.opacity = fadeProgress;
      sphereA.material.opacity = 1.0 - fadeProgress;

      gridEdgesA.material.opacity = uiConfig.edges ? 0.25 * (1.0 - fadeProgress) : 0;
      gridPointsA.material.opacity = uiConfig.points ? 0.35 * (1.0 - fadeProgress) : 0;
      gridEdgesB.material.opacity = uiConfig.edges ? 0.15 * fadeProgress : 0;
      gridPointsB.material.opacity = uiConfig.points ? 0.25 * fadeProgress : 0;
    }

    camera.fov=fov;
    camera.updateProjectionMatrix();
    updateCamera();
    updateCompass(yaw);

    if (typeof applyMinimapTransform === 'function') {
      applyMinimapTransform();
    }

    if(walkT>=1) finishWalk();
  } else {
    if(autoRotate&&!isDragging) tYaw+=0.06*dt;
    const k=1-Math.pow(0.008,dt*10);
    yaw  +=(tYaw -yaw  )*k;
    pitch+=(tPitch-pitch)*k;
    fov  +=(tFov -fov  )*k;

    camera.fov=fov;
    camera.updateProjectionMatrix();
    updateCamera();
    updateCompass(yaw);

    const fovSlider = $('fov-slider');
    const fovReadout = $('fov-readout');
    if(fovSlider) fovSlider.value=Math.round(fov);
    if(fovReadout) fovReadout.textContent=Math.round(fov)+'°';

    if (gridEdgesA && gridPointsA) {
      gridEdgesA.material.opacity = uiConfig.edges ? 0.15 : 0;
      gridPointsA.material.opacity = uiConfig.points ? 0.25 : 0;
    }

    const yOffset = -3.8;

    routeLinesGroup.children.forEach(l => {
      if (l.userData && l.userData.isRoute) {
        if (l.material) {
          if (l.userData.isLine) l.material.opacity = uiConfig.routes ? 0.4 : 0;
          else if (l.userData.isText || l.userData.isPin) l.material.opacity = uiConfig.routes ? 1.0 : 0;
        }
        
        const distToCamera = camera.position.distanceTo(l.position);
        let scaleFactor = (uiConfig.textSizeMode === 'constant') ? distToCamera * 0.12 : 1.0;

        if (l.userData.isText) {
          l.scale.set(4 * scaleFactor, 1 * scaleFactor, 1);
          l.position.y = (yOffset + 0.5) + (1.0 * scaleFactor) + 0.1;
        }
        
        if (l.userData.isPin) {
          l.scale.set(scaleFactor, scaleFactor, scaleFactor);
          l.quaternion.copy(camera.quaternion);
        }
      }
    });
  }

  if (typeof updateMinimapPulse === 'function') {
    updateMinimapPulse(dt);
  }

  renderer.render(scene, camera);

  sphereA.material.wireframe = true;
  sphereB.material.wireframe = true;
  cameraHelper.update();
  
  debugRenderer.render(scene, activeDebugCamera);
  
  sphereA.material.wireframe = false;
  sphereB.material.wireframe = false;
}

document.addEventListener('DOMContentLoaded', () => {
  updateRendererSize();

  const slider = $('fov-slider');
  if(slider) slider.addEventListener('input', e=>{ tFov=+e.target.value; });
  
  const btnZm = $('btn-zm');
  if(btnZm) btnZm.onclick=()=>{ tFov=Math.max(30,tFov-10); };
  
  const btnZp = $('btn-zp');
  if(btnZp) btnZp.onclick=()=>{ tFov=Math.min(110,tFov+10); };
  
  const btnReset = $('btn-reset');
  if(btnReset) btnReset.onclick=()=>{ const n=NODES[currentId]; tYaw=n.initYaw; tPitch=0; tFov=75; };

  const modal = $('settings-modal');
  const btnSettings = $('btn-settings');
  const btnCloseModal = $('btn-close-modal');
  
  if(btnSettings) btnSettings.onclick = () => modal.classList.add('open');
  if(btnCloseModal) btnCloseModal.onclick = () => modal.classList.remove('open');
  if(modal) modal.onclick = (e) => { if(e.target === modal) modal.classList.remove('open'); };

  setupToggle('tg-hud-loc', $('hud-location'));
  setupToggle('tg-hud-compass', $('hud-compass'));
  setupToggle('tg-hud-map', $('hud-minimap'));
  setupToggle('tg-hud-debug', $('debug-container'));

  setupToggle('tg-grid-edges', null, (visible) => {
    uiConfig.edges = visible;
    if(walkPhase === 'idle' && gridEdgesA) gridEdgesA.material.opacity = visible ? 0.15 : 0;
  });
  setupToggle('tg-grid-points', null, (visible) => {
    uiConfig.points = visible;
    if(walkPhase === 'idle' && gridPointsA) gridPointsA.material.opacity = visible ? 0.25 : 0;
  });
  setupToggle('tg-grid-routes', null, (visible) => {
    uiConfig.routes = visible;
    buildRouteLines(NODES[currentId]);
  });
  
  const textSizeBtn = document.getElementById('btn-text-size-mode');
  if (textSizeBtn) {
    if (uiConfig.textSizeMode === 'distance') {
      textSizeBtn.textContent = 'Distance';
      textSizeBtn.style.color = '#ccc';
    } else {
      textSizeBtn.textContent = 'Constant';
      textSizeBtn.style.color = '#55ff7f';
    }

    textSizeBtn.addEventListener('click', () => {
      if (uiConfig.textSizeMode === 'constant') {
        uiConfig.textSizeMode = 'distance';
        textSizeBtn.textContent = 'Distance';
        textSizeBtn.style.color = '#ccc';
      } else {
        uiConfig.textSizeMode = 'constant';
        textSizeBtn.textContent = 'Constant';
        textSizeBtn.style.color = '#55ff7f';
      }
    });
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === '0') {
    isOrtho = !isOrtho;
    activeDebugCamera = isOrtho ? debugOrtho : debugPersp;
    activeDebugCamera.position.set(0, 120, 0);
    activeDebugCamera.lookAt(0, 0, 0);
  }
  switch(e.key) {
    case '1': activeDebugCamera.position.set(0, 30, 0); activeDebugCamera.lookAt(0, 0, 0); break;
    case '2': activeDebugCamera.position.set(0, 50, 0); activeDebugCamera.lookAt(0, 0, 0); break;
    case '3': activeDebugCamera.position.set(50, 10, 0); activeDebugCamera.lookAt(0, 0, 0); break;
  }
  activeDebugCamera.updateProjectionMatrix();
});

debugCanvas.addEventListener('wheel', (e) => {
  e.stopPropagation(); e.preventDefault();
  if (isOrtho) {
    activeDebugCamera.zoom -= e.deltaY * 0.001;
    activeDebugCamera.zoom = Math.max(0.1, Math.min(activeDebugCamera.zoom, 10));
  } else {
    activeDebugCamera.position.z -= e.deltaY * 0.1;
  }
  activeDebugCamera.updateProjectionMatrix();
}, { passive: false });

async function initMapData() {
  const files = [
    'north_1.json', 'north_2.json', 'north_3.json', 'north_4.json',
    'main_1.json', 'main_2.json', 'main_3.json', 'main_4.json',
    'south_1.json', 'south_2.json', 'south_3.json', 'south_4.json'
  ];

  const results = await Promise.all(
    files.map(name => fetch(`../data/${name}`).then(res => res.json()))
  );

  mapGraph.loadFromMultipleJSON(results);
}

// 起動時に呼び出す
initMapData().then(() => {
  console.log("マップデータ読み込み完了");
  
  // 初期化処理をここに集約
  loadInitial('13_corridor_0010,0020');
  
  setupToggle('tg-hud-loc', $('hud-location'));
  setupToggle('tg-hud-compass', $('hud-compass'));
  setupToggle('tg-hud-map', $('hud-minimap'));
  setupToggle('tg-hud-debug', $('debug-container'));

  setupToggle('tg-grid-edges', null, (visible) => {
    uiConfig.edges = visible;
    if(walkPhase === 'idle' && gridEdgesA) gridEdgesA.material.opacity = visible ? 0.15 : 0;
  });
  setupToggle('tg-grid-points', null, (visible) => {
    uiConfig.points = visible;
    if(walkPhase === 'idle' && gridPointsA) gridPointsA.material.opacity = visible ? 0.25 : 0;
  });
  setupToggle('tg-grid-routes', null, (visible) => {
    uiConfig.routes = visible;
    buildRouteLines(NODES[currentId]);
  });

  requestAnimationFrame(animate);
});

// main.js の初期化処理
document.addEventListener('DOMContentLoaded', async () => {
    // 1. まずデータをロードする（完了するまで待機）
    await initMapData(); // ※先ほど定義したPromiseを返す関数
    
    // 2. データがロードされたことが確定してから UI を生成
    initMinimapLayout();
    
    // 3. 必要な初期化を実行
    loadInitial('13_corridor_0010,0020');
    requestAnimationFrame(animate);
});