/**
 * minimap.js - ミニマップの描画、操作（ズーム、パン、ダブルクリック移動）、階層制御
 */

/* --- ミニマップ管理用の状態変数 --- */
let mmSrcNode = null; // 💡 main.jsのwalkPhaseと連動して移動元ノードを記憶する変数
let mmPanX = 0;      
let mmPanY = 0;      
let mmScale = 0.12; 
let isMMDragging = false;
let mmStartX = 0;
let mmStartY = 0;
let currentMinimapFloor = null; 
let mmPulseT = 0; // メインループからのdt蓄積用

/* --- 編集モード（頂点・辺の追加支援）用の状態変数 --- */
let editMode = false;
let draftNodes = {};      // id -> {id, name, sub, building, floor, pos3D:[x,y,z], mmX, mmY, links, isDraft:true}
let draftLinks = [];      // {from, to, oneway}
let edgeSourceId = null;  // リンク作成で「1つ目にクリックしたノード」を保持
let draftNodeSeq = 1;
let mmDragMoved = false;  // pointerdown〜upの間に実際に動いたか（クリックかドラッグかの判定用）

/* --- ミニマップ構築 --- */
function initMinimapLayout() {
  // グローバル変数 window.NODES がロード後であることを確認
  if (!window.NODES || Object.keys(window.NODES).length === 0) {
    console.error("NODESがまだ準備できていません。初期化順序を見直してください。");
    return;
  }
  
  const container = $('hud-minimap-container');
  if (!container) return;
  container.style.position = 'relative'; // 編集モードのポップアップ／ツールバーの位置基準

  container.innerHTML = `
    <svg id="hud-minimap-svg" viewBox="0 0 260 160" width="520" height="320" xmlns="http://www.w3.org/2000/svg" style="user-select: none; touch-action: none; border-radius: 12px; display: block;">
      <defs>
        <clipPath id="mm-panel-clip">
          <rect width="260" height="160" rx="14"/>
        </clipPath>
        <clipPath id="mm-viewport-clip">
          <rect x="0" y="0" width="260" height="160" rx="14"/>
        </clipPath>
        <pattern id="mm-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0 L0 0 0 10" fill="none" stroke="#3A4E78" stroke-width="0.4" opacity="0.35"/>
        </pattern>
        <radialGradient id="mm-vignette" cx="35%" cy="35%" r="75%">
          <stop offset="0%" stop-color="#000000"/>
          <stop offset="100%" stop-color="#000000"/>
        </radialGradient>
      </defs>

      <g clip-path="url(#mm-panel-clip)">
        <rect width="260" height="160" fill="url(#mm-vignette)"/>
        <rect width="260" height="160" stroke="rgba(255,255,255,0.06)" stroke-width="1.5" fill="none"/>
      </g>

      <g clip-path="url(#mm-viewport-clip)">
        <rect width="260" height="160" fill="url(#mm-grid)"/>

        <g id="mm-transform-group">
          <image id="mm-bg-map" href="" width="5690" height="4370" x="0" y="0" opacity="0.7" pointer-events="none" />
          <g id="mm-edges-group"></g>
          <g id="mm-nodes-group"></g>
        </g>

        <g id="mm-player" pointer-events="none">
          <circle id="mm-pulse" cx="0" cy="0" r="16" fill="none" stroke="#FF6B4A" stroke-width="1.4" opacity="0.55">
            <animate attributeName="r" values="0;22" dur="2.2s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.6;0" dur="2.2s" repeatCount="indefinite"/>
          </circle>
          <polygon id="mm-arrow" points="0,-6.75 -4.5,5.25 0,2.25 4.5,5.25" fill="#FF6B4A" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round"/>
        </g>

        <rect id="mm-drag-mask" width="260" height="160" fill="transparent" style="cursor: grab;"/>

        <text id="mm-floor-title" x="14" y="15" text-anchor="start" font-size="8" font-family="'Noto Sans JP', sans-serif" font-weight="700" letter-spacing="0.04em" fill="#8B95B4" pointer-events="none">フロアマップ</text>
      </g>

      <g id="mm-zoom-controls" transform="translate(12, 132)">
        <rect width="42" height="20" rx="6" fill="#121C38" stroke="#3A4E78" stroke-width="1"/>
        <line x1="21" y1="3" x2="21" y2="17" stroke="#3A4E78" stroke-width="1"/>
        <g id="mm-btn-zoom-in" style="cursor: pointer;">
          <rect x="1" y="1" width="20" height="18" rx="5" fill="transparent"/>
          <path d="M11,6 L11,14 M7,10 L15,10" stroke="#E9EDF7" stroke-width="1.4" stroke-linecap="round"/>
        </g>
        <g id="mm-btn-zoom-out" style="cursor: pointer;" transform="translate(21, 0)">
          <rect x="1" y="1" width="20" height="18" rx="5" fill="transparent"/>
          <path d="M7,10 L15,10" stroke="#E9EDF7" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </g>

      <g id="mm-floor-buttons" transform="translate(224, 64)" font-family="'Share Tech Mono', monospace" font-size="8">
        <g id="mm-btn-f4" style="cursor: pointer;">
          <rect width="32" height="16" rx="4" fill="transparent" stroke="#3A4E78" stroke-width="1"/>
          <text x="16" y="11" text-anchor="middle" fill="#8B95B4">4F</text>
        </g>
        <g id="mm-btn-f3" style="cursor: pointer;" transform="translate(0, 19)">
          <rect width="32" height="16" rx="4" fill="transparent" stroke="#3A4E78" stroke-width="1"/>
          <text x="16" y="11" text-anchor="middle" fill="#8B95B4">3F</text>
        </g>
        <g id="mm-btn-f2" style="cursor: pointer;" transform="translate(0, 38)">
          <rect width="32" height="16" rx="4" fill="transparent" stroke="#3A4E78" stroke-width="1"/>
          <text x="16" y="11" text-anchor="middle" fill="#8B95B4" font-weight="700">2F</text>
        </g>
        <g id="mm-btn-f1" style="cursor: pointer;" transform="translate(0, 57)">
          <rect width="32" height="16" rx="4" fill="transparent" stroke="#3A4E78" stroke-width="1"/>
          <text x="16" y="11" text-anchor="middle" fill="#8B95B4">1F</text>
        </g>
      </g>
    </svg>
    <div id="mm-edit-toolbar" style="display:none; position:absolute; top:6px; left:6px; z-index:20; gap:6px; align-items:center; background:rgba(6,12,32,0.8); border:1px solid rgba(90,127,255,0.4); border-radius:8px; padding:5px 8px; font-family:'Noto Sans JP',sans-serif; font-size:10px; color:#c7d2f0; backdrop-filter:blur(6px);">
      <span style="font-weight:700; color:#55ff7f; white-space:nowrap;">✎ 編集モード</span>
      <label style="display:flex; align-items:center; gap:3px; cursor:pointer; white-space:nowrap;">
        <input type="checkbox" id="mm-edit-oneway" style="margin:0;"> 片方向のみ
      </label>
      <button id="mm-edit-export" style="background:#1a2c52; border:1px solid #3a4e78; color:#e9edf7; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:10px;">書き出し</button>
      <button id="mm-edit-clear" style="background:#3a1a1a; border:1px solid #7a3a3a; color:#e9edf7; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:10px;">クリア</button>
    </div>
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
          line.setAttribute('id', `mm-edge-${edgeKey}`);
          // 💡 SVG端の25px余白に適合させるオフセット処理
          line.setAttribute('x1', node.mmX + 25);
          line.setAttribute('y1', node.mmY + 25);
          line.setAttribute('x2', targetNode.mmX + 25);
          line.setAttribute('y2', targetNode.mmY + 25);
          line.setAttribute('stroke', 'rgba(90, 127, 255, 0.4)');
          line.setAttribute('stroke-width', '4');
          line.setAttribute('stroke-dasharray', '2,2');
          
          line.dataset.floor = Math.min(node.floor, targetNode.floor);

          edgesGroup.appendChild(line);
          drawnEdges.add(edgeKey);
        }
      }
    });

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('id', `mm-dot-${node.id}`);
    // 💡 SVG端の25px余白に適合させるオフセット処理
    circle.setAttribute('cx', node.mmX + 25);
    circle.setAttribute('cy', node.mmY + 25);
    circle.setAttribute('r', '14'); 
    circle.setAttribute('fill', 'rgba(30, 45, 90, 0.8)');
    circle.setAttribute('stroke', 'rgba(90, 127, 255, 0.6)');
    circle.setAttribute('stroke-width', '3');
    
    circle.dataset.floor = node.floor;

    nodesGroup.appendChild(circle);
  }

  setupMinimapInteractions();
  setupEditToolbar();
}

function syncPlayerVisibility() {
  const currentNode = NODES[currentId];
  const isCurrentFloor = currentNode && currentNode.floor === currentMinimapFloor;
  const player = $('mm-player');
  if (player) player.style.display = isCurrentFloor ? 'block' : 'none';
}

function syncFloorTitle() {
  // 💡 現在地ノードの building プロパティから館名を判定する。
  //    フロア番号そのものが変わらない移動（同フロア内で別棟へ渡る等）でも
  //    必ず再評価されるよう、updateMinimapFloor から独立させている。
  const bMap = { 'North': '北館', 'Main': '本館', 'South': '南館' };
  const locatedNode = NODES[currentId];
  const buildingName = (locatedNode && bMap[locatedNode.building]) || '本館';
  const floorTitle = $('mm-floor-title');
  if (floorTitle) floorTitle.textContent = `${buildingName}${currentMinimapFloor}F`;
}

function updateMinimapFloor(floorNumber) {
  if (floorNumber === currentMinimapFloor) {
    // フロア番号自体は変わらなくても、実際にいる階・棟は
    // 呼び出しタイミングによって変化しているため、表示同期だけは必ず行う
    syncPlayerVisibility();
    syncFloorTitle();
    return;
  }
  currentMinimapFloor = floorNumber;

  const bgMap = $('mm-bg-map');
  if (bgMap) bgMap.setAttribute('href', `../maps/${floorNumber}F.svg`);
  syncFloorTitle();

  const dots = Array.from($('mm-nodes-group').children);
  dots.forEach(dot => {
    if (parseInt(dot.dataset.floor) === floorNumber) {
      dot.style.display = 'block';
    } else {
      dot.style.display = 'none';
    }
  });

  const edges = Array.from($('mm-edges-group').children);
  edges.forEach(edge => {
    if (parseInt(edge.dataset.floor) === floorNumber) {
      edge.style.display = 'block';
    } else {
      edge.style.display = 'none';
    }
  });

  [1, 2, 3, 4].forEach(f => {
    const btnRect = $(`mm-btn-f${f}`).querySelector('rect');
    const btnText = $(`mm-btn-f${f}`).querySelector('text');
    if (f === floorNumber) {
      btnRect.setAttribute('fill', '#43E8C8');
      btnRect.setAttribute('stroke', '#fff');
      btnText.setAttribute('fill', '#313131');
    } else {
      btnRect.setAttribute('fill', 'rgba(30, 45, 90, 0.8)');
      btnRect.setAttribute('stroke', '#3A4E78');
      btnText.setAttribute('fill', '#8B95B4');
    }
  });

  syncPlayerVisibility();
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

  applyMinimapTransform();
}

function applyMinimapTransform() {
  const group = $('mm-transform-group');
  if (group) {
    group.setAttribute('transform', `translate(${mmPanX}, ${mmPanY}) scale(${mmScale})`);
  }
  
  const player = $('mm-player');
  const arrow = $('mm-arrow');
  
  const activeNodeId = (typeof walkPhase !== 'undefined' && walkPhase === 'walk' && nextId) ? nextId : currentId;
  const currentNode = NODES[activeNodeId];

  if (player && currentNode) {
    // 💡 プレイヤーピンも描画に合わせるため、基準座標に + 25 を付与する
    let currentMMX = currentNode.mmX + 25;
    let currentMMY = currentNode.mmY + 25;

    if (typeof walkPhase !== 'undefined' && walkPhase === 'walk' && mmSrcNode) {
      const srcX = mmSrcNode.mmX + 25;
      const srcY = mmSrcNode.mmY + 25;
      const dstX = currentNode.mmX + 25;
      const dstY = currentNode.mmY + 25;
      currentMMX = srcX + (dstX - srcX) * walkT;
      currentMMY = srcY + (dstY - srcY) * walkT;
    }

    const screenX = currentMMX * mmScale + mmPanX;
    const screenY = currentMMY * mmScale + mmPanY;
    
    player.setAttribute('transform', `translate(${screenX}, ${screenY})`);

    if (arrow && typeof yaw !== 'undefined') {
      const deg = (yaw * 180) / Math.PI;
      arrow.setAttribute('transform', `rotate(${deg}, 0, 0)`);
    }
  }
}

function focusCurrentNodeOnMinimap() {
  const currentNode = NODES[currentId];
  if (!currentNode) return;
  // 💡 +25px されたノードの中心に追従フォーカスさせる計算
  mmPanX = 95 - (currentNode.mmX + 25) * mmScale; 
  mmPanY = 80 - (currentNode.mmY + 25) * mmScale;
  applyMinimapTransform();
}

/* --- 編集モード共通ヘルパー --- */

// クライアント座標（clientX/Y）を、ミニマップSVGの描画座標系（pan/zoom適用後、+25オフセット込み）に変換
function minimapClientToSvg(clientX, clientY) {
  const rect = $('hud-minimap-svg').getBoundingClientRect();
  const scaleX = rect.width / 260;
  const scaleY = rect.height / 160;
  const mouseX = (clientX - rect.left) / scaleX;
  const mouseY = (clientY - rect.top) / scaleY;
  return {
    x: (mouseX - mmPanX) / mmScale,
    y: (mouseY - mmPanY) / mmScale
  };
}

// 現在表示中のフロア上で、指定座標に最も近いノード（実データ＋下書き）のIDを返す
function findClosestNodeOnFloor(svgX, svgY, maxDist) {
  let closestId = null, minDist = Infinity;
  const pools = [NODES, draftNodes];
  for (const pool of pools) {
    for (const id in pool) {
      const node = pool[id];
      if (node.floor !== currentMinimapFloor) continue;
      const dx = (node.mmX + 25) - svgX;
      const dy = (node.mmY + 25) - svgY;
      const dist = Math.hypot(dx, dy);
      if (dist < minDist && dist < maxDist) { minDist = dist; closestId = id; }
    }
  }
  return closestId;
}

function getNodeAnyPool(id) {
  return NODES[id] || draftNodes[id];
}

/* --- 編集モードの中核ロジック --- */

// main.js の設定パネルから呼び出される、編集モードのON/OFF切り替え
function setMinimapEditMode(on) {
  editMode = !!on;
  clearEdgeSourceHighlight();
  edgeSourceId = null;
  removeEditPopups();

  const toolbar = $('mm-edit-toolbar');
  if (toolbar) toolbar.style.display = editMode ? 'flex' : 'none';

  const mask = $('mm-drag-mask');
  if (mask) mask.style.cursor = editMode ? 'crosshair' : 'grab';
}

function removeEditPopups() {
  ['mm-node-info-popup', 'mm-export-panel'].forEach(id => { const el = $(id); if (el) el.remove(); });
}

function highlightEdgeSource(nodeId) {
  const dot = $(`mm-dot-${nodeId}`);
  if (dot) { dot.setAttribute('stroke', '#55ff7f'); dot.setAttribute('stroke-width', '5'); }
}

function clearEdgeSourceHighlight() {
  if (!edgeSourceId) return;
  const dot = $(`mm-dot-${edgeSourceId}`);
  if (dot) {
    const isDraft = dot.dataset.draft === '1';
    dot.setAttribute('stroke', isDraft ? '#ffa726' : 'rgba(90, 127, 255, 0.6)');
    dot.setAttribute('stroke-width', '3');
  }
}

// 編集モード中の「クリックのみ（ドラッグではない）」操作：ノード選択→2個目クリックでリンク作成
function handleEditModeClick(clientX, clientY) {
  const svg = minimapClientToSvg(clientX, clientY);
  const hitId = findClosestNodeOnFloor(svg.x, svg.y, 20);

  if (!hitId) {
    clearEdgeSourceHighlight();
    edgeSourceId = null;
    return;
  }

  if (edgeSourceId === null) {
    edgeSourceId = hitId;
    highlightEdgeSource(hitId);
  } else if (edgeSourceId === hitId) {
    clearEdgeSourceHighlight();
    edgeSourceId = null;
  } else {
    createDraftLink(edgeSourceId, hitId);
    clearEdgeSourceHighlight();
    edgeSourceId = null;
  }
}

// 編集モード中の右クリック：既存ノード上→座標情報、空白→新規下書きノード作成
function handleEditModeContextMenu(clientX, clientY) {
  const svg = minimapClientToSvg(clientX, clientY);
  const hitId = findClosestNodeOnFloor(svg.x, svg.y, 20);

  if (hitId) {
    showNodeInfoPopup(hitId);
  } else {
    createDraftNodeAt(svg.x, svg.y);
  }
}

function showNodeInfoPopup(nodeId) {
  const node = getNodeAnyPool(nodeId);
  if (!node) return;
  removeEditPopups();

  const bMap = { 'North': '北館', 'Main': '本館', 'South': '南館' };
  const buildingLabel = bMap[node.building] || node.building || '-';
  const [px, py, pz] = node.pos3D;
  const coordText = `[${px}, ${py}, ${pz}]`;

  const modal = document.createElement('div');
  modal.id = 'mm-node-info-popup';
  modal.style.cssText = `
    position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    background:#121c38; border:1.5px solid #3a4e78; border-radius:8px; padding:16px;
    color:#e9edf7; font-family:'Noto Sans JP',sans-serif; font-size:12px; text-align:left;
    box-shadow:0 4px 20px rgba(0,0,0,0.5); z-index:10000; min-width:220px;
  `;
  modal.innerHTML = `
    <div style="font-weight:bold; margin-bottom:8px; letter-spacing:0.04em; color:#55ff7f;">${node.isDraft ? '（下書き）' : ''}${node.name || nodeId}</div>
    <div style="line-height:1.9; color:#c7d2f0;">
      <div>ID: <code style="color:#fff;">${nodeId}</code></div>
      <div>棟・階: ${buildingLabel} ${node.floor}F</div>
      <div>pos3D: <code id="mm-info-coord" style="color:#fff;">${coordText}</code></div>
    </div>
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
      <button id="mm-info-copy" style="background:#1a2c52; border:1px solid #3a4e78; color:#e9edf7; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px;">座標をコピー</button>
      <button id="mm-info-close" style="background:#223154; border:1px solid #3a4e78; color:#8b95b4; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px;">閉じる</button>
    </div>
  `;

  const targetContainer = $('hud-minimap-container') || document.body;
  targetContainer.appendChild(modal);

  $('mm-info-copy').addEventListener('click', ev => {
    ev.stopPropagation();
    const text = `[${px}, ${py}, ${pz}]`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    const btn = $('mm-info-copy');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'コピーしました';
      setTimeout(() => { const b = $('mm-info-copy'); if (b) b.textContent = orig; }, 1200);
    }
  });
  $('mm-info-close').addEventListener('click', ev => { ev.stopPropagation(); modal.remove(); });
}

function createDraftNodeAt(svgX, svgY) {
  const rawMMX = svgX - 25;
  const rawMMY = svgY - 25;
  const worldX = (rawMMX - MINIMAP_OFFSET_X) / MINIMAP_SCALE;
  const worldZ = (rawMMY - MINIMAP_OFFSET_Y) / MINIMAP_SCALE;

  const yBaseByFloor = {
    1: (typeof Y_BASE_1 !== 'undefined' ? Y_BASE_1 : 0),
    2: (typeof Y_BASE_2 !== 'undefined' ? Y_BASE_2 : 80),
    3: (typeof Y_BASE_3 !== 'undefined' ? Y_BASE_3 : 160),
    4: (typeof Y_BASE_4 !== 'undefined' ? Y_BASE_4 : 240)
  };
  const worldY = yBaseByFloor[currentMinimapFloor] || 0;

  const defaultName = `新規ノード${draftNodeSeq}`;
  const inputName = window.prompt('新しいノードの名前を入力してください（キャンセルで中止）', defaultName);
  if (inputName === null) return;

  const id = `draft_${currentMinimapFloor}_${draftNodeSeq}`;
  draftNodeSeq++;

  const refNode = NODES[currentId];
  const building = refNode ? refNode.building : 'North';

  const node = {
    id,
    name: inputName || defaultName,
    sub: '',
    building,
    floor: currentMinimapFloor,
    pos3D: [Math.round(worldX * 100) / 100, worldY, Math.round(worldZ * 100) / 100],
    mmX: rawMMX,
    mmY: rawMMY,
    links: [],
    isDraft: true
  };
  draftNodes[id] = node;

  addDraftNodeVisual(node);
  updateExportPanelIfOpen();
}

function addDraftNodeVisual(node) {
  const nodesGroup = $('mm-nodes-group');
  if (!nodesGroup) return;
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('id', `mm-dot-${node.id}`);
  circle.setAttribute('cx', node.mmX + 25);
  circle.setAttribute('cy', node.mmY + 25);
  circle.setAttribute('r', '14');
  circle.setAttribute('fill', 'rgba(255,167,38,0.35)');
  circle.setAttribute('stroke', '#ffa726');
  circle.setAttribute('stroke-width', '3');
  circle.setAttribute('stroke-dasharray', '3,2');
  circle.dataset.floor = node.floor;
  circle.dataset.draft = '1';
  circle.style.display = (node.floor === currentMinimapFloor) ? 'block' : 'none';
  nodesGroup.appendChild(circle);
}

function createDraftLink(fromId, toId) {
  const onewayEl = $('mm-edit-oneway');
  const oneway = !!(onewayEl && onewayEl.checked);
  const already = draftLinks.some(l =>
    (l.from === fromId && l.to === toId) || (!l.oneway && l.from === toId && l.to === fromId)
  );
  if (already) return;

  draftLinks.push({ from: fromId, to: toId, oneway });
  addDraftLinkVisual(fromId, toId, draftLinks.length - 1);
  updateExportPanelIfOpen();
}

function addDraftLinkVisual(fromId, toId, index) {
  const edgesGroup = $('mm-edges-group');
  const fromNode = getNodeAnyPool(fromId);
  const toNode = getNodeAnyPool(toId);
  if (!edgesGroup || !fromNode || !toNode) return;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('id', `mm-draft-edge-${index}`);
  line.setAttribute('x1', fromNode.mmX + 25);
  line.setAttribute('y1', fromNode.mmY + 25);
  line.setAttribute('x2', toNode.mmX + 25);
  line.setAttribute('y2', toNode.mmY + 25);
  line.setAttribute('stroke', '#ffa726');
  line.setAttribute('stroke-width', '3');
  line.setAttribute('stroke-dasharray', '5,3');
  const floor = Math.min(fromNode.floor, toNode.floor);
  line.dataset.floor = floor;
  line.dataset.draft = '1';
  line.style.display = (floor === currentMinimapFloor) ? 'block' : 'none';
  edgesGroup.appendChild(line);
}

function clearDrafts() {
  if (!window.confirm('下書きの頂点・辺をすべて削除します。よろしいですか？')) return;
  draftNodes = {};
  draftLinks = [];
  edgeSourceId = null;
  draftNodeSeq = 1;

  const nodesGroup = $('mm-nodes-group');
  const edgesGroup = $('mm-edges-group');
  if (nodesGroup) Array.from(nodesGroup.children).forEach(el => { if (el.dataset.draft === '1') el.remove(); });
  if (edgesGroup) Array.from(edgesGroup.children).forEach(el => { if (el.dataset.draft === '1') el.remove(); });

  updateExportPanelIfOpen();
}

// 追加した下書き（頂点・辺）を、既存のJSONスキーマに沿ったテキストとして書き出す
function buildExportText() {
  const directedEdges = [];
  draftLinks.forEach(l => {
    directedEdges.push({ from: l.from, to: l.to });
    if (!l.oneway) directedEdges.push({ from: l.to, to: l.from });
  });

  const newNodesObj = {};
  Object.values(draftNodes).forEach(n => {
    newNodesObj[n.id] = {
      name: n.name, sub: n.sub || '', imageFile: '__TODO__.jpg',
      building: n.building, floor: n.floor, initYaw: 0, mmIdx: null,
      pos3D: n.pos3D, links: []
    };
  });

  const appendToExisting = {};
  directedEdges.forEach(e => {
    const entry = { targetId: e.to, label: '', hint: '' };
    if (newNodesObj[e.from]) {
      if (!newNodesObj[e.from].links.some(x => x.targetId === e.to)) newNodesObj[e.from].links.push(entry);
    } else if (NODES[e.from]) {
      if (!appendToExisting[e.from]) appendToExisting[e.from] = [];
      if (!appendToExisting[e.from].some(x => x.targetId === e.to)) appendToExisting[e.from].push(entry);
    }
  });

  let text = '';
  if (Object.keys(newNodesObj).length) {
    text += '// ① 新規ノード：該当フロアのJSONファイルの "nodes" オブジェクトへ追加してください\n';
    text += JSON.stringify(newNodesObj, null, 2) + '\n\n';
  }
  if (Object.keys(appendToExisting).length) {
    text += '// ② 既存ノードの links 配列に、それぞれ追記してください\n';
    for (const id in appendToExisting) {
      text += `// --- ${id} ---\n` + JSON.stringify(appendToExisting[id], null, 2) + '\n\n';
    }
  }
  return text || '（まだ下書きの頂点・辺がありません）';
}

function toggleExportPanel() {
  const existing = $('mm-export-panel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'mm-export-panel';
  panel.style.cssText = `
    position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    background:#121c38; border:1.5px solid #3a4e78; border-radius:8px; padding:16px;
    color:#e9edf7; font-family:'Noto Sans JP',sans-serif; font-size:11px;
    box-shadow:0 4px 20px rgba(0,0,0,0.5); z-index:10000; width:360px; max-width:88%;
  `;
  panel.innerHTML = `
    <div style="font-weight:bold; margin-bottom:8px; color:#55ff7f;">下書きの書き出し</div>
    <textarea id="mm-export-text" readonly style="width:100%; height:220px; background:#0a0f24; color:#c7d2f0; border:1px solid #3a4e78; border-radius:6px; padding:8px; font-family:monospace; font-size:10px; resize:vertical;"></textarea>
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
      <button id="mm-export-copy" style="background:#1a2c52; border:1px solid #3a4e78; color:#e9edf7; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px;">全体をコピー</button>
      <button id="mm-export-close" style="background:#223154; border:1px solid #3a4e78; color:#8b95b4; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:11px;">閉じる</button>
    </div>
  `;

  const targetContainer = $('hud-minimap-container') || document.body;
  targetContainer.appendChild(panel);

  $('mm-export-text').value = buildExportText();

  $('mm-export-copy').addEventListener('click', ev => {
    ev.stopPropagation();
    const ta = $('mm-export-text');
    ta.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).catch(() => {});
    }
    const btn = $('mm-export-copy');
    const orig = btn.textContent;
    btn.textContent = 'コピーしました';
    setTimeout(() => { const b = $('mm-export-copy'); if (b) b.textContent = orig; }, 1200);
  });
  $('mm-export-close').addEventListener('click', ev => { ev.stopPropagation(); panel.remove(); });
}

function updateExportPanelIfOpen() {
  const ta = $('mm-export-text');
  if (ta) ta.value = buildExportText();
}

function setupEditToolbar() {
  const exportBtn = $('mm-edit-export');
  if (exportBtn) exportBtn.addEventListener('click', e => { e.stopPropagation(); toggleExportPanel(); });
  const clearBtn = $('mm-edit-clear');
  if (clearBtn) clearBtn.addEventListener('click', e => { e.stopPropagation(); clearDrafts(); });
}

/* --- ミニマップ内操作イベント --- */
function setupMinimapInteractions() {
  const mmMask = $('mm-drag-mask');
  if (!mmMask) return;

  mmMask.addEventListener('pointerdown', e => {
    isMMDragging = true;
    mmDragMoved = false;
    mmStartX = e.clientX - mmPanX;
    mmStartY = e.clientY - mmPanY;
    mmMask.setPointerCapture(e.pointerId);
    mmMask.style.cursor = editMode ? 'crosshair' : 'grabbing';
    e.stopPropagation(); 
  });
  mmMask.addEventListener('pointermove', e => {
    if (!isMMDragging) return;
    const newPanX = e.clientX - mmStartX;
    const newPanY = e.clientY - mmStartY;
    if (Math.abs(newPanX - mmPanX) + Math.abs(newPanY - mmPanY) > 2) mmDragMoved = true;
    mmPanX = newPanX;
    mmPanY = newPanY;
    applyMinimapTransform();
    e.stopPropagation();
  });
  mmMask.addEventListener('pointerup', e => {
    isMMDragging = false;
    mmMask.style.cursor = editMode ? 'crosshair' : 'grab';
    if (editMode && !mmDragMoved) {
      handleEditModeClick(e.clientX, e.clientY);
    }
    e.stopPropagation();
  });

  mmMask.addEventListener('contextmenu', e => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    handleEditModeContextMenu(e.clientX, e.clientY);
  });

  mmMask.addEventListener('dblclick', e => {
    if (editMode) return; // 編集モード中は既存のテレポート確認モーダルを出さない
    if (walkPhase !== 'idle') return; 
    e.stopPropagation();

    const rect = $('hud-minimap-svg').getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scaleX = rect.width / 260;
    const scaleY = rect.height / 160;

    const clickSVGX = ((mouseX / scaleX) - mmPanX) / mmScale;
    const clickSVGY = ((mouseY / scaleY) - mmPanY) / mmScale;

    let closestNodeId = null;
    let minDist = Infinity;

    for (let id in NODES) {
      const node = NODES[id];
      if (node.floor !== currentMinimapFloor) continue;

      // 💡 描画座標 (+25) とクリック逆シミュレート座標の距離を算出
      const dx = (node.mmX + 25) - clickSVGX;
      const dy = (node.mmY + 25) - clickSVGY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist && dist < 100) { 
        minDist = dist;
        closestNodeId = id;
      }
    }

    if (closestNodeId && closestNodeId !== currentId) {
      const targetNode = NODES[closestNodeId];

      const oldModal = $('mm-tp-modal');
      if (oldModal) oldModal.remove();

      const modal = document.createElement('div');
      modal.id = 'mm-tp-modal';
      modal.style = `
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        background: #121c38;
        border: 1.5px solid #3a4e78;
        border-radius: 8px;
        padding: 16px;
        color: #e9edf7;
        font-family: 'Noto Sans JP', sans-serif;
        font-size: 12px;
        text-align: center;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        z-index: 10000;
        min-width: 180px;
      `;
      
      modal.innerHTML = `
        <div style="margin-bottom: 14px; font-weight: bold; letter-spacing: 0.04em;">
          「${targetNode.name}」へ<br>移動しますか？
        </div>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button id="mm-tp-yes" style="background: #43e8c8; color: #08302a; border: none; padding: 6px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">はい</button>
          <button id="mm-tp-no" style="background: #223154; color: #8b95b4; border: 1px solid #3a4e78; padding: 6px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">いいえ</button>
        </div>
      `;

      const targetContainer = $('hud-minimap-container') || document.body;
      targetContainer.style.position = 'relative'; 
      targetContainer.appendChild(modal);

      $('mm-tp-yes').addEventListener('click', (ev) => {
        ev.stopPropagation();
        modal.remove();
        if (typeof loadInitial === 'function') {
          loadInitial(closestNodeId);
        }
      });

      $('mm-tp-no').addEventListener('click', (ev) => {
        ev.stopPropagation();
        modal.remove();
      });
    }
  });

  [1, 2, 3, 4].forEach(f => {
    $(`mm-btn-f${f}`).addEventListener('click', e => {
      e.stopPropagation();
      updateMinimapFloor(f);
    });
  });

  function changeMMZoom(zoomIn, anchorX, anchorY) {
    const zoomFactor = 1.2;
    const oldScale = mmScale;
    if (zoomIn) {
      mmScale = Math.min(2.0, mmScale * zoomFactor);
    } else {
      mmScale = Math.max(0.02, mmScale / zoomFactor);
    }
    mmPanX = anchorX - (anchorX - mmPanX) * (mmScale / oldScale);
    mmPanY = anchorY - (anchorY - mmPanY) * (mmScale / oldScale);
    applyMinimapTransform();
  }

  $('hud-minimap-svg').addEventListener('wheel', e => {
    e.preventDefault();
    e.stopPropagation(); 
    const rect = $('hud-minimap-svg').getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const scaleX = rect.width / 260;
    const scaleY = rect.height / 160;

    changeMMZoom(e.deltaY < 0, mouseX / scaleX, mouseY / scaleY);
  }, { passive: false });

  $('mm-btn-zoom-in').addEventListener('click', e => {
    e.stopPropagation();
    changeMMZoom(true, 92, 80);
  });

  $('mm-btn-zoom-out').addEventListener('click', e => {
    e.stopPropagation();
    changeMMZoom(false, 92, 80);
  });
}

/**
 * メインループ（animate内）から呼び出されるパルス表現用アップデート
 */
function updateMinimapPulse(dt) {
  // SVG内のインライン<animate>タグ要素が自動動作するため空にしています。
}

/*
// 初期化フック
document.addEventListener('DOMContentLoaded', () => {
  initMinimapLayout();
});
*/