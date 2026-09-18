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
let isDebugMonitorOn = false; // trueの時だけ2回目のレンダリングを行う

const cameraHelper = new THREE.CameraHelper(camera);
cameraHelper.renderOrder = 999;
cameraHelper.material.depthTest = false;
cameraHelper.material.depthWrite = false;
scene.add(cameraHelper);

/* ---- state ---- */
let currentId   = '21_entrance_0720,0640_昇降口';
let nextId      = null;
let yaw=0, pitch=0, tYaw=0, tPitch=0;
let fov=75, tFov=75;
let isDragging  = false;
let yawVelocity = 0;    // 指/マウスを離した瞬間の勢いを保持する角速度（rad/秒相当）
let pitchVelocity = 0;
const INERTIA_STRENGTH = 0.4; // 慣性の初速をどれだけ抑えるか（1.0で等倍、小さいほど控えめ）
let lastDragMoveTs = 0; // 角速度算出用の直前タイムスタンプ
let autoRotate  = false;

let walkPhase   = 'idle';
let walkT       = 0;
const WALK_DUR  = 1.1;
let nextTextureReady = false; // 遷移先テクスチャの読み込みが完了したか（演出タイマーとの競合対策）

let lastTS      = 0;

/* ---- UI Visibility Config ---- */
const uiConfig = {
  edges: true,
  points: true,
  routes: true,
  textSizeMode: 'constant' 
};

/* ---- ユーザー設定の永続化（localStorage） ----
   保存対象はユーザー向け設定のみ。開発者向けのトグル（デバッグモニター等）は
   意図的に対象外にしている（前回訪問時の状態が別の訪問者に持ち越されるのを避けるため）。 */
const USER_SETTINGS_KEY = 'hamakoStreetView.userSettings.v1';

function loadUserSettings() {
  try {
    const raw = localStorage.getItem(USER_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch (e) {
    console.warn('ユーザー設定の読み込みに失敗しました:', e);
    return {};
  }
}

function saveUserSettings(partial) {
  try {
    const merged = Object.assign(loadUserSettings(), partial);
    localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('ユーザー設定の保存に失敗しました:', e);
  }
}

const savedUserSettings = loadUserSettings();
if (savedUserSettings.textSizeMode === 'constant' || savedUserSettings.textSizeMode === 'distance') {
  uiConfig.textSizeMode = savedUserSettings.textSizeMode;
}

/* ---- 開発者モード ----
   一般ユーザーには「ユーザー設定」しか見せない。以下のいずれかでのみ開発者モードへ入れる：
   - URL末尾に ?dev=1 を付けてアクセスする
   - Alt+D で、リロードなしにその場でON/OFFを切り替える（この状態はセッション限りで保存しない） */
let devModeUnlocked = new URLSearchParams(window.location.search).get('dev') === '1';
let settingsActiveTab = 'user'; // 'user' | 'dev'（devModeUnlocked=falseの間は常に'user'扱い）

function updateSettingsModeUI() {
  const tabs = $('settings-mode-tabs');
  const userSection = $('settings-user-section');
  const devSection = $('settings-dev-section');
  const tabUserBtn = $('tab-btn-user');
  const tabDevBtn = $('tab-btn-dev');
  if (!tabs || !userSection || !devSection) return;

  if (!devModeUnlocked) {
    // 一般ユーザー視点：切り替えタブ自体を表示しない。常にユーザー設定のみ見せる
    tabs.style.display = 'none';
    userSection.style.display = '';
    devSection.style.display = 'none';
    settingsActiveTab = 'user';
    return;
  }

  // 開発者モード：切り替えタブを表示し、選択中のタブに応じて表示を切り替える
  tabs.style.display = 'flex';
  userSection.style.display = (settingsActiveTab === 'user') ? '' : 'none';
  devSection.style.display = (settingsActiveTab === 'dev') ? '' : 'none';
  if (tabUserBtn) tabUserBtn.classList.toggle('is-active', settingsActiveTab === 'user');
  if (tabDevBtn) tabDevBtn.classList.toggle('is-active', settingsActiveTab === 'dev');
}

function setDevModeUnlocked(on) {
  devModeUnlocked = on;
  settingsActiveTab = 'user'; // 切り替わった瞬間に開発者設定がいきなり露出しないよう、常にユーザー設定から見せる
  updateSettingsModeUI();
}

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

    // 進行方向を向くシェブロン角度（コード内の他所と同じyaw規約 atan2(x,-z) 系に合わせて導出）
    const chevronAngle = Math.atan2(-direction.x, -direction.z);

    /* ---- 現在地から足元マーカーまでを結ぶ、薄い帯（補助線） ---- */
    const bandGeo = new THREE.PlaneGeometry(0.18, distance);
    const bandMat = new THREE.MeshBasicMaterial({
      color: 0x5a7fff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const bandMesh = new THREE.Mesh(bandGeo, bandMat);
    bandMesh.position.copy(startPoint).add(direction.clone().multiplyScalar(distance / 2));
    bandMesh.lookAt(endPoint);
    bandMesh.rotateX(Math.PI / 2);
    bandMesh.renderOrder = 18;
    bandMesh.raycast = () => {}; // 視覚的な補助線のみ。クリック／ホバー判定には関与させない
    bandMesh.userData = { isRoute: true, link: lk, isBand: true };
    routeLinesGroup.add(bandMesh);

    /* ---- 足元の円形マーカー（Googleストリートビュー風のナビゲーション・チップ） ---- */
    const discRadius = 1.15; // 一回り大きく
    const discSize = 256;
    const discCanvas = document.createElement('canvas');
    discCanvas.width = discSize; discCanvas.height = discSize;
    const dctx = discCanvas.getContext('2d');

    // 半透明の白ディスク（放射グラデーションで縁をフェード）
    const grad = dctx.createRadialGradient(discSize/2, discSize/2, discSize*0.04, discSize/2, discSize/2, discSize*0.48);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.72, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = grad;
    dctx.beginPath();
    dctx.arc(discSize/2, discSize/2, discSize*0.48, 0, Math.PI*2);
    dctx.fill();

    // 進行方向を示すシェブロン（シンプルな三角形1つに簡略化）。canvas上方向 = ローカルY+ = 移動方向に一致
    dctx.fillStyle = '#1a73e8';
    dctx.beginPath();
    dctx.moveTo(discSize*0.50, discSize*0.22);
    dctx.lineTo(discSize*0.74, discSize*0.62);
    dctx.lineTo(discSize*0.26, discSize*0.62);
    dctx.closePath();
    dctx.fill();

    const discGeo = new THREE.CircleGeometry(discRadius, 32);
    discGeo.rotateX(-Math.PI / 2); // 地面と水平になるよう平置き（法線が+Y）

    const discMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(discCanvas),
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.position.set(targetX, yOffset + 0.02, targetZ);
    discMesh.rotation.y = chevronAngle;
    discMesh.renderOrder = 20;
    discMesh.userData = { isRoute: true, link: lk, isDisc: true };
    routeLinesGroup.add(discMesh);

    // 脈動するパルスリング（クリック可能であることを示すアフォーダンス）
    const pulseGeo = new THREE.RingGeometry(discRadius, discRadius * 1.17, 40);
    pulseGeo.rotateX(-Math.PI / 2);
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0x1a73e8,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
    pulseMesh.position.set(targetX, yOffset + 0.015, targetZ);
    pulseMesh.renderOrder = 19;
    pulseMesh.raycast = () => {}; // クリック判定は本体のディスクにのみ発生させる
    pulseMesh.userData = { isRoute: true, link: lk, isPulse: true };
    routeLinesGroup.add(pulseMesh);

    /* ---- 行き先ラベル（案内テキスト） ---- */
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
  nextTextureReady = false;

  walkDir = new THREE.Vector3(...hotspotPos).normalize();
  const speedHud = $('hud-speed');
  if(speedHud) speedHud.style.opacity='1';

  setLoadBar(30);
  const node=NODES[targetNodeId];
  tLoader.load(
    node.asset.url,
    tex=>{
      tex.wrapS=THREE.RepeatWrapping; tex.wrapT=THREE.RepeatWrapping;
      tex.minFilter=THREE.LinearFilter; tex.generateMipmaps=false;
      tex.offset.x = 0.5; 

      sphereB.material.map=tex; sphereB.material.needsUpdate=true;
      setLoadBar(80);
      nextTextureReady = true;
    },
    undefined,
    err=>{
      // 読み込み失敗時も演出が永久に止まってしまわないよう、
      // 古い（あるいは無い）テクスチャのままでも進行を許可する
      console.error('パノラマ画像の読み込みに失敗しました:', node.asset.url, err);
      setLoadBar(80);
      nextTextureReady = true;
    }
  );
}

/* ---- ロケーション名HUDの更新（loc-outline / loc-fill 両方に同じテキストを反映） ---- */
function setLocationName(name) {
  const locName = $('loc-name');
  if (!locName) return;

  locName.querySelector('.loc-outline').textContent = name;
  locName.querySelector('.loc-fill').textContent = name;
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
  setLocationName(node.name);
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
  setLocationName(node.name);
  $('loc-sub').textContent=node.sub;
  currentId=nodeId;
  
  if (typeof updateMinimap === 'function') updateMinimap();
  if (typeof focusCurrentNodeOnMinimap === 'function') focusCurrentNodeOnMinimap();
  
  setLoadBar(20);
  tLoader.load(node.asset.url, tex=>{
    tex.wrapS=THREE.RepeatWrapping; tex.wrapT=THREE.RepeatWrapping;
    tex.minFilter=THREE.LinearFilter; tex.generateMipmaps=false;
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

const compassCanvas = document.getElementById('hud-compass');
const compassCtx = compassCanvas.getContext('2d');

const COMPASS_FOV = 90;
const COMPASS_STEP = 5;

function normalizeDegrees(degrees) {
    return (degrees % 360 + 360) % 360;
}

function drawCompass(angle) {
    const degrees = normalizeDegrees(
        -angle * 180 / Math.PI
    );

    const roundedDegrees = Math.round(degrees);

    const rect = compassCanvas.getBoundingClientRect();

    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    const devicePixelRatioValue = window.devicePixelRatio || 1;

    const targetWidth = Math.round(width * devicePixelRatioValue);
    const targetHeight = Math.round(height * devicePixelRatioValue);

    if (
        compassCanvas.width !== targetWidth ||
        compassCanvas.height !== targetHeight
    ) {
        compassCanvas.width = targetWidth;
        compassCanvas.height = targetHeight;
    }

    compassCtx.setTransform(
        devicePixelRatioValue,
        0,
        0,
        devicePixelRatioValue,
        0,
        0
    );

    compassCtx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;

    const pixelsPerDegree = width / COMPASS_FOV;

    const minDegrees = degrees - COMPASS_FOV / 2;
    const maxDegrees = degrees + COMPASS_FOV / 2;

    /*
     * 中央の赤い現在方向マーカー
     */
    compassCtx.fillStyle = '#D95757';

    compassCtx.beginPath();
    compassCtx.moveTo(centerX - 8, 0);
    compassCtx.lineTo(centerX + 8, 0);
    compassCtx.lineTo(centerX, 11);
    compassCtx.closePath();
    compassCtx.fill();

    /*
     * 中央の縦線
     */
    /*
    * 中央の縦線
    */
    compassCtx.strokeStyle = 'rgba(217, 87, 87, 0.9)';
    compassCtx.lineWidth = 2;

    compassCtx.beginPath();
    compassCtx.moveTo(centerX, 11);
    compassCtx.lineTo(centerX, height);
    compassCtx.stroke();

    /*
     * 目盛りと方位文字
     */
    const startStep =
        Math.floor(minDegrees / COMPASS_STEP) * COMPASS_STEP;

    const endStep =
        Math.ceil(maxDegrees / COMPASS_STEP) * COMPASS_STEP;

    compassCtx.textAlign = 'center';
    compassCtx.textBaseline = 'middle';

    for (
        let direction = startStep;
        direction <= endStep;
        direction += COMPASS_STEP
    ) {
        const offsetDegrees = degrees - direction;
        const x = centerX + offsetDegrees * pixelsPerDegree;

        if (x < -30 || x > width + 30) {
            continue;
        }

        const normalizedDirection = normalizeDegrees(direction);

        const isCardinal =
            normalizedDirection === 0 ||
            normalizedDirection === 90 ||
            normalizedDirection === 180 ||
            normalizedDirection === 270;

        const isDiagonal =
            normalizedDirection === 45 ||
            normalizedDirection === 135 ||
            normalizedDirection === 225 ||
            normalizedDirection === 315;

        const isLarge = direction % 45 === 0;
        const isMedium = direction % 15 === 0;

        let tickHeight = 7;

        if (isLarge) {
            tickHeight = 24;
        } else if (isMedium) {
            tickHeight = 16;
        }

        /*
         * 目盛り
         */
        compassCtx.strokeStyle = isCardinal
            ? '#725B9F'
            : 'rgba(79, 66, 104, 0.78)';

        compassCtx.lineWidth = isLarge
            ? 4.5
            : isMedium
                ? 3.5
                : 2.5;

        compassCtx.lineCap = 'butt';

        compassCtx.beginPath();
        compassCtx.moveTo(x, 0);
        compassCtx.lineTo(x, tickHeight);
        compassCtx.stroke();

        /*
         * 方位ラベル
         */
        if (isLarge) {
            let label = `${Math.round(normalizedDirection)}°`;

            if (isCardinal || isDiagonal) {
                if (normalizedDirection === 0) {
                    label = '北';
                } else if (normalizedDirection === 45) {
                    label = '北西';
                } else if (normalizedDirection === 90) {
                    label = '西';
                } else if (normalizedDirection === 135) {
                    label = '南西';
                } else if (normalizedDirection === 180) {
                    label = '南';
                } else if (normalizedDirection === 225) {
                    label = '南東';
                } else if (normalizedDirection === 270) {
                    label = '東';
                } else if (normalizedDirection === 315) {
                    label = '北東';
                }
            }

            compassCtx.font = isCardinal
                ? '700 18px sans-serif'
                : '600 14px sans-serif';

            compassCtx.textAlign = 'center';
            compassCtx.textBaseline = 'middle';

            /*
            * 1層目：外側の縁
            */
            compassCtx.lineJoin = 'round';
            compassCtx.lineWidth = isCardinal ? 5 : 4;
            compassCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';

            compassCtx.strokeText(
                label,
                x,
                height - 22
            );

            /*
            * 2層目：内側の文字
            */
            compassCtx.fillStyle = isCardinal
                ? '#725B9F'
                : '#4F4268';

            compassCtx.fillText(
                label,
                x,
                height - 22
            );
        }
    }

    /*
     * 下部の境界線
     */
    compassCtx.strokeStyle = 'rgba(139, 120, 181, 0.24)';
    compassCtx.lineWidth = 1;

    compassCtx.beginPath();
    compassCtx.moveTo(0, height - 1);
    compassCtx.lineTo(width, height - 1);
    compassCtx.stroke();
}

/* ---- events (モバイル・マルチデバイス対応版) ---- */
let lastX=0, lastY=0;

canvas.addEventListener('touchstart', e => {
  if (e.touches.length > 1) return; 
  if (walkPhase !== 'idle') return;

  isDragging = false; 
  yawVelocity = 0; pitchVelocity = 0;
  lastDragMoveTs = performance.now();
  lastX = e.touches[0].clientX; 
  lastY = e.touches[0].clientY;
}, { passive: true });

canvas.addEventListener('touchmove', e => {
  if (e.touches.length > 1) return;
  if (walkPhase !== 'idle') return;

  const dx = e.touches[0].clientX - lastX;
  const dy = e.touches[0].clientY - lastY;

  if (Math.abs(dx) + Math.abs(dy) > 2) isDragging = true;

  const now = performance.now();
  const dtSec = Math.max((now - lastDragMoveTs) / 1000, 1/240);
  yawVelocity   = (-dx * 0.004) / dtSec * INERTIA_STRENGTH;
  pitchVelocity = ( dy * 0.004) / dtSec * INERTIA_STRENGTH;
  lastDragMoveTs = now;

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
  yawVelocity = 0; pitchVelocity = 0;
  lastDragMoveTs = performance.now();
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
    if (hitObj && hitObj.userData && hitObj.userData.isRoute && (hitObj.userData.isText || hitObj.userData.isDisc)) {
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
  const now = performance.now();
  const dtSec = Math.max((now - lastDragMoveTs) / 1000, 1/240);
  yawVelocity   = (-dx * 0.0038) / dtSec * INERTIA_STRENGTH;
  pitchVelocity = ( dy * 0.0038) / dtSec * INERTIA_STRENGTH;
  lastDragMoveTs = now;
  tYaw   -= dx * 0.0038;
  tPitch += dy * 0.0038;
  tPitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, tPitch));
  lastX = e.clientX; lastY = e.clientY;
});

canvas.addEventListener('pointerup',e=>{
  if (e.pointerType === 'touch') return;
  const wasDragging = isDragging;
  isDragging = false; // 離した瞬間に必ずリセット（idleループで慣性回転を効かせるため）
  if (walkPhase !== 'idle' || wasDragging) return;
});

/* ---- ホットスポットのヒット判定＆移動開始（マウスのdblclick／タッチのダブルタップ共通処理） ---- */
function tryTeleportAt(clientX, clientY){
  if (walkPhase !== 'idle') return;

  const canvasBounds = renderer.domElement.getBoundingClientRect();
  mouse2.x = ((clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
  mouse2.y = -((clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;

  raycaster.setFromCamera(mouse2, camera);
  const hits = raycaster.intersectObjects(routeLinesGroup.children);

  if (hits.length) {
    const hitObj = hits[0].object;
    if (hitObj.userData && hitObj.userData.isRoute && hitObj.userData.link) {
      if (hitObj.userData.isText || hitObj.userData.isDisc) {
        const lk = hitObj.userData.link;
        const targetPos = lk.pos ? [lk.pos[0] / 4, -3.8 + 1.0, lk.pos[2] / 4] : [0, 0, 0];
        startWalk(lk.targetId, targetPos);
      }
    }
  }
}

canvas.addEventListener('dblclick', e => {
  tryTeleportAt(e.clientX, e.clientY);
});

/* ---- iOS/タッチ向け：ダブルタップ検知（dblclickはタッチでは発火しないため自前で実装） ---- */
let lastTapTime = 0;
let lastTapX = 0, lastTapY = 0;
const DOUBLE_TAP_MS = 320;   // この間隔以内の2回タップをダブルタップとみなす
const DOUBLE_TAP_DIST = 30;  // 2回のタップ位置がこの距離(px)以内であること

canvas.addEventListener('touchend', e => {
  if (walkPhase !== 'idle') return;
  if (e.changedTouches.length !== 1 || e.touches.length > 0) return; // 単指タップのみ対象（ピンチ操作等は除外）

  const wasDragging = isDragging;
  isDragging = false; // 離した瞬間に必ずリセット（idleループで慣性回転を効かせるため）
  if (wasDragging) { lastTapTime = 0; return; } // ドラッグ（視点回転）の指離しはタップ扱いしない

  const touch = e.changedTouches[0];
  const now = performance.now();
  const dx = touch.clientX - lastTapX;
  const dy = touch.clientY - lastTapY;
  const dist = Math.hypot(dx, dy);

  if (now - lastTapTime < DOUBLE_TAP_MS && dist < DOUBLE_TAP_DIST) {
    tryTeleportAt(touch.clientX, touch.clientY);
    lastTapTime = 0; // 3回連続タップ等で誤爆しないようリセット
  } else {
    lastTapTime = now;
    lastTapX = touch.clientX;
    lastTapY = touch.clientY;
  }
}, { passive: true });

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
    // テクスチャの読み込みが間に合っていない場合、クロスフェード開始点(0.9)手前で足踏みさせる。
    // これにより「読み込み未完了の画像がsphereAへ確定コピーされる」競合状態を防ぐ。
    const walkTCap = nextTextureReady ? 1 : 0.9;
    walkT=Math.min(walkT+dt/WALK_DUR, walkTCap);

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
    drawCompass(yaw);

    if (typeof applyMinimapTransform === 'function') {
      applyMinimapTransform();
    }

    if(walkT>=1) finishWalk();
  } else {
    if(autoRotate&&!isDragging) tYaw+=0.06*dt;

    if (!isDragging && (Math.abs(yawVelocity) > 0.002 || Math.abs(pitchVelocity) > 0.002)) {
      // 指／マウスを離した瞬間の勢いを、減速しながら少しだけ引き継ぐ（慣性回転）
      tYaw   += yawVelocity * dt;
      tPitch += pitchVelocity * dt;
      tPitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, tPitch));

      const friction = Math.pow(0.008, dt); // 短時間でほぼ収束する摩擦係数（控えめな「遊び」にとどめる）
      yawVelocity   *= friction;
      pitchVelocity *= friction;
      if (Math.abs(yawVelocity)   < 0.002) yawVelocity = 0;
      if (Math.abs(pitchVelocity) < 0.002) pitchVelocity = 0;
    }

    const k=1-Math.pow(0.008,dt*10);
    yaw  +=(tYaw -yaw  )*k;
    pitch+=(tPitch-pitch)*k;
    fov  +=(tFov -fov  )*k;

    camera.fov=fov;
    camera.updateProjectionMatrix();
    updateCamera();
    drawCompass(yaw);

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
          if (l.userData.isBand) {
            l.material.opacity = uiConfig.routes ? 0.22 : 0;
          } else if (l.userData.isDisc) {
            l.material.opacity = uiConfig.routes ? 1.0 : 0;
          } else if (l.userData.isPulse) {
            // 0〜1.5秒でリングが外側へ広がりながらフェードする脈動アニメーション
            const pulsePhase = (now % 1500) / 1500;
            l.scale.set(1 + pulsePhase * 0.7, 1, 1 + pulsePhase * 0.7);
            l.material.opacity = uiConfig.routes ? (1 - pulsePhase) * 0.5 : 0;
          } else if (l.userData.isText) {
            l.material.opacity = uiConfig.routes ? 1.0 : 0;
          }
        }
        
        const distToCamera = camera.position.distanceTo(l.position);
        let scaleFactor = (uiConfig.textSizeMode === 'constant') ? distToCamera * 0.12 : 1.0;

        if (l.userData.isText) {
          l.scale.set(4 * scaleFactor, 1 * scaleFactor, 1);
          l.position.y = (yOffset + 0.5) + (1.0 * scaleFactor) + 0.1;
        }
      }
    });

    // 視点回転（yaw）をリアルタイムでミニマップのプレイヤー向き（mm-player矢印）へ反映
    if (typeof applyMinimapTransform === 'function') {
      applyMinimapTransform();
    }
  }

  if (typeof updateMinimapPulse === 'function') {
    updateMinimapPulse(dt);
  }

  renderer.render(scene, camera);

  // デバッグモニターが非表示の間はシーンの2重レンダリングとwireframe切替を行わない（負荷軽減）
  if (isDebugMonitorOn) {
    sphereA.material.wireframe = true;
    sphereB.material.wireframe = true;
    cameraHelper.update();

    debugRenderer.render(scene, activeDebugCamera);

    sphereA.material.wireframe = false;
    sphereB.material.wireframe = false;
  }
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

  // 💡 保存済みのユーザー設定を、各コントロールを配線する前にDOMへ反映しておく。
  //    setupToggle()はel.checkedを初期値として読み取ってコールバックへ渡すため、
  //    ここで先にcheckedを書き換えておけば、初期化と同時に保存済みの状態が適用される。
  const hudLocEl = $('tg-hud-loc');
  if (hudLocEl && typeof savedUserSettings.hudLoc === 'boolean') hudLocEl.checked = savedUserSettings.hudLoc;
  const hudCompassEl = $('tg-hud-compass');
  if (hudCompassEl && typeof savedUserSettings.hudCompass === 'boolean') hudCompassEl.checked = savedUserSettings.hudCompass;
  const routesEl = $('tg-grid-routes');
  if (routesEl && typeof savedUserSettings.routeLines === 'boolean') routesEl.checked = savedUserSettings.routeLines;
  const layoutSelectEl = $('mm-layout-select');
  if (layoutSelectEl && savedUserSettings.minimapLayout) layoutSelectEl.value = savedUserSettings.minimapLayout;

  setupToggle('tg-hud-loc', $('hud-location'), (visible) => {
    saveUserSettings({ hudLoc: visible });
  });
  // 💡 修正: このトグルはHTML側にチェックボックスがあるだけでJSの配線が無く、
  //    操作してもコンパスの表示/非表示が一切変わらないバグがあったため、ここで結線する。
  setupToggle('tg-hud-compass', $('compass-wrapper'), (visible) => {
    saveUserSettings({ hudCompass: visible });
  });
  setupToggle('tg-hud-debug', $('debug-container'), (visible) => {
    isDebugMonitorOn = visible;
    // FOVスライダー等のコントロールパネルは、通常時は非表示にし、デバッグ時のみ表示する
    const ctrlPanel = $('hud-controls');
    if (ctrlPanel) ctrlPanel.style.display = visible ? '' : 'none';
  });
  setupToggle('tg-edit-mode', null, (visible) => {
    if (typeof setMinimapEditMode === 'function') setMinimapEditMode(visible);
  });

  const mmLayoutSelect = $('mm-layout-select');
  if (mmLayoutSelect) {
    mmLayoutSelect.addEventListener('change', e => {
      if (typeof setMinimapLayout === 'function') setMinimapLayout(e.target.value);
      saveUserSettings({ minimapLayout: e.target.value });
    });
  }

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
    saveUserSettings({ routeLines: visible });
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
      saveUserSettings({ textSizeMode: uiConfig.textSizeMode });
    });
  }

  // 💡 ユーザー設定/開発者モード設定の切り替えタブ。
  //    ボタン自体はHTML側に常に存在するが、updateSettingsModeUI()が
  //    devModeUnlocked=falseの間は#settings-mode-tabsをdisplay:noneにするため、
  //    一般ユーザーの目には触れない。
  const tabUserBtn = $('tab-btn-user');
  const tabDevBtn = $('tab-btn-dev');
  if (tabUserBtn) tabUserBtn.addEventListener('click', () => { settingsActiveTab = 'user'; updateSettingsModeUI(); });
  if (tabDevBtn) tabDevBtn.addEventListener('click', () => { settingsActiveTab = 'dev'; updateSettingsModeUI(); });
  updateSettingsModeUI(); // ?dev=1 付きでアクセスされていた場合、初期表示から開発者タブを見せる
});

window.addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    const editToggle = document.getElementById('tg-edit-mode');
    if (editToggle) {
      editToggle.checked = !editToggle.checked;
      editToggle.dispatchEvent(new Event('change'));
    }
    return;
  }
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

// 起動時に呼び出す（initMinimapLayout → loadInitial の順序を保証する版のみ残す）
document.addEventListener('DOMContentLoaded', async () => {
    await initMapData();
    initMinimapLayout();
    loadInitial('21_entrance_0720,0640_昇降口');
    requestAnimationFrame(animate);
});