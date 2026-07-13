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

/* --- ミニマップ構築 --- */
function initMinimapLayout() {
  // グローバル変数 window.NODES がロード後であることを確認
  if (!window.NODES || Object.keys(window.NODES).length === 0) {
    console.error("NODESがまだ準備できていません。初期化順序を見直してください。");
    return;
  }
  
  const container = $('hud-minimap-container');
  if (!container) return;

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
          <stop offset="0%" stop-color="#101C3A"/>
          <stop offset="100%" stop-color="#070B18"/>
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
}

function updateMinimapFloor(floorNumber) {
  if (floorNumber === currentMinimapFloor) return;
  currentMinimapFloor = floorNumber;

  // 💡 アクティブな建物ボタンから文字列（「北館」「本館」「南館」）を取得
  let buildingName = "本館"; 
  ['north', 'main', 'south'].forEach(b => {
    const btn = $(`mm-btn-${b}`);
    if (btn) {
      const rect = btn.querySelector('rect');
      if (rect && rect.getAttribute('fill') !== 'transparent') {
        const textNode = btn.querySelector('text');
        if (textNode) buildingName = textNode.textContent; 
      }
    }
  });

  const bgMap = $('mm-bg-map');
  const floorTitle = $('mm-floor-title');
  if (bgMap) bgMap.setAttribute('href', `../maps/${floorNumber}F.svg`);
  
  // 💡 指定形式「FLOOR MAP (●館●F)」に更新
  if (floorTitle) floorTitle.textContent = `${buildingName}${floorNumber}F`;

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

  const currentNode = NODES[currentId];
  const isCurrentFloor = currentNode && currentNode.floor === floorNumber;
  $('mm-player').style.display = isCurrentFloor ? 'block' : 'none';
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

/* --- ミニマップ内操作イベント --- */
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

  mmMask.addEventListener('dblclick', e => {
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