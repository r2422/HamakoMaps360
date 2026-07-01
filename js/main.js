const NODES = mapGraph.nodes;

/* ---- Main Three.js ---- */
const canvas   = document.getElementById('sv-canvas');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 600);

let gridEdgesA, gridPointsA;
let gridEdgesB, gridPointsB;

const routeLinesGroup = new THREE.Group();
scene.add(routeLinesGroup);

function makeSphere(radius, isB = false){
  const g = new THREE.SphereGeometry(radius, 40, 20);
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

const hotspotGroup = new THREE.Group();
hotspotGroup.renderOrder = 10;
scene.add(hotspotGroup);

const tLoader   = new THREE.TextureLoader();
const raycaster = new THREE.Raycaster();
const mouse2    = new THREE.Vector2();

/* ---- ORBITAL DEBUG MONITOR (上空から天球を見下ろすカメラ) ---- */
const debugCanvas = document.getElementById('debug-canvas');
const debugRenderer = new THREE.WebGLRenderer({canvas: debugCanvas, antialias: true});
debugRenderer.setSize(220, 135); 

const debugCamera = new THREE.OrthographicCamera(-70, 70, 44, -44, 1, 1000);
debugCamera.position.set(0, 120, 0);
debugCamera.lookAt(0, 0, 0);

const cameraHelper = new THREE.CameraHelper(camera);
cameraHelper.renderOrder = 999;
cameraHelper.material.depthTest = false;
cameraHelper.material.depthWrite = false;
scene.add(cameraHelper);

/* ---- state ---- */
let currentId   = '13_corridor_0000,0020';
let nextId      = null;
let yaw=0, pitch=0, tYaw=0, tPitch=0;
let fov=75, tFov=75;
let isDragging  = false;
let autoRotate  = false;

let walkPhase   = 'idle';
let walkT       = 0;
const WALK_DUR  = 1.1;

let lastTS      = 0;
let hotspotTime = 0;
let mmPulseT    = 0;

/* --- ミニマップ操作用の内部変数（巨大地図対応） --- */
let mmPanX = 0;      
let mmPanY = 0;      
let mmScale = 0.12; // 5640x4320の全体像が収まりやすい初期縮尺
let isMMDragging = false;
let mmStartX = 0;
let mmStartY = 0;
let lastFloorNumber = null;

/* ---- UI Visibility Config ---- */
const uiConfig = {
  edges: true,
  points: true,
  routes: true,
  textSizeMode: 'constant' // 💡 追加：'constant'（一定）または 'distance'（距離依存）
};

/* ---- 短縮ヘルパー関数 ---- */
const $ = id => document.getElementById(id);
function setLoadBar(p){ $('load-bar').style.width = p+'%'; }

/* ---- 進路パス(ストリートビュー風)・先端テキスト・ピンの生成関数 ---- */
function buildRouteLines(node) {
  // 古いオブジェクトをクリア
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

  const yOffset = -3.8; // 床面の高さ

  node.links.forEach(lk => {
    if (!lk.pos) return;

    // 地図座標（1m = 4px）から実寸メートル換算（4で割る）
    const targetX = lk.pos[0] / 4;
    const targetY = lk.pos[1] / 4;
    const targetZ = lk.pos[2] / 4;

    const startPoint = new THREE.Vector3(0, yOffset, 0);
    const endPoint = new THREE.Vector3(targetX, yOffset, targetZ); 

    const distance = startPoint.distanceTo(endPoint);
    const direction = new THREE.Vector3().subVectors(endPoint, startPoint).normalize();

    // ----------------------------------------------------
    // A. 太い進路パス（道路の青い帯）
    // ----------------------------------------------------
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

    mesh.userData = { isRoute: true, link: lk };
    routeLinesGroup.add(mesh);

    // ----------------------------------------------------
    // B. 先端の移動先テキスト（Canvasスプライト）
    // ----------------------------------------------------
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
    
    // アンカーポイントを下端中央に設定
    spriteMat.center = new THREE.Vector2(0.5, 0.0);

    const textSprite = new THREE.Sprite(spriteMat);
    
    // ベースの位置を設定（高さはanimate内でサイズに応じてリアルタイムに上書きされます）
    textSprite.position.set(targetX, yOffset + 1.0, targetZ);
    textSprite.renderOrder = 22;
    textSprite.scale.set(4, 1, 1);
    
    textSprite.userData = { isRoute: true, link: lk, isText: true, targetX: targetX, targetZ: targetZ };
    routeLinesGroup.add(textSprite);

    // ----------------------------------------------------
    // C. 先端の下向き三角形ピン（ご提示の仕様通りに完全復元）
    // ----------------------------------------------------
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

/* ---- hotspot sprite ---- */
function makeHotspotCanvas(label, t){
  const cv=document.createElement('canvas'); cv.width=320; cv.height=320;
  const ctx=cv.getContext('2d');
  const cx=160, cy=128;
  const pulse=1+0.055*Math.sin(t*3.4);
  const r=50*pulse;
  ctx.clearRect(0,0,320,320);

  [[r+38,0.09],[r+22,0.16]].forEach(([rr,a])=>{
    const aa = a+0.07*Math.abs(Math.sin(t*1.9));
    ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2);
    ctx.fillStyle=`rgba(80,120,255,${aa})`; ctx.fill();
  });

  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,0.93)'; ctx.fill();
  const sg=ctx.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
  sg.addColorStop(0,'rgba(130,170,255,0.95)'); sg.addColorStop(1,'rgba(50,80,220,0.95)');
  ctx.strokeStyle=sg; ctx.lineWidth=5; ctx.stroke();

  const sh=5*Math.sin(t*4.8);
  ctx.fillStyle='#1a3acc';
  ctx.beginPath();
  ctx.moveTo(cx-14+sh,cy-10); ctx.lineTo(cx+18+sh,cy); ctx.lineTo(cx-14+sh,cy+10);
  ctx.closePath(); ctx.fill();

  ctx.font='bold 18px sans-serif';
  const tw=Math.max(ctx.measureText(label).width+32,80);
  const bx=cx-tw/2, by=cy+70, bh=30;
  ctx.beginPath(); ctx.roundRect(bx,by,tw,bh,15);
  ctx.fillStyle='rgba(6,12,45,0.88)'; ctx.fill();
  ctx.strokeStyle='rgba(90,130,255,0.5)'; ctx.lineWidth=1.5; strokeStyle=sg; ctx.stroke();
  ctx.fillStyle='#ccd8ff'; ctx.textAlign='center';
  ctx.fillText(label,cx,by+21);
  return cv;
}

function createHotspot(lk){
  if (!lk.pos) return;
  const tex=new THREE.CanvasTexture(makeHotspotCanvas(lk.label,0));
  const mat=new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true});
  const sp=new THREE.Sprite(mat);
  sp.scale.set(5,5,1);
  sp.position.set(...lk.pos);
  sp.userData={targetId:lk.targetId,label:lk.label,hint:lk.hint};
  hotspotGroup.add(sp);
}
function animateHotspots(t){
  hotspotGroup.children.forEach((sp,i)=>{
    const cv=makeHotspotCanvas(sp.userData.label,t+i*1.4);
    if(sp.material.map) sp.material.map.dispose();
    sp.material.map=new THREE.CanvasTexture(cv);
    sp.material.needsUpdate=true;
  });
}

/* ---- walk-through transition ---- */
let walkDir = new THREE.Vector3(0,0,-1);

function startWalk(targetNodeId, hotspotPos){
  if(walkPhase !== 'idle') return;
  nextId    = targetNodeId;
  walkPhase = 'walk';
  walkT     = 0;

  walkDir = new THREE.Vector3(...hotspotPos).normalize();
  $('hud-speed').style.opacity='1';

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
  hotspotGroup.position.set(0,0,0);
  
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

  while(hotspotGroup.children.length) hotspotGroup.remove(hotspotGroup.children[0]);
  node.links.forEach(lk=>createHotspot(lk));
  buildRouteLines(node);

  currentId=nextId; nextId=null;
  $('loc-name').textContent=node.name;
  $('loc-sub').textContent=node.sub;
  
  updateMinimap();
  focusCurrentNodeOnMinimap();

  yaw = tYaw; pitch = tPitch;

  setLoadBar(100); setTimeout(()=>setLoadBar(0),400);
  $('hud-speed').style.opacity='0';

  setTimeout(()=>{ walkPhase='idle'; },200);
}

function loadInitial(nodeId){
  const node=NODES[nodeId];
  $('loc-name').textContent=node.name;
  $('loc-sub').textContent=node.sub;
  currentId=nodeId;
  
  updateMinimap();
  focusCurrentNodeOnMinimap();
  
  setLoadBar(20);
  tLoader.load(node.asset.url, tex=>{
    tex.wrapS=THREE.RepeatWrapping; tex.wrapT=THREE.RepeatWrapping;
    tex.minFilter=THREE.LinearMipMapLinearFilter; tex.generateMipmaps=true;
    tex.offset.x = 0.5; 

    sphereA.material.map=tex; sphereA.material.needsUpdate=true;
    tYaw=node.initYaw; tPitch=0; yaw=node.initYaw; pitch=0;
    while(hotspotGroup.children.length) hotspotGroup.remove(hotspotGroup.children[0]);
    node.links.forEach(lk=>createHotspot(lk));
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

/* --- ミニマップ構築（外部背景画像を読み込める構造に最適化） --- */
function initMinimapLayout() {
  const container = $('hud-minimap-container');
  if (!container) return;

  // 動的に巨大背景画像付きのSVGレイアウトをインジェクション
  container.innerHTML = `
    <svg id="hud-minimap-svg" viewBox="0 0 260 160" width="260" height="160" xmlns="http://www.w3.org/2000/svg" style="user-select: none; touch-action: none; border-radius: 12px; display: block;">
      <rect width="260" height="160" fill="rgba(6, 12, 32, 0.75)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>
      
      <g id="mm-transform-group">
        <image id="mm-bg-map" href="" width="5640" height="4320" x="0" y="0" opacity="0.4" pointer-events="none" />
        
        <g id="mm-edges-group"></g>
        <g id="mm-nodes-group"></g>
        
        <circle id="mm-pulse" cx="0" cy="0" r="45" fill="none" stroke="#5a7fff" stroke-width="6" opacity="0.5"/>
        <polygon id="mm-arrow" points="0,-30 -20,25 0,10 20,25" fill="#fff" opacity="0.9"/>
      </g>
      
      <rect id="mm-drag-mask" width="260" height="160" fill="transparent" style="cursor: grab;"/>
      
      <text id="mm-floor-title" x="130" y="22" text-anchor="middle" font-size="9" font-family="'Rajdhani', sans-serif" font-weight="600" letter-spacing="0.15em" fill="rgba(255,255,255,0.45)" pointer-events="none">FLOOR MAP</text>
      
      <g id="mm-btn-rec" style="cursor: pointer;">
        <rect x="214" y="126" width="34" height="22" rx="6" fill="rgba(20, 30, 65, 0.85)" stroke="rgba(90, 130, 255, 0.6)" stroke-width="1"/>
        <circle cx="223" cy="137" r="3.5" fill="#ef4444"/>
        <text x="233" y="140" font-size="8" font-family="'Rajdhani', sans-serif" font-weight="bold" fill="#ccd8ff">REC</text>
      </g>
    </svg>
  `;

  const nodesGroup = $('mm-nodes-group');
  const edgesGroup = $('mm-edges-group');
  
  nodesGroup.innerHTML = ''; 
  edgesGroup.innerHTML = ''; 

  const drawnEdges = new Set(); 

  for (let id in NODES) {
    const node = NODES[id];

    node.links.forEach(lk => {
      const targetNode = NODES[lk.targetId];
      if (targetNode) {
        const edgeKey = [node.id, targetNode.id].sort().join('-');
        if (!drawnEdges.has(edgeKey)) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', node.mmX);
          line.setAttribute('y1', node.mmY);
          line.setAttribute('x2', targetNode.mmX);
          line.setAttribute('y2', targetNode.mmY);
          line.setAttribute('stroke', 'rgba(90, 127, 255, 0.4)');
          line.setAttribute('stroke-width', '4');
          line.setAttribute('stroke-dasharray', '2,2');
          edgesGroup.appendChild(line);
          drawnEdges.add(edgeKey);
        }
      }
    });

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('id', `mm-dot-${node.id}`);
    circle.setAttribute('cx', node.mmX);
    circle.setAttribute('cy', node.mmY);
    circle.setAttribute('r', '14'); 
    circle.setAttribute('fill', 'rgba(30, 45, 90, 0.8)');
    circle.setAttribute('stroke', 'rgba(90, 127, 255, 0.6)');
    circle.setAttribute('stroke-width', '3');
    circle.style.cursor = 'pointer';
    
    // マスクが前面にあるため、ノードをクリックでワープさせたい場合はマスク側の座標検知か、
    // ここでは現在地表示の更新ロジックに集中させます。
    nodesGroup.appendChild(circle);
  }

  // ミニマップ用のイベントをここでバインド
  setupMinimapInteractions();
}

function updateMinimapFloor(floorNumber) {
  if (floorNumber === lastFloorNumber) return;
  lastFloorNumber = floorNumber;
  const bgMap = $('mm-bg-map');
  const floorTitle = $('mm-floor-title');
  if (bgMap) bgMap.setAttribute('href', `./maps/map_${floorNumber}f.svg`);
  if (floorTitle) floorTitle.textContent = `FLOOR MAP (${floorNumber}F)`;
}

function updateMinimap(){
  const currentNode = NODES[currentId];
  if (!currentNode) return;

  updateMinimapFloor(currentNode.floor);

  for (let id in NODES) {
    const dot = $(`mm-dot-${id}`);
    if (dot) {
      if (id === currentId) {
        dot.setAttribute('fill', '#5a7fff');
        dot.setAttribute('stroke', '#fff');
      } else {
        dot.setAttribute('fill', 'rgba(30, 45, 90, 0.8)');
        dot.setAttribute('stroke', 'rgba(90, 127, 255, 0.6)');
      }
    }
  }

  const ax = currentNode.mmX;
  const ay = currentNode.mmY;
  
  $('mm-pulse').setAttribute('cx', ax);
  $('mm-pulse').setAttribute('cy', ay);
  
  // 5640x4320スケールに合わせた現在地矢印のサイズ調整
  $('mm-arrow').setAttribute('points', `${ax},${ay-30} ${ax+20},${ay+25} ${ax},${ay+10} ${ax-20},${ay+25}`);
}

function applyMinimapTransform() {
  const group = $('mm-transform-group');
  if (group) {
    group.setAttribute('transform', `translate(${mmPanX}, ${mmPanY}) scale(${mmScale})`);
  }
  
  // 現在地矢印の向きを視線方向（yaw）に連動して動かす
  const arrow = $('mm-arrow');
  const currentNode = NODES[currentId];
  if (arrow && currentNode) {
    const deg = (yaw * 180) / Math.PI;
    arrow.setAttribute('transform', `rotate(${deg}, ${currentNode.mmX}, ${currentNode.mmY})`);
  }
}

function focusCurrentNodeOnMinimap() {
  const currentNode = NODES[currentId];
  if (!currentNode) return;
  mmPanX = 130 - currentNode.mmX * mmScale;
  mmPanY = 80 - currentNode.mmY * mmScale;
  applyMinimapTransform();
}

/* ---- events ---- */
let lastX=0, lastY=0;
canvas.addEventListener('pointerdown',e=>{
  if(walkPhase!=='idle') return;
  isDragging=false; lastX=e.clientX; lastY=e.clientY;
  canvas.setPointerCapture(e.pointerId);
  e.preventDefault();
});
canvas.addEventListener('pointermove',e=>{
  if(walkPhase!=='idle'){ canvas.style.cursor='default'; return; }
  if(e.buttons===0){
    mouse2.x=(e.clientX/window.innerWidth)*2-1;
    mouse2.y=-(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse2,camera);
    const hits=raycaster.intersectObjects(hotspotGroup.children);
    const tip=$('tooltip');
    if(hits.length){
      const sp=hits[0].object;
      canvas.style.cursor='pointer';
      tip.textContent=sp.userData.hint||sp.userData.label;
      tip.style.left=e.clientX+'px'; tip.style.top=e.clientY+'px';
      tip.style.opacity='1';
    } else {
      canvas.style.cursor='grab'; tip.style.opacity='0';
    }
    return;
  }
  const dx=e.clientX-lastX, dy=e.clientY-lastY;
  if(Math.abs(dx)+Math.abs(dy)>3) isDragging=true;
  tYaw  -=dx*0.0038;
  tPitch+=dy*0.0038;
  tPitch=Math.max(-Math.PI/2.1,Math.min(Math.PI/2.1,tPitch));
  lastX=e.clientX; lastY=e.clientY;
});
canvas.addEventListener('pointerup',e=>{
  if(walkPhase!=='idle'||isDragging) return;
  mouse2.x=(e.clientX/window.innerWidth)*2-1;
  mouse2.y=-(e.clientY/window.innerHeight)*2+1;
  raycaster.setFromCamera(mouse2,camera);
  const hits=raycaster.intersectObjects(hotspotGroup.children);
  if(hits.length){
    const sp=hits[0].object;
    startWalk(sp.userData.targetId, [sp.position.x,sp.position.y,sp.position.z]);
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

/* --- ミニマップ内操作イベントを関数分離して初期化時にアタッチ --- */
function setupMinimapInteractions() {
  const mmMask = $('mm-drag-mask');
  if (!mmMask) return;

  mmMask.addEventListener('pointerdown', e => {
    isMMDragging = true;
    mmStartX = e.clientX - mmPanX;
    mmStartY = e.clientY - mmPanY;
    mmMask.setPointerCapture(e.pointerId);
    mmMask.style.cursor = 'grabbing';
    e.stopPropagation(); 
  });
  mmMask.addEventListener('pointermove', e => {
    if (!isMMDragging) return;
    mmPanX = e.clientX - mmStartX;
    mmPanY = e.clientY - mmStartY;
    applyMinimapTransform();
    e.stopPropagation();
  });
  mmMask.addEventListener('pointerup', e => {
    isMMDragging = false;
    mmMask.style.cursor = 'grab';
    e.stopPropagation();
  });

  $('hud-minimap').addEventListener('wheel', e => {
    e.preventDefault();
    e.stopPropagation(); 

    const zoomFactor = 1.1;
    const oldScale = mmScale;
    
    if (e.deltaY < 0) {
      mmScale = Math.min(2.0, mmScale * zoomFactor);
    } else {
      mmScale = Math.max(0.02, mmScale / zoomFactor);
    }

    const rect = $('hud-minimap').getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    mmPanX = mouseX - (mouseX - mmPanX) * (mmScale / oldScale);
    mmPanY = mouseY - (mouseY - mmPanY) * (mmScale / oldScale);

    applyMinimapTransform();
  }, { passive: false });

  $('mm-btn-rec').addEventListener('click', e => {
    e.stopPropagation();
    mmScale = 0.12; 
    focusCurrentNodeOnMinimap();
  });
}

$('fov-slider').addEventListener('input', e=>{ tFov=+e.target.value; });
$('btn-zm').onclick=()=>{ tFov=Math.max(30,tFov-10); };
$('btn-zp').onclick=()=>{ tFov=Math.min(110,tFov+10); };
$('btn-reset').onclick=()=>{ const n=NODES[currentId]; tYaw=n.initYaw; tPitch=0; tFov=75; };
$('btn-auto').addEventListener('click',function(){ autoRotate=!autoRotate; this.textContent=autoRotate?'⏸':'▶'; this.classList.toggle('active',autoRotate); });
window.addEventListener('resize',()=>{ renderer.setSize(window.innerWidth,window.innerHeight,false); camera.aspect=window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); });

/* ---- Modal Events & HUD Controller ---- */
const modal = $('settings-modal');
$('btn-settings').onclick = () => modal.classList.add('open');
$('btn-close-modal').onclick = () => modal.classList.remove('open');
modal.onclick = (e) => { if(e.target === modal) modal.classList.remove('open'); };

function setupToggle(id, targetEl, callback) {
  $(id).addEventListener('change', e => {
    const visible = e.target.checked;
    if (targetEl) targetEl.style.opacity = visible ? '1' : '0';
    if (callback) callback(visible);
  });
}
setupToggle('tg-hud-loc', $('hud-location'));
setupToggle('tg-hud-compass', $('hud-compass'));
setupToggle('tg-hud-map', $('hud-minimap'));
setupToggle('tg-hud-debug', $('debug-container'));

setupToggle('tg-grid-edges', null, (visible) => {
  uiConfig.edges = visible;
  if(walkPhase === 'idle') gridEdgesA.material.opacity = visible ? 0.15 : 0;
});
setupToggle('tg-grid-points', null, (visible) => {
  uiConfig.points = visible;
  if(walkPhase === 'idle') gridPointsA.material.opacity = visible ? 0.25 : 0;
});
setupToggle('tg-grid-routes', null, (visible) => {
  uiConfig.routes = visible;
  buildRouteLines(NODES[currentId]);
});

/* ---- HUD: 文字サイズモード(Constant / Distance) 切り替えイベント ---- */
document.addEventListener('DOMContentLoaded', () => {
  const textSizeBtn = document.getElementById('btn-text-size-mode');
  if (textSizeBtn) {
    // 💡 初期状態の表示を設定オブジェクトと同期
    if (uiConfig.textSizeMode === 'distance') {
      textSizeBtn.textContent = 'Distance';
      textSizeBtn.style.color = '#ccc';
    } else {
      textSizeBtn.textContent = 'Constant';
      textSizeBtn.style.color = '#55ff7f';
    }

    // クリック時の切り替えイベント
    textSizeBtn.addEventListener('click', () => {
      if (uiConfig.textSizeMode === 'constant') {
        uiConfig.textSizeMode = 'distance';
        textSizeBtn.textContent = 'Distance';
        textSizeBtn.style.color = '#ccc'; // 距離依存時は通常のグレー文字に
      } else {
        uiConfig.textSizeMode = 'constant';
        textSizeBtn.textContent = 'Constant';
        textSizeBtn.style.color = '#55ff7f'; // 一定化時は目立つネオンカラーに
      }
    });
  }
});

// マウスクリック、またはタップイベント内に組み込む処理の例
function onWorkspaceClick(event) {
  // 標準のイベント座標変換（Three.jsのRaycaster用）
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  // routeLinesGroup の中身を対象に衝突判定
  const intersects = raycaster.intersectObjects(routeLinesGroup.children);

  if (intersects.length > 0) {
    // 最も手前にある衝突オブジェクトを取得
    const hitObj = intersects[0].object;

    // もしルート要素（パス、テキスト、ピン）であれば
    if (hitObj.userData && hitObj.userData.isRoute && hitObj.userData.link) {
      const targetLink = hitObj.userData.link;

      // 💡 既存の「移動処理（ワープ開始関数）」を呼び出す
      // ※関数の名称が `startWalk` や `onHotspotClick` など、現在のプログラムの設計に合わせて呼び出してください
      console.log("ルート要素がクリックされました。移動先:", targetLink);
      
      // 例: 現在のホットスポットクリック時と同じ関数を呼び出す場合
      // walkToNode(targetLink); 
      return; // 遷移を開始したため処理を抜ける
    }
  }
}

// 既存のイベントリスナー登録箇所に追加
renderer.domElement.addEventListener('click', onWorkspaceClick);


/* ---- animation loop ---- */
function animate(now){
  requestAnimationFrame(animate);
  const dt=Math.min((now-lastTS)/1000,0.1);
  lastTS=now; hotspotTime+=dt; mmPulseT+=dt;

  if(walkPhase=='walk'){
    walkT=Math.min(walkT+dt/WALK_DUR,1);

    yaw = tYaw;
    pitch = tPitch;

    camera.position.set(0, 0, 0);
    hotspotGroup.position.set(0, 0, 0);

    const radiusA = 50;
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
    routeLinesGroup.scale.set(s, 1, s); 

    if (walkT < 0.9) {
      sphereA.material.opacity = 1.0;
      sphereB.material.opacity = 0.0;
      
      gridEdgesA.material.opacity = uiConfig.edges ? 0.25 : 0;
      gridPointsA.material.opacity = uiConfig.points ? 0.35 : 0;
      gridEdgesB.material.opacity = 0;
      gridPointsB.material.opacity = 0;
      
      routeLinesGroup.children.forEach(l => {
        if(l.material) l.material.opacity = uiConfig.routes ? 0.6 * (1.0 - walkT) : 0;
      });
    } else {
      const fadeProgress = (walkT - 0.9) / 0.1; 
      sphereB.material.opacity = fadeProgress;
      sphereA.material.opacity = 1.0 - fadeProgress;

      gridEdgesA.material.opacity = uiConfig.edges ? 0.25 * (1.0 - fadeProgress) : 0;
      gridPointsA.material.opacity = uiConfig.points ? 0.35 * (1.0 - fadeProgress) : 0;
      gridEdgesB.material.opacity = uiConfig.edges ? 0.15 * fadeProgress : 0;
      gridPointsB.material.opacity = uiConfig.points ? 0.25 * fadeProgress : 0;
      
      routeLinesGroup.children.forEach(l => { if(l.material) l.material.opacity = 0; });
    }

    camera.fov=fov;
    camera.updateProjectionMatrix();
    updateCamera();
    updateCompass(yaw);

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

    $('fov-slider').value=Math.round(fov);
    $('fov-readout').textContent=Math.round(fov)+'°';

    if (gridEdgesA && gridPointsA) {
      gridEdgesA.material.opacity = uiConfig.edges ? 0.15 : 0;
      gridPointsA.material.opacity = uiConfig.points ? 0.25 : 0;
    }

    const yOffset = -3.8;

    routeLinesGroup.children.forEach(l => {
      if (l.material) {
        l.material.opacity = uiConfig.routes ? (l.userData.isPin ? 0.9 : 0.6) : 0;
      }
      
      if (l.userData && l.userData.isRoute) {
        if (l.userData.isText || l.userData.isPin) {
          const distToCamera = camera.position.distanceTo(l.position);
          
          let scaleFactor = 1.0;
          if (uiConfig.textSizeMode === 'constant') {
            scaleFactor = distToCamera * 0.12; 
          } else {
            scaleFactor = 1.0;
          }

          // 💡 テキストスプライトの処理
          if (l.userData.isText) {
            l.scale.set(4 * scaleFactor, 1 * scaleFactor, 1);
            // 💡 スケールの拡大に合わせて、文字のボトムが三角（0.8m分）の上に常に留まるようY座標を動的追従
            l.position.y = (yOffset + 0.5) + (1.0 * scaleFactor) + 0.1;
          }
          
          // 三角形ピンの処理
          if (l.userData.isPin) {
            l.scale.set(scaleFactor, scaleFactor, scaleFactor);
            l.quaternion.copy(camera.quaternion);
          }
        }
      }
    });
  }

  if(Math.floor(now/40)%2===0) animateHotspots(hotspotTime);

  const pr=12+5*Math.abs(Math.sin(mmPulseT*2.3));
  const pulseEl = $('mm-pulse');
  if (pulseEl) {
    pulseEl.setAttribute('r',pr.toFixed(1));
    pulseEl.setAttribute('opacity',(0.45-0.28*Math.abs(Math.sin(mmPulseT*2.3))).toFixed(2));
  }

  renderer.render(scene, camera);

  sphereA.material.wireframe = true;
  sphereB.material.wireframe = true;
  cameraHelper.update();
  
  debugRenderer.render(scene, debugCamera);
  
  sphereA.material.wireframe = false;
  sphereB.material.wireframe = false;
}

// 初期セットアップ
initMinimapLayout();
loadInitial('13_corridor_0000,0020');
requestAnimationFrame(animate);