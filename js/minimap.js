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
let mmDragScaleX = 1; // ドラッグ開始時に計測する「実描画px ÷ viewBox単位」の倍率
let mmDragScaleY = 1;
let currentMinimapFloor = null; 
let mmPulseT = 0; // メインループからのdt蓄積用

/* --- ピンチズーム（マルチタッチ）用の状態変数 --- */
let mmActivePointers = new Map(); // pointerId -> {x, y} （現在押下中の全ポインタのclientX/Y）
let isMMPinching = false;
let mmPinchStartDist = 0;   // ピンチ開始時の2点間距離(px)
let mmPinchStartScale = 1;  // ピンチ開始時のmmScale
let mmPinchStartPanX = 0;   // ピンチ開始時のmmPanX
let mmPinchStartPanY = 0;
let mmPinchStartMidX = 0;   // ピンチ開始時の中点（SVG描画座標系、pan/zoom適用前）
let mmPinchStartMidY = 0;

/* --- 編集モード（頂点・辺の追加支援）用の状態変数 --- */
let editMode = false;
let draftNodes = {};      // id -> {id, name, sub, building, floor, pos3D:[x,y,z], mmX, mmY, links, isDraft:true}
let draftLinks = [];      // {from, to, oneway}
let edgeSourceId = null;  // リンク作成で「1つ目にクリックしたノード」を保持
let draftNodeSeq = 1;
let mmDragMoved = false;  // pointerdown〜upの間に実際に動いたか（クリックかドラッグかの判定用）

// ダブルタップ判定用
let mmLastTapTime = 0;
let mmLastTapX = 0;
let mmLastTapY = 0;

/* ============================================================
   ミニマップ内UI（ズームボタン・フロアボタン・サイズ設定ボタン）の
   サイズ・余白の定数
   ------------------------------------------------------------
   これらはSVGの viewBox 座標系での「単位」で表す。viewBoxの幅は
   レイアウト比率（上下/左右分割のドラッグ）によって可変になるため、
   何も対策しないとviewBox全体が拡大縮小するのと一緒にこのUIパーツの
   実際の画面上のサイズも一緒に変わってしまう。

   💡 画面サイズに関係なく、常に固定の画面ピクセルサイズにする方式：
   ユーザーが選んだ段階(S/M/L)の倍率と、実際の描画スケール(px/unit)を
   打ち消す係数(MM_UI_REFERENCE_PX_PER_UNIT分)を掛け合わせることで、
   レイアウト比率や画面サイズが何であっても同じ大きさ・同じ余白で
   表示されるようにしている（詳細は resizeMinimapViewport() 内のコメント参照）。
============================================================ */

// 基準スケール：右下表示(corner)デフォルト時の実測値（幅520px ÷ viewBox幅260units = 2px/unit）
const MM_UI_REFERENCE_PX_PER_UNIT = 2;

// 💡 style.css の #hud-minimap { transition: all 0.3s ease; } と対応する値。
//    レイアウト切り替え直後はこのトランジションの途中で#hud-minimapのサイズが
//    まだ変化し続けているため、その瞬間にgetBoundingClientRect()で測ると
//    古い(または中途半端な)サイズを拾ってしまい、UIパーツのサイズ計算が狂う。
//    トランジション完了後にもう一度測り直すための待ち時間として使う。
//    style.css側の秒数を変えたら、ここも合わせて変更すること。
const MM_LAYOUT_TRANSITION_MS = 300;
let mmLayoutSettleTimer = null;

// サイズ段階（1.0 = 元のデザインサイズ）。画面サイズによる自動判定はせず、
// ユーザーがサイズ設定ボタンで選んだ段階をそのまま使う
const MM_UI_SIZE_TIERS = [
  { id: 'S', label: 'S', scale: 0.8 },
  { id: 'M', label: 'M', scale: 1.0 },
  { id: 'L', label: 'L', scale: 1.25 },
];

// サイズ設定ボタンをクリックした時に巡回する順番
const MM_UI_SIZE_CYCLE = ['S', 'M', 'L'];

// 'S' | 'M' | 'L'。起動時にmain.js側の保存設定があれば
// initMinimapLayout()内で上書きする（minimap.jsはmain.jsより先に読み込まれるため、
// この時点ではまだ savedUserSettings は参照できない）
let mmUiSizeLevel = 'M';

// ズームボタン（左下に配置。マージンは常に固定pxになるよう、基準スケールでの値を持つ）
const MM_ZOOM_BTN_WIDTH = 42;
const MM_ZOOM_BTN_HEIGHT = 20;
const MM_ZOOM_BTN_MARGIN_LEFT = 12;   // 左端からの余白（基準スケールでのunits）
const MM_ZOOM_BTN_MARGIN_BOTTOM = 8;  // 下端からの余白（基準スケールでのunits）

// フロアボタン（右端・縦方向中央に配置。マージンは常に固定pxになるよう、基準スケールでの値を持つ）
const MM_FLOOR_BTN_WIDTH = 32;
const MM_FLOOR_BTN_HEIGHT = 16;
const MM_FLOOR_BTN_GAP = 3;               // ボタン同士の隙間
const MM_FLOOR_BTN_STEP = MM_FLOOR_BTN_HEIGHT + MM_FLOOR_BTN_GAP; // 1つ分の送り幅
const MM_FLOOR_BTN_MARGIN_RIGHT = 12;     // 右端からの余白（基準スケールでのunits）
const MM_FLOOR_LEVELS = [4, 3, 2, 1];     // 上から表示する順（表示ラベルは常に「N階」）
// フロアボタン群全体の高さ（基準スケールでのunits）。縦方向中央寄せの計算に使う
const MM_FLOOR_BTN_GROUP_HEIGHT = (MM_FLOOR_LEVELS.length - 1) * MM_FLOOR_BTN_STEP + MM_FLOOR_BTN_HEIGHT;

// UIサイズ設定ボタン（右下に配置。大きさ・余白ともに常に固定で、S/M/L段階の影響を受けない）
const MM_UI_SIZE_BTN_WIDTH = 34;
const MM_UI_SIZE_BTN_HEIGHT = 16;
const MM_UI_SIZE_BTN_MARGIN_RIGHT = 12;  // 右端からの余白（基準スケールでのunits）
const MM_UI_SIZE_BTN_MARGIN_BOTTOM = 12; // 下端からの余白（基準スケールでのunits）

// フロアボタン group の中身（<g id="mm-btn-fN">...）をまとめて生成する。
// 💡 以前は同じ構造の<g>を4階分そのままコピペしていたため、ボタン幅・高さ・間隔が
//    複数箇所に散らばって重複していた。ここで一括生成することで、サイズ変更は
//    上の定数を直すだけで済むようにしてある。
//    ボタンの id (mm-btn-fN) と中身の構造(rect→text)は、クリック処理・アクティブ状態の
//    ハイライト処理(updateMinimapFloor)が参照しているため変更していない。
function buildFloorButtonsMarkup() {
  return MM_FLOOR_LEVELS.map((floor, i) => `
        <g id="mm-btn-f${floor}" style="cursor: pointer;" transform="translate(0, ${i * MM_FLOOR_BTN_STEP})">
          <rect width="${MM_FLOOR_BTN_WIDTH}" height="${MM_FLOOR_BTN_HEIGHT}" rx="0" fill="transparent" stroke="var(--color-border-secondary)" stroke-width="1"/>
          <text x="${MM_FLOOR_BTN_WIDTH / 2}" y="11" text-anchor="middle" fill="#8B95B4">${floor}F</text>
        </g>`).join('');
}

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
    <svg id="hud-minimap-svg" viewBox="0 0 260 160" width="520" height="320" xmlns="http://www.w3.org/2000/svg" style="user-select: none; touch-action: none; border-radius: 0px; display: block;">
      <defs>
        <clipPath id="mm-panel-clip">
          <rect width="260" height="160" rx="0"/>
        </clipPath>
        <clipPath id="mm-viewport-clip">
          <rect x="0" y="0" width="260" height="160" rx="0"/>
        </clipPath>
        <pattern id="mm-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0 L0 0 0 10" fill="none" stroke="var(--color-border-secondary)" stroke-width="0.4" opacity="0.35"/>
        </pattern>
        <radialGradient id="mm-vignette" cx="35%" cy="35%" r="75%">
          <stop offset="0%" stop-color="var(--color-bg)"/>
          <stop offset="100%" stop-color="var(--color-bg)"/>
        </radialGradient>
      </defs>

      <g clip-path="url(#mm-panel-clip)">
        <rect id="mm-panel-bg-fill" width="260" height="160" fill="url(#mm-vignette)"/>
        <rect id="mm-panel-bg-border" width="260" height="160" stroke="rgba(255,255,255,0.06)" stroke-width="1.5" fill="none"/>
      </g>

      <g clip-path="url(#mm-viewport-clip)">
        <rect id="mm-viewport-bg-grid" width="260" height="160" fill="url(#mm-grid)"/>

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

        <rect id="mm-drag-mask" x="0" y="0" width="260" height="160" fill="transparent" style="cursor: grab;"/>

        <text id="mm-floor-title" x="14" y="15" text-anchor="start" font-size="8" font-family="'Noto Sans JP', sans-serif" font-weight="700" letter-spacing="0.04em" fill="var(--color-text)" pointer-events="none">フロアマップ</text>
      </g>

      <g id="mm-zoom-controls" transform="translate(${MM_ZOOM_BTN_MARGIN_LEFT}, ${160 - MM_ZOOM_BTN_MARGIN_BOTTOM - MM_ZOOM_BTN_HEIGHT})">
        <rect width="${MM_ZOOM_BTN_WIDTH}" height="${MM_ZOOM_BTN_HEIGHT}" rx="6" fill="var(--color-primary-pale)" stroke="var(--color-primary-dark)" stroke-width="1"/>
        <line x1="${MM_ZOOM_BTN_WIDTH / 2}" y1="3" x2="${MM_ZOOM_BTN_WIDTH / 2}" y2="${MM_ZOOM_BTN_HEIGHT - 3}" stroke="var(--color-primary-dark)" stroke-width="1"/>
        <g id="mm-btn-zoom-in" style="cursor: pointer;">
          <rect x="1" y="1" width="${MM_ZOOM_BTN_WIDTH / 2 - 1}" height="${MM_ZOOM_BTN_HEIGHT - 2}" rx="5" fill="transparent"/>
          <path d="M11,6 L11,14 M7,10 L15,10" stroke="var(--color-primary-dark)" stroke-width="1.4" stroke-linecap="round"/>
        </g>
        <g id="mm-btn-zoom-out" style="cursor: pointer;" transform="translate(${MM_ZOOM_BTN_WIDTH / 2}, 0)">
          <rect x="1" y="1" width="${MM_ZOOM_BTN_WIDTH / 2 - 1}" height="${MM_ZOOM_BTN_HEIGHT - 2}" rx="5" fill="transparent"/>
          <path d="M7,10 L15,10" stroke="var(--color-primary-dark)" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </g>

      <g id="mm-floor-buttons" transform="translate(${260 - MM_FLOOR_BTN_MARGIN_RIGHT - MM_FLOOR_BTN_WIDTH}, ${(160 - MM_FLOOR_BTN_GROUP_HEIGHT) / 2})" font-family="'Share Tech Mono', monospace" font-size="8">${buildFloorButtonsMarkup()}
      </g>

      <!-- ミニマップUI(ズーム/フロアボタン)の表示サイズを手動で切り替えるボタン。
           右下に配置。クリックで S→M→L→S... と巡回する -->
      <g id="mm-btn-ui-size" style="cursor: pointer;" transform="translate(${260 - MM_UI_SIZE_BTN_MARGIN_RIGHT - MM_UI_SIZE_BTN_WIDTH}, ${160 - MM_UI_SIZE_BTN_MARGIN_BOTTOM - MM_UI_SIZE_BTN_HEIGHT})">
        <rect width="${MM_UI_SIZE_BTN_WIDTH}" height="${MM_UI_SIZE_BTN_HEIGHT}" rx="4" fill="var(--color-surface-soft)" stroke="var(--color-border)" stroke-width="1"/>
        <text id="mm-ui-size-label" x="${MM_UI_SIZE_BTN_WIDTH / 2}" y="11" text-anchor="middle" font-size="7" font-family="'Share Tech Mono', monospace" fill="var(--color-text-muted)" pointer-events="none">M</text>
      </g>
    </svg>
    <div id="mm-edit-toolbar" style="display:none; position:absolute; top:6px; left:6px; z-index:20; gap:6px; align-items:center; background:rgba(6,12,32,0.8); border:1px solid rgba(90,127,255,0.4); border-radius:0px; padding:5px 8px; font-family:'Noto Sans JP',sans-serif; font-size:10px; color:#c7d2f0; backdrop-filter:blur(6px);">
      <span style="font-weight:700; color:#55ff7f; white-space:nowrap;">✎ 編集モード</span>
      <label style="display:flex; align-items:center; gap:3px; cursor:pointer; white-space:nowrap;">
        <input type="checkbox" id="mm-edit-oneway" style="margin:0;"> 片方向のみ
      </label>
      <button id="mm-edit-export" style="background:#1a2c52; border:1px solid #3a4e78; color:#e9edf7; border-radius:0px; padding:3px 8px; cursor:pointer; font-size:10px;">書き出し</button>
      <button id="mm-edit-clear" style="background:#3a1a1a; border:1px solid #7a3a3a; color:#e9edf7; border-radius:0px; padding:3px 8px; cursor:pointer; font-size:10px;">クリア</button>
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

  // 💡 minimap.jsはmain.jsより先に読み込まれるため、ここで初めて
  //    savedUserSettings（main.js側で定義）を安全に参照できる
  if (typeof savedUserSettings !== 'undefined' && MM_UI_SIZE_CYCLE.includes(savedUserSettings.mmUiSizeLevel)) {
    mmUiSizeLevel = savedUserSettings.mmUiSizeLevel;
    const label = $('mm-ui-size-label');
    if (label) label.textContent = mmUiSizeLevel;
  }

  resizeMinimapDragMask();
  setupMinimapInteractions();
  setupEditToolbar();
}

function syncPlayerVisibility() {
  const currentNode = NODES[currentId];
  const isCurrentFloor = currentNode && currentNode.floor === currentMinimapFloor;
  const player = $('mm-player');
  if (player) player.style.display = isCurrentFloor ? 'block' : 'none';
}

/* ============================================================
   現在ミニマップの中心が見ている座標から、どの棟にいるかを判定する
   ------------------------------------------------------------
   MM_BUILDING_ZONES の座標は mmX/mmY（= pos3D[0]/pos3D[2] を
   MINIMAP_SCALE(3.0)倍したミニマップ上の絶対座標。mm-bg-mapとして
   使っている1F.svg等の平面図と同じ座標系）の単位。
   1F.svg（5690×4370、上が北）から実測した値を初期値として置いて
   いるが、あくまで仮の値。実際の校舎の位置に合わせて微調整が必要
   （特に2F以上は1Fと形状が異なる可能性が高いため要調整）。
============================================================ */
const MM_BUILDING_ZONES = [
  // 北館・本館・南館（メインの3棟）
  { name: '北館', xMin: 20,   xMax: 3630, yMin: 20,   yMax: 510  },
  { name: '本館', xMin: 20,   xMax: 3090, yMin: 1640, yMax: 2490 },
  { name: '南館', xMin: 20,   xMax: 3090, yMin: 3500, yMax: 4350 },
  { name: '南館', xMin: 3140, xMax: 3600, yMin: 3500, yMax: 4350 }, // 南館 東側の別棟部分

  // 体育館（本館の東側、渡り廊下で接続）
  { name: '体育館', xMin: 4040, xMax: 5670, yMin: 800,  yMax: 2130 },

  // 連絡通路（棟と棟をつなぐ渡り廊下）
  { name: '連絡通路', xMin: 925,  xMax: 1105, yMin: 505,  yMax: 1645 }, // 北館-本館 西側
  { name: '連絡通路', xMin: 2905, xMax: 3085, yMin: 505,  yMax: 1645 }, // 北館-本館 東側
  { name: '連絡通路', xMin: 925,  xMax: 1105, yMin: 2485, yMax: 3505 }, // 本館-南館 西側
  { name: '連絡通路', xMin: 2905, xMax: 3085, yMin: 2485, yMax: 3505 }, // 本館-南館 東側
  { name: '連絡通路', xMin: 3085, xMax: 5665, yMin: 2125, yMax: 2245 }, // 本館-体育館
];
const MM_BUILDING_FALLBACK = '外';

// mmX/mmY（ワールド座標）が属する棟名を返す。
// floor引数は今は使っていないが、将来フロアごとにゾーンを切り替えたくなった
// ときにMM_BUILDING_ZONESをフロア別のテーブルに拡張しやすいよう残してある。
function getBuildingAt(mmX, mmY, floor) {
  for (const zone of MM_BUILDING_ZONES) {
    if (mmX >= zone.xMin && mmX <= zone.xMax && mmY >= zone.yMin && mmY <= zone.yMax) {
      return zone.name;
    }
  }
  return MM_BUILDING_FALLBACK;
}

// ミニマップの表示中心（パン・ズーム後）が、ワールド座標(mmX/mmY)でどこに
// 当たるかを逆算する。mm-transform-group の transform（translate→scale）の逆変換。
function getMinimapViewportCenterWorld() {
  const svg = $('hud-minimap-svg');
  const viewBox = svg ? svg.viewBox.baseVal : { width: 260, height: 160 };
  const screenCenterX = viewBox.width / 2;
  const screenCenterY = viewBox.height / 2;
  return {
    x: (screenCenterX - mmPanX) / mmScale,
    y: (screenCenterY - mmPanY) / mmScale,
  };
}

function syncFloorTitle() {
  // 💡 以前は現在地ノードの building プロパティ（＝自分が実際に立っている棟）を
  //    表示していたが、ミニマップをパン/ズームして別の場所を見ているときも
  //    実態に合わせたいので、「今ミニマップの中心に映っている座標」から
  //    棟名を判定するように変更した。
  if (currentMinimapFloor == null) return;
  const center = getMinimapViewportCenterWorld();
  const buildingName = getBuildingAt(center.x, center.y, currentMinimapFloor);
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
      btnRect.setAttribute('fill', 'var(--color-secondary-dark)');
      btnRect.setAttribute('stroke', 'var(--color-surface-soft)');
      btnText.setAttribute('fill', 'var(--color-secondary-pale)');
    } else {
      btnRect.setAttribute('fill', 'var(--color-primary-dark)');
      btnRect.setAttribute('stroke', 'var(--color-text-muted)');
      btnText.setAttribute('fill', 'var(--color-primary)');
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

  // パン・ズームのたびに、ミニマップの中心に今映っている棟名も追従させる
  syncFloorTitle();

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


/* 元々、
260 / 2 - 35
= 130 - 35
= 95
なので、元の 95 を単純に消すのではなく、viewBoxの幅に応じて95相当の位置を計算しています。 */
function focusCurrentNodeOnMinimap() {
    const currentNode = NODES[currentId];
    if (!currentNode) return;

    const svg = $('hud-minimap-svg');
    const viewBox = svg
        ? svg.viewBox.baseVal
        : { width: 260, height: 160 };

    // 元の95pxという位置関係を維持しつつ、
    // viewBoxの横幅に合わせて追従位置を変更する
    mmPanX =
        (viewBox.width / 2 - 35)
        - (currentNode.mmX + 25) * mmScale;

    mmPanY =
        (viewBox.height / 2)
        - (currentNode.mmY + 25) * mmScale;

    applyMinimapTransform();
}

/* --- ミニマップ表示領域の動的調整 --- */
function resizeMinimapViewport() {
    const svg = $('hud-minimap-svg');

    if (!svg) return;

    const VIEWBOX_HEIGHT = 160;

    /*
     * 実際のSVGサイズからviewBoxを決めるのではなく、
     * 現在のレイアウトから表示領域の比率を決める。
     */
    let aspectRatio;

    if (document.body.classList.contains('mm-layout-split-h')) {

        // 左右分割：sv-canvas側の割合(window.splitRatios)から、ミニマップ側の実際の幅比率を逆算する
        // 💡 修正: 分割線をドラッグして比率を変えられるようになったため、0.5固定では
        //    ミニマップの実表示サイズとviewBoxのアスペクト比がズレてしまう
        const minimapFraction = 1 - (window.splitRatios ? window.splitRatios['split-h'] : 0.5);
        aspectRatio = (window.innerWidth * minimapFraction) / window.innerHeight;

    } else if (document.body.classList.contains('mm-layout-split-v')) {

        // 上下分割：同様にミニマップ側の実際の高さ比率を使う
        const minimapFraction = 1 - (window.splitRatios ? window.splitRatios['split-v'] : 0.5);
        aspectRatio = window.innerWidth / (window.innerHeight * minimapFraction);

    } else if (document.body.classList.contains('mm-layout-fullscreen')) {

        // 全画面
        aspectRatio = window.innerWidth / window.innerHeight;

    } else {

        // 右下表示
        aspectRatio = 520 / 320;
    }

    const viewBoxWidth = Math.max(
        40,
        Math.min(
            1000,
            VIEWBOX_HEIGHT * aspectRatio
        )
    );

    svg.setAttribute(
        'viewBox',
        `0 0 ${viewBoxWidth} ${VIEWBOX_HEIGHT}`
    );

    /*
     * viewBoxに合わせて背景・クリップ領域を更新
     */
    const panelClip = svg.querySelector('#mm-panel-clip rect');
    const viewportClip = svg.querySelector('#mm-viewport-clip rect');

    if (panelClip) {
        panelClip.setAttribute('width', viewBoxWidth);
        panelClip.setAttribute('height', VIEWBOX_HEIGHT);
    }

    if (viewportClip) {
        viewportClip.setAttribute('width', viewBoxWidth);
        viewportClip.setAttribute('height', VIEWBOX_HEIGHT);
    }

    // 💡 修正: 従来の '#mm-panel-clip > rect' / '#mm-viewport-clip > rect' は
    //    <clipPath>要素自身の直下（＝上のpanelClip/viewportClipと同じ非表示rect）しか
    //    ヒットしておらず、実際に見えているパネル背景・枠線・グリッドのrect
    //    （clip-pathを"参照する側"の<g>の中にあり、idを持っていなかった）は
    //    幅260のまま更新されていなかった。widthの広いレイアウト（フルスクリーン等）で
    //    260px より右側に背景・グリッドが描画されない不具合になっていたため、
    //    対象のrectに直接idを振って明示的に指定する。
    ['mm-panel-bg-fill', 'mm-panel-bg-border', 'mm-viewport-bg-grid'].forEach(id => {
        const rect = svg.querySelector(`#${id}`);
        if (rect) {
            rect.setAttribute('width', viewBoxWidth);
            rect.setAttribute('height', VIEWBOX_HEIGHT);
        }
    });

    /*
     * フロアボタンを右端へ追従
     */
    const floorButtons = $('mm-floor-buttons');

    /*
     * ズームボタン・フロアボタン・サイズ設定ボタンの位置とサイズを、
     * 画面サイズやレイアウト比率に関係なく常に一定に保つ。
     * 💡 SVGはviewBox基準で内部の要素すべてが一緒に拡大縮小されるため、
     *    何もしないとレイアウト比率や画面サイズが変わるたびにこのUIパーツも
     *    一緒に拡大縮小されてしまう。そこで実際の描画スケール(px/unit)から
     *    逆算した係数(pxCancelScale)でそれを打ち消す。
     *
     *    余白(端からのマージン)は常に固定pxにしたいので pxCancelScale のみを掛ける。
     *    ボタン本体の大きさは、pxCancelScaleに加えてユーザーが選んだ段階(S/M/L)の
     *    倍率も掛けた uiScale を使う → 段階を変えても余白は動かず、ボタンだけ
     *    大きくなる/小さくなる。
     *    ただしサイズ設定ボタン自身(mm-btn-ui-size)は、段階を切り替えている
     *    最中でも自分を見失わないよう、常にpxCancelScaleのみ（=段階の影響を受けない
     *    固定サイズ）を使う。
     */
    const svgRect = svg.getBoundingClientRect();
    const pxPerUnit = svgRect.height > 0
        ? (svgRect.height / VIEWBOX_HEIGHT)
        : MM_UI_REFERENCE_PX_PER_UNIT;
    const pxCancelScale = MM_UI_REFERENCE_PX_PER_UNIT / pxPerUnit;

    const activeTier = MM_UI_SIZE_TIERS.find(t => t.id === mmUiSizeLevel) || MM_UI_SIZE_TIERS[1];
    const uiScale = activeTier.scale * pxCancelScale;

    const zoomControls = $('mm-zoom-controls');
    if (zoomControls) {
        // 左下アンカー：左・下の余白は pxCancelScale のみ（段階に関係なく固定px）、
        // ボタン本体は uiScale（段階に応じて拡大縮小）
        const zx = MM_ZOOM_BTN_MARGIN_LEFT * pxCancelScale;
        const zy = VIEWBOX_HEIGHT
            - (MM_ZOOM_BTN_MARGIN_BOTTOM * pxCancelScale)
            - (MM_ZOOM_BTN_HEIGHT * uiScale);
        zoomControls.setAttribute('transform', `translate(${zx}, ${zy}) scale(${uiScale})`);
    }

    if (floorButtons) {
        // 右端・縦方向中央アンカー：右の余白は pxCancelScale のみ、
        // 縦位置はボタン群全体の高さ(段階で変わる)をもとに中央寄せし直す
        const fx = viewBoxWidth
            - (MM_FLOOR_BTN_MARGIN_RIGHT * pxCancelScale)
            - (MM_FLOOR_BTN_WIDTH * uiScale);
        const fy = (VIEWBOX_HEIGHT - MM_FLOOR_BTN_GROUP_HEIGHT * uiScale) / 2;
        floorButtons.setAttribute('transform', `translate(${fx}, ${fy}) scale(${uiScale})`);
    }

    const uiSizeBtn = $('mm-btn-ui-size');
    if (uiSizeBtn) {
        // 右下アンカー：大きさ・余白とも常に pxCancelScale のみ（S/M/L段階の影響を受けない）
        const sx = viewBoxWidth
            - (MM_UI_SIZE_BTN_MARGIN_RIGHT * pxCancelScale)
            - (MM_UI_SIZE_BTN_WIDTH * pxCancelScale);
        const sy = VIEWBOX_HEIGHT
            - (MM_UI_SIZE_BTN_MARGIN_BOTTOM * pxCancelScale)
            - (MM_UI_SIZE_BTN_HEIGHT * pxCancelScale);
        uiSizeBtn.setAttribute('transform', `translate(${sx}, ${sy}) scale(${pxCancelScale})`);
    }
}

/* --- 編集モード共通ヘルパー --- */

function resizeMinimapDragMask() {
    const svg = $('hud-minimap-svg');
    const mask = $('mm-drag-mask');

    if (!svg || !mask) return;

    const viewBox = svg.viewBox.baseVal;

    if (viewBox.width <= 0 || viewBox.height <= 0) return;

    mask.setAttribute('x', String(viewBox.x));
    mask.setAttribute('y', String(viewBox.y));
    mask.setAttribute('width', String(viewBox.width));
    mask.setAttribute('height', String(viewBox.height));
}

// クライアント座標（clientX/Y）を、ミニマップSVGの描画座標系（pan/zoom適用後、+25オフセット込み）に変換
function minimapClientToSvg(clientX, clientY) {
  const rect = $('hud-minimap-svg').getBoundingClientRect();
  const viewBox = $('hud-minimap-svg').viewBox.baseVal;

  const scaleX = rect.width / viewBox.width;
  const scaleY = rect.height / viewBox.height;
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
/* --- ミニマップのレイアウトモード切り替え --- */
const MM_LAYOUT_MODES = ['split-v', 'split-h', 'fullscreen', 'hidden']; // 'corner'はクラス無しの初期状態

function setMinimapLayout(mode) {
    MM_LAYOUT_MODES.forEach(m => {
        document.body.classList.remove(`mm-layout-${m}`);
    });

    if (mode !== 'corner') {
        document.body.classList.add(`mm-layout-${mode}`);
    }

    // 分割線(#split-divider)のaria-orientationをモードに合わせて更新
    const splitDivider = $('split-divider');
    if (splitDivider) {
        if (mode === 'split-v') {
            splitDivider.setAttribute('aria-orientation', 'horizontal');
        } else if (mode === 'split-h') {
            splitDivider.setAttribute('aria-orientation', 'vertical');
        } else {
            splitDivider.removeAttribute('aria-orientation');
        }
    }

    // レイアウトボタンのactive状態を更新
    if (typeof updateMinimapLayoutUI === 'function') {
        updateMinimapLayoutUI(mode);
    }

    // 1. 3D側のサイズを更新
    if (typeof updateRendererSize === 'function') {
        updateRendererSize();
    }

    // 2. sv-canvasの新しいサイズ・位置にコンパスを合わせる
    updateCompassLayout();

    // 3. ミニマップのviewBoxを更新
    resizeMinimapViewport();

    // 4. 新しいviewBoxにマスクを合わせる
    resizeMinimapDragMask();

    // 5. 新しいviewBoxの中心へ現在地を移動
    if (typeof focusCurrentNodeOnMinimap === 'function') {
        focusCurrentNodeOnMinimap();
    }

    // 6. モード切り替え時にも、境界線/端ボタンの表示状態を最新化しておく
    //    （保存済みの比率が既に0や1の状態で split-v/split-h に切り替わるケースに対応）
    if (typeof updateSplitDividerVisibility === 'function') {
        updateSplitDividerVisibility();
    }

    // 7. 💡 #hud-minimapのCSSトランジション(0.3s)が終わった後にもう一度測り直す。
    //    切り替え直後の即時計算(3〜6)はトランジション開始前の古いサイズを拾って
    //    しまうことがあり、それが「初期表示やレイアウト切り替え直後だけUIサイズが
    //    おかしい（S/M/Lボタンを押すと直る＝再計算すれば直る）」という症状の原因だった。
    clearTimeout(mmLayoutSettleTimer);
    mmLayoutSettleTimer = setTimeout(() => {
        resizeMinimapViewport();
        resizeMinimapDragMask();
        if (typeof focusCurrentNodeOnMinimap === 'function') {
            focusCurrentNodeOnMinimap();
        }
    }, MM_LAYOUT_TRANSITION_MS + 30); // トランジション終了直後の描画ゆらぎを避けるための余裕分
}

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

// ミニマップ上の指定座標から、テレポート確認モーダルを表示する
function handleMinimapTeleport(clientX, clientY) {

    if (editMode) return;
    if (walkPhase !== 'idle') return;

    const svg = minimapClientToSvg(clientX, clientY);

    const closestNodeId = findClosestNodeOnFloor(
        svg.x,
        svg.y,
        100
    );

    if (!closestNodeId || closestNodeId === currentId) return;

    const targetNode = NODES[closestNodeId];

    if (!targetNode) return;

    const oldModal = $('mm-tp-modal');

    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');

    modal.id = 'mm-tp-modal';

    modal.style = `
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        background: #f1f5ff;
        border: 1.5px solid #3a4e78;
        border-radius: 8px;
        padding: 16px;
        color: #342C40;
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
            <button id="mm-tp-yes"
                style="background: #43e8c8; color: #08302a; border: none; padding: 6px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">
                はい
            </button>

            <button id="mm-tp-no"
                style="background: #223154; color: #8b95b4; border: 1px solid #3a4e78; padding: 6px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 11px;">
                いいえ
            </button>
        </div>
    `;

    const targetContainer =
        $('hud-minimap-container') || document.body;

    targetContainer.style.position = 'relative';

    targetContainer.appendChild(modal);

    $('mm-tp-yes').addEventListener('click', ev => {

        ev.stopPropagation();

        modal.remove();

        if (typeof loadInitial === 'function') {
            loadInitial(closestNodeId);
        }

    });

    $('mm-tp-no').addEventListener('click', ev => {

        ev.stopPropagation();

        modal.remove();

    });

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
    background:#121c38; border:1.5px solid #3a4e78; border-radius:0px; padding:16px;
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
    const rect = $('hud-minimap-svg').getBoundingClientRect();
    const viewBox = $('hud-minimap-svg').viewBox.baseVal;

    mmDragScaleX = rect.width / viewBox.width;
    mmDragScaleY = rect.height / viewBox.height;

    mmMask.setPointerCapture(e.pointerId);
    mmActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // 💡 修正: 2本指が触れた時点でピンチズームモードへ移行する。
    //    Pointer Eventsは指ごとに別のpointerIdで発火するため、touchイベントの
    //    e.touchesのように自動でまとめて渡ってこない → 自前でMapに集計する必要がある。
    if (mmActivePointers.size === 2) {
      isMMDragging = false; // パン中だった場合は解除し、ピンチへ切り替える
      isMMPinching = true;
      mmDragMoved = true;   // ピンチ操作の指離しをダブルタップ等と誤認しないようにする

      const pts = Array.from(mmActivePointers.values());
      mmPinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      mmPinchStartScale = mmScale;
      mmPinchStartPanX = mmPanX;
      mmPinchStartPanY = mmPanY;

      const midClientX = (pts[0].x + pts[1].x) / 2;
      const midClientY = (pts[0].y + pts[1].y) / 2;
      // 💡 修正: wheelハンドラと同様に、rect.left/topを引いてSVG要素のローカル座標系に
      //    変換してから割る必要がある。ここが漏れていたため、ミニマップが画面の
      //    左上から離れた位置（右下コーナー配置など）にあるほどズーム中心が
      //    無関係な場所にズレていた。
      mmPinchStartMidX = (midClientX - rect.left) / mmDragScaleX;
      mmPinchStartMidY = (midClientY - rect.top) / mmDragScaleY;

      mmMask.style.cursor = 'zoom-in';
      e.stopPropagation();
      return;
    }

    if (mmActivePointers.size > 2) {
      // 3本目以降の指は無視（ピンチ状態を保つ）
      e.stopPropagation();
      return;
    }

    // ここに来るのは1本指の場合のみ：従来通りパン／クリック判定
    isMMDragging = true;
    mmDragMoved = false;
    mmStartX = (e.clientX / mmDragScaleX) - mmPanX;
    mmStartY = (e.clientY / mmDragScaleY) - mmPanY;
    mmMask.style.cursor = editMode ? 'crosshair' : 'grabbing';
    e.stopPropagation(); 
  });
  mmMask.addEventListener('pointermove', e => {
    if (mmActivePointers.has(e.pointerId)) {
      mmActivePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (isMMPinching) {
      if (mmActivePointers.size < 2) return; // 片方が既に離れているがpointerup未処理の一瞬など
      const pts = Array.from(mmActivePointers.values()).slice(0, 2);
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const ratio = dist / mmPinchStartDist;

      // ピンチ開始時のスケール・パンを起点に毎回計算し直すことで、
      // フレームごとの誤差が積み重なって指の動きとズレていくのを防ぐ
      mmScale = Math.max(0.02, Math.min(2.0, mmPinchStartScale * ratio));
      mmPanX = mmPinchStartMidX - (mmPinchStartMidX - mmPinchStartPanX) * (mmScale / mmPinchStartScale);
      mmPanY = mmPinchStartMidY - (mmPinchStartMidY - mmPinchStartPanY) * (mmScale / mmPinchStartScale);

      applyMinimapTransform();
      e.stopPropagation();
      return;
    }

    if (!isMMDragging) return;
    const newPanX = (e.clientX / mmDragScaleX) - mmStartX;
    const newPanY = (e.clientY / mmDragScaleY) - mmStartY;
    if (Math.abs(newPanX - mmPanX) + Math.abs(newPanY - mmPanY) > 2) mmDragMoved = true;
    mmPanX = newPanX;
    mmPanY = newPanY;
    applyMinimapTransform();
    e.stopPropagation();
  });
  mmMask.addEventListener('pointerup', e => {

    mmActivePointers.delete(e.pointerId);

    if (isMMPinching) {
      if (mmActivePointers.size < 2) {
        // 💡 指を1本以上離してピンチが終わったら、そのままジェスチャーを終了する
        //    （残り1本でパンへ引き継ぐと指の位置ジャンプが起きるため、あえて終了させる）
        isMMPinching = false;
        mmMask.style.cursor = editMode ? 'crosshair' : 'grab';
      }
      e.stopPropagation();
      return;
    }

    isMMDragging = false;

    mmMask.style.cursor = editMode ? 'crosshair' : 'grab';

    if (editMode && !mmDragMoved) {

        handleEditModeClick(
            e.clientX,
            e.clientY
        );

    }

    // 通常モードのダブルタップ判定
    if (!editMode && walkPhase === 'idle' && !mmDragMoved) {

        const now = Date.now();

        const dx = e.clientX - mmLastTapX;
        const dy = e.clientY - mmLastTapY;

        const timeDiff = now - mmLastTapTime;

        const distance = Math.sqrt(dx * dx + dy * dy);

        if (timeDiff < 400 && distance < 30) {

            mmLastTapTime = 0;

            handleMinimapTeleport(
                e.clientX,
                e.clientY
            );

        } else {

            mmLastTapTime = now;

            mmLastTapX = e.clientX;
            mmLastTapY = e.clientY;

        }

    }

    e.stopPropagation();

});

  // 💡 追加: OS側のジェスチャー割り込みやポインタ消失時に isMMDragging / isMMPinching が
  //    trueのまま固まって操作不能になるのを防ぐ（pointerupが来ないケースへの保険）
  mmMask.addEventListener('pointercancel', e => {
    mmActivePointers.delete(e.pointerId);
    isMMDragging = false;
    isMMPinching = false;
    mmMask.style.cursor = editMode ? 'crosshair' : 'grab';
  });

  mmMask.addEventListener('contextmenu', e => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    handleEditModeContextMenu(e.clientX, e.clientY);
  });

  [1, 2, 3, 4].forEach(f => {
    $(`mm-btn-f${f}`).addEventListener('click', e => {
      e.stopPropagation();
      updateMinimapFloor(f);
    });
  });

  // anchorX/Y（SVG描画座標系）を中心に、mmScaleをfactor倍する共通ズーム処理。
  // ホイール／ピンチ／ズームボタンの全てがこの1つを通ることで、アンカー計算のズレを防ぐ。
  function zoomMinimapBy(factor, anchorX, anchorY) {
    const oldScale = mmScale;
    mmScale = Math.max(0.02, Math.min(2.0, mmScale * factor));
    mmPanX = anchorX - (anchorX - mmPanX) * (mmScale / oldScale);
    mmPanY = anchorY - (anchorY - mmPanY) * (mmScale / oldScale);
    applyMinimapTransform();
  }

  // +/-ボタン用：固定ステップ(20%)でズーム
  function changeMMZoom(zoomIn, anchorX, anchorY) {
    zoomMinimapBy(zoomIn ? 1.2 : 1 / 1.2, anchorX, anchorY);
  }

  /* --- ホイール入力の種類判定（マウスホイール / トラックパッド） ---
   * 💡 注意: ブラウザには両者を確実に見分ける公式APIが無いため、あくまでヒューリスティックです。
   * - Firefoxは物理マウスホイールを deltaMode=1（行単位）、トラックパッドを deltaMode=0（ピクセル単位）
   *   ではっきり区別して送ってくるため、ここは確実に判定できる。
   * - Chrome/Safari/Edgeはどちらも常に deltaMode=0 なので、deltaYの値の特徴から推測する：
   *   ノッチ付きマウスホイールは「大きくキリのいい値が、間隔をあけて飛び飛びに」来るのに対し、
   *   トラックパッドは「小さい値が高頻度で連続的に」来る。
   */
  let mmLastWheelTs = 0;
  function classifyWheelInput(e) {
    if (e.deltaMode === 1) return 'wheel'; // Firefox: 行単位 = 物理マウスホイール確定

    const now = performance.now();
    const msSinceLast = now - mmLastWheelTs;
    mmLastWheelTs = now;

    const absDelta = Math.abs(e.deltaY);
    const looksLikeNotchedWheel =
      absDelta >= 40 &&                 // マウスホイール1ノッチは大きめの値になりやすい
      Number.isInteger(absDelta) &&     // トラックパッドの慣性スクロールは非整数になりやすい
      msSinceLast > 45;                 // ノッチ付きホイールはイベント間隔が空きやすい

    return looksLikeNotchedWheel ? 'wheel' : 'trackpad';
  }

  // 💡 修正: sv-canvas側のFOVホイールズーム（tFov += deltaY*0.05、可動域30〜110の80幅）は
  //    マウス1ノッチ(deltaY≈100)あたり可動域の約6.25%しか動かない。またミニマップ自身の
  //    +/-ボタン(changeMMZoom)も1クリック20%(1.2倍)というステップになっている。
  //    このアプリ内での「ズーム操作1回分」の体感を揃えるため、ミニマップのホイールズームも
  //    同程度（最大でもボタン1クリック分=1.2倍）に収める。
  const WHEEL_ZOOM_BASE_MOUSE    = 1.0018; // マウスホイール1ノッチ(deltaY≈100)で約1.20倍（≒ズームボタン1回分）
  const WHEEL_ZOOM_BASE_TRACKPAD = 1.02;   // トラックパッドでの操作感を優先した値
  const WHEEL_ZOOM_MAX_STEP      = 1.2;    // 1イベントの変化量上限。sv-canvasの1ノッチ分／ミニマップの
                                            // +/-ボタン1回分と同じ大きさに揃えた（判定ミス時の暴走防止も兼ねる）

  $('hud-minimap-svg').addEventListener('wheel', e => {
    e.preventDefault();
    e.stopPropagation(); 
    const rect = $('hud-minimap-svg').getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const viewBox = $('hud-minimap-svg').viewBox.baseVal;

    const scaleX = rect.width / viewBox.width;
    const scaleY = rect.height / viewBox.height;

    const inputType = classifyWheelInput(e);
    const base = (inputType === 'trackpad') ? WHEEL_ZOOM_BASE_TRACKPAD : WHEEL_ZOOM_BASE_MOUSE;

    const clampedDelta = Math.max(-100, Math.min(100, e.deltaY));
    let factor = Math.pow(base, -clampedDelta);
    // 判定ミス（例:notchなしの高速マウスホイールをtrackpad判定してしまう等）が起きても
    // 一気に最大/最小ズームへ飛ばないよう、1イベントあたりの変化量に上限をかけておく
    factor = Math.max(1 / WHEEL_ZOOM_MAX_STEP, Math.min(WHEEL_ZOOM_MAX_STEP, factor));


    zoomMinimapBy(factor, mouseX / scaleX, mouseY / scaleY);
  }, { passive: false });

  $('mm-btn-zoom-in').addEventListener('click', e => {
    e.stopPropagation();
    const viewBox = $('hud-minimap-svg').viewBox.baseVal;
    changeMMZoom(
        true,
        viewBox.width / 2 - 38,
        viewBox.height / 2
    );
  });

  $('mm-btn-zoom-out').addEventListener('click', e => {
    e.stopPropagation();
    const viewBox = $('hud-minimap-svg').viewBox.baseVal;
    changeMMZoom(
        false,
        viewBox.width / 2 - 38,
        viewBox.height / 2
    );
  });

  // UIサイズ設定ボタン：クリックのたびに S→M→L→S... と巡回する
  const uiSizeBtn = $('mm-btn-ui-size');
  if (uiSizeBtn) {
    uiSizeBtn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = MM_UI_SIZE_CYCLE.indexOf(mmUiSizeLevel);
      mmUiSizeLevel = MM_UI_SIZE_CYCLE[(idx + 1) % MM_UI_SIZE_CYCLE.length];

      const label = $('mm-ui-size-label');
      if (label) label.textContent = mmUiSizeLevel;

      resizeMinimapViewport(); // 新しい段階をすぐに反映
      if (typeof saveUserSettings === 'function') {
        saveUserSettings({ mmUiSizeLevel });
      }
    });
  }
}

/* --- 画面サイズ変更時もミニマップを追従させる --- */
window.addEventListener('resize', () => {
    resizeMinimapViewport();
    resizeMinimapDragMask();

    if (typeof focusCurrentNodeOnMinimap === 'function') {
        focusCurrentNodeOnMinimap();
    }
});

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