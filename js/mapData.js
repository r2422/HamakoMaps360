/* ============================================================
   OBJECT-ORIENTED MAP GRAPH & ASSET MANAGEMENT (巨大SVGマップ・固定縮尺対応版)
============================================================ */

class PanoramaAsset {
  constructor(fileName) {
    this.folderPath = './images/';
    this.url = fileName ? this.folderPath + fileName : this.folderPath + 'entrance.jpg';
  }
}

class MapNode {
  constructor(id, name, sub, imageFile, initYaw, mmIdx, pos3D, floor = 3, building = 'North') {
    this.id = id;
    this.name = name;
    this.sub = sub;
    this.asset = new PanoramaAsset(imageFile);
    this.initYaw = initYaw;
    this.mmIdx = mmIdx; 
    this.pos3D = pos3D; // [x, y, z] 絶対空間座標
    this.floor = floor;
    this.building = building;
    
    // 巨大地図用2D座標（calcMinimapCoordsでSVG座標系へ固定マッピング）
    this.mmX = 0;
    this.mmY = 0;
    
    this.links = [];
  }
  
  addLink(targetId, label, hint) {
    this.links.push({ targetId, pos: null, label, hint });
  }
}

class MapGraph {
  constructor() { this.nodes = {}; }
  addNode(node) { this.nodes[node.id] = node; }
  getNode(id) { return this.nodes[id]; }

  /* 💡 巨大地図SVG（5640x4320）の絶対座標系へ完全に固定マッピングする */
  calcMinimapCoords() {
    // 3D空間上の1単位が、地図SVG上で何ピクセルに相当するかの固定倍率（3倍相似に対応）
    const scale = 3.0; 

    // 地図SVGの原点(0,0)に対する、3D空間の原点のズレを補正するオフセット（必要に応じて調整）
    const offsetX = 0;    
    const offsetY = 0;    

    for (let id in this.nodes) {
      const node = this.nodes[id];
      // X軸、Z軸に固定スケールを掛け、5640x4320の座標の中に正確に配置
      node.mmX = offsetX + node.pos3D[0] * scale;
      node.mmY = offsetY + node.pos3D[2] * scale;
    }
  }

  // 接続先への「差分（相対ベクトル）」自動計算
  buildAllLinks() {
    for (let id in this.nodes) {
      const currentNode = this.nodes[id];
      currentNode.links.forEach(link => {
        const targetNode = this.getNode(link.targetId);
        if (targetNode && currentNode.pos3D && targetNode.pos3D) {
          link.pos = [
            targetNode.pos3D[0] - currentNode.pos3D[0],
            targetNode.pos3D[1] - currentNode.pos3D[1],
            targetNode.pos3D[2] - currentNode.pos3D[2]
          ];
        } else {
          link.pos = [0, 0, -10];
        }
      });
    }
  }
}

const mapGraph = new MapGraph();

// 各階の基準高
const Y_BASE_1 = 0; 
const Y_BASE_2 = 80; 
const Y_BASE_3 = 160; 
const Y_BASE_4 = 240; 

/* ------------------------------------------------------------
   北館3階のマップデータ定義
------------------------------------------------------------ */

  // --- 廊下ノード ---
  mapGraph.addNode(new MapNode('13_corridor_0000,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0000,0020.jpg', Math.PI / 2, 0, [ 0, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0120,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0120,0020.jpg', 0, 0, [120, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0220,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0220,0020.jpg', 0, 0, [220, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0330,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0330,0020.jpg', 0, 0, [330, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0380,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0380,0020.jpg', 0, 0, [380, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0520,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0520,0020.jpg', 0, 0, [520, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0570,0020', '北館 3階 廊下(R科準備室)', 'North building - Floor 3', '北館3F/13_corridor_0570,0020.jpg', 0, 0, [570, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0750,0020', '北館 3階 廊下(物理準備室)', 'North building - Floor 3', '北館3F/13_corridor_0750,0020.jpg', 0, 0, [750, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0870,0020', '北館 3階 物理室内', 'North building - Floor 3', '北館3F/13_corridor_0870,0020.jpg', 0, 0, [870, Y_BASE_3,  20], 3, 'North'));
  mapGraph.addNode(new MapNode('13_corridor_0990,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0990,0020.jpg', 0, 0, [990, Y_BASE_3,  20], 3, 'North'));

  // --- 教室ノード ---
  mapGraph.addNode(new MapNode('13_classroom_0060,0100_131', '北館 3階 131教室', 'North building - Floor 3 131-classroom', '北館3F/13_classroom_0060,0100_131re.jpg', 0, 0, [ 60, Y_BASE_3,  100], 3, 'North'));
  mapGraph.addNode(new MapNode('13_classroom_0180,0100_132', '北館 3階 132教室', 'North building - Floor 3 132-classroom', '北館3F/13_classroom_0180,0100_132.jpg', 0, 0, [180, Y_BASE_3,  100], 3, 'North'));
  mapGraph.addNode(new MapNode('13_classroom_0450,0100_理数工学室', '北館 3階 理数工学室', 'North building - Floor 3 理数工学室', '北館3F/13_classroom_0450,0100_理数工学室.jpg', 0, 0, [450, Y_BASE_3,  100], 3, 'North'));
  mapGraph.addNode(new MapNode('13_classroom_0870,0100_物理室', '北館 3階 物理室', 'North building - Floor 3 物理室', '北館3F/13_classroom_0870,0100_物理室re.jpg', 0, 0, [870, Y_BASE_3,  100], 3, 'North'));

  // --- 階段ノード ---
  mapGraph.addNode(new MapNode('13_stairs_0330,0140', '北館 3-2階 階段', 'North building - Floor 3', '北館3F/13_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_3 - 20,  140], 3, 'North'));
  mapGraph.addNode(new MapNode('13_stairs_0990,0140', '北館 3-2階 階段', 'North building - Floor 3', '北館3F/13_stairs_0990,0140.jpg', 0, 0, [990, Y_BASE_3 - 20,  140], 3, 'North'));

/* ------------------------------------------------------------
   北館3階の隣接リンク定義
------------------------------------------------------------ */

  // 隣接リンク 廊下
  mapGraph.getNode('13_corridor_0000,0020').addLink('13_corridor_0120,0020', '廊下を東へ', 'East');
  mapGraph.getNode('13_corridor_0120,0020').addLink('13_corridor_0000,0020', '廊下を西へ', 'West');
  mapGraph.getNode('13_corridor_0120,0020').addLink('13_corridor_0220,0020', '廊下を東へ', 'East');
  mapGraph.getNode('13_corridor_0220,0020').addLink('13_corridor_0120,0020', '廊下を西へ', 'West');
  mapGraph.getNode('13_corridor_0220,0020').addLink('13_corridor_0330,0020', '廊下を東へ', 'East');
  mapGraph.getNode('13_corridor_0330,0020').addLink('13_corridor_0220,0020', '廊下を西へ', 'West');
  mapGraph.getNode('13_corridor_0330,0020').addLink('13_corridor_0380,0020', '廊下を東へ', 'East');
  mapGraph.getNode('13_corridor_0380,0020').addLink('13_corridor_0330,0020', '廊下を西へ', 'West');
  mapGraph.getNode('13_corridor_0380,0020').addLink('13_corridor_0520,0020', '廊下を東へ', 'East');
  mapGraph.getNode('13_corridor_0520,0020').addLink('13_corridor_0380,0020', '廊下を西へ', 'West');
  mapGraph.getNode('13_corridor_0520,0020').addLink('13_corridor_0570,0020', '廊下を東へ', 'East');
  mapGraph.getNode('13_corridor_0570,0020').addLink('13_corridor_0520,0020', '廊下を西へ', 'West');
  mapGraph.getNode('13_corridor_0570,0020').addLink('13_corridor_0750,0020', '廊下を東へ', 'East');
  mapGraph.getNode('13_corridor_0750,0020').addLink('13_corridor_0570,0020', '廊下を西へ', 'West');
  mapGraph.getNode('13_corridor_0750,0020').addLink('13_corridor_0870,0020', '物理室に入る', 'Enter Physics Room');
  mapGraph.getNode('13_corridor_0870,0020').addLink('13_corridor_0750,0020', '廊下に出る', 'West');
  mapGraph.getNode('13_corridor_0870,0020').addLink('13_corridor_0990,0020', '廊下に出る', 'Enter Physics Room');
  mapGraph.getNode('13_corridor_0990,0020').addLink('13_corridor_0870,0020', '物理室に入る', 'West');

  // 隣接リンク 教室
  mapGraph.getNode('13_corridor_0000,0020').addLink('13_classroom_0060,0100_131', '131教室に入る', 'Enter 131room');
  mapGraph.getNode('13_classroom_0060,0100_131').addLink('13_corridor_0000,0020', '廊下に出る', 'Exit');
  mapGraph.getNode('13_corridor_0120,0020').addLink('13_classroom_0060,0100_131', '131教室に入る', 'Enter 131room');
  mapGraph.getNode('13_classroom_0060,0100_131').addLink('13_corridor_0120,0020', '廊下に出る', 'Exit');

  mapGraph.getNode('13_corridor_0120,0020').addLink('13_classroom_0180,0100_132', '132教室に入る', 'Enter 132room');
  mapGraph.getNode('13_classroom_0180,0100_132').addLink('13_corridor_0120,0020', '廊下に出る', 'Exit');
  mapGraph.getNode('13_corridor_0220,0020').addLink('13_classroom_0180,0100_132', '132教室に入る', 'Enter 132room');
  mapGraph.getNode('13_classroom_0180,0100_132').addLink('13_corridor_0220,0020', '廊下に出る', 'Exit');

  mapGraph.getNode('13_corridor_0380,0020').addLink('13_classroom_0450,0100_理数工学室', '理数工学室に入る', 'Enter 理数工学室');
  mapGraph.getNode('13_classroom_0450,0100_理数工学室').addLink('13_corridor_0380,0020', '廊下に出る', 'Exit');
  mapGraph.getNode('13_corridor_0520,0020').addLink('13_classroom_0450,0100_理数工学室', '理数工学室に入る', 'Enter 理数工学室');
  mapGraph.getNode('13_classroom_0450,0100_理数工学室').addLink('13_corridor_0520,0020', '廊下に出る', 'Exit');

  mapGraph.getNode('13_corridor_0870,0020').addLink('13_classroom_0870,0100_物理室', '物理室に入る', 'Enter 物理室');
  mapGraph.getNode('13_classroom_0870,0100_物理室').addLink('13_corridor_0870,0020', '廊下に出る', 'Exit');

  // 隣接リンク 階段
  mapGraph.getNode('13_corridor_0330,0020').addLink('13_stairs_0330,0140', '階段へ', 'Enter Stairs');
  mapGraph.getNode('13_stairs_0330,0140').addLink('13_corridor_0330,0020', '廊下へ', 'Exit');
  mapGraph.getNode('13_corridor_0990,0020').addLink('13_stairs_0990,0140', '階段へ', 'Enter Stairs');
  mapGraph.getNode('13_stairs_0990,0140').addLink('13_corridor_0990,0020', '廊下へ', 'Exit');



/* ------------------------------------------------------------
   階段ノードの定義（絶対座標版）
   ※ 北館の最北西(0,0)から見た絶対空間座標を直接指定しています
------------------------------------------------------------ */

// === 北館 階段（Xは共通、Zは140） ===
// 1階
mapGraph.addNode(new MapNode('11_stairs_0330,0140', '北館 1階 階段', 'North building - Floor 1', '北館1F/11_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_1, 140], 1, 'North'));
mapGraph.addNode(new MapNode('11_stairs_0990,0140', '北館 1階 階段', 'North building - Floor 1', '北館1F/11_stairs_0990,0140.jpg', 0, 0, [990, Y_BASE_1, 140], 1, 'North'));
// 2階
mapGraph.addNode(new MapNode('12_stairs_0330,0140', '北館 2階 階段', 'North building - Floor 2', '北館2F/12_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_2, 140], 2, 'North'));
mapGraph.addNode(new MapNode('12_stairs_0990,0140', '北館 2階 階段', 'North building - Floor 2', '北館2F/12_stairs_0990,0140.jpg', 0, 0, [990, Y_BASE_2, 140], 2, 'North'));
// 3階
//mapGraph.addNode(new MapNode('13_stairs_0330,0140', '北館 3階 階段', 'North building - Floor 3', '北館3F/13_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_3, 140], 3, 'North'));
//mapGraph.addNode(new MapNode('13_stairs_0990,0140', '北館 3階 階段', 'North building - Floor 3', '北館3F/13_stairs_0990,0140.jpg', 0, 0, [990, Y_BASE_3, 140], 3, 'North'));


// === 本館 階段（Xは330共通、Zは 160 + 380 + 140 = 560） ===
// 1階
mapGraph.addNode(new MapNode('21_stairs_0330,0140', '本館 1階 階段', 'Main building - Floor 1', '本館1F/21_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_1, 560], 1, 'Main'));
mapGraph.addNode(new MapNode('21_stairs_0990,0140', '本館 1階 階段', 'Main building - Floor 1', '本館1F/21_stairs_0990,0140.jpg', 0, 0, [990, Y_BASE_1, 560], 1, 'Main'));
// 2階
mapGraph.addNode(new MapNode('22_stairs_0330,0140', '本館 2階 階段', 'Main building - Floor 2', '本館2F/22_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_2, 560], 2, 'Main'));
mapGraph.addNode(new MapNode('22_stairs_0990,0140', '本館 2階 階段', 'Main building - Floor 2', '本館2F/22_stairs_0990,0140.jpg', 0, 0, [990, Y_BASE_2, 560], 2, 'Main'));
// 3階
mapGraph.addNode(new MapNode('23_stairs_0330,0140', '本館 3階 階段', 'Main building - Floor 3', '本館3F/23_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_3, 560], 3, 'Main'));
mapGraph.addNode(new MapNode('23_stairs_0990,0140', '本館 3階 階段', 'Main building - Floor 3', '本館3F/23_stairs_0990,0140.jpg', 0, 0, [990, Y_BASE_3, 560], 3, 'Main'));


/* ============================================================
   階層移動（階段の上下）および 校舎間（北館-本館）のリンク定義
============================================================ */

// ------------------------------------------------------------
// 1.1. 北館 階段の上下接続 (X=330)
// ------------------------------------------------------------
mapGraph.getNode('11_stairs_0330,0140').addLink('12_stairs_0330,0140', '階段で2階へ', 'Up to 2F');
mapGraph.getNode('12_stairs_0330,0140').addLink('11_stairs_0330,0140', '階段で1階へ', 'Down to 1F');
mapGraph.getNode('12_stairs_0330,0140').addLink('13_stairs_0330,0140', '階段で3階へ', 'Up to 3F');
mapGraph.getNode('13_stairs_0330,0140').addLink('12_stairs_0330,0140', '階段で2階へ', 'Down to 2F');

// ------------------------------------------------------------
// 1.2. 北館 階段の上下接続 (X=990)
// ------------------------------------------------------------
mapGraph.getNode('11_stairs_0990,0140').addLink('12_stairs_0990,0140', '階段で2階へ', 'Up to 2F');
mapGraph.getNode('12_stairs_0990,0140').addLink('11_stairs_0990,0140', '階段で1階へ', 'Down to 1F');
mapGraph.getNode('12_stairs_0990,0140').addLink('13_stairs_0990,0140', '階段で3階へ', 'Up to 3F');
mapGraph.getNode('13_stairs_0990,0140').addLink('12_stairs_0990,0140', '階段で2階へ', 'Down to 2F');

// ------------------------------------------------------------
// 2.1. 本館 階段の上下接続 (X=330)
// ------------------------------------------------------------
mapGraph.getNode('21_stairs_0330,0140').addLink('22_stairs_0330,0140', '階段で2階へ', 'Up to 2F');
mapGraph.getNode('22_stairs_0330,0140').addLink('21_stairs_0330,0140', '階段で1階へ', 'Down to 1F');
mapGraph.getNode('22_stairs_0330,0140').addLink('23_stairs_0330,0140', '階段で3階へ', 'Up to 3F');
mapGraph.getNode('23_stairs_0330,0140').addLink('22_stairs_0330,0140', '階段で2階へ', 'Down to 2F');

// ------------------------------------------------------------
// 2.2. 本館 階段の上下接続 (X=990)
// ------------------------------------------------------------
mapGraph.getNode('21_stairs_0990,0140').addLink('22_stairs_0990,0140', '階段で2階へ', 'Up to 2F');
mapGraph.getNode('22_stairs_0990,0140').addLink('21_stairs_0990,0140', '階段で1階へ', 'Down to 1F');
mapGraph.getNode('22_stairs_0990,0140').addLink('23_stairs_0990,0140', '階段で3階へ', 'Up to 3F');
mapGraph.getNode('23_stairs_0990,0140').addLink('22_stairs_0990,0140', '階段で2階へ', 'Down to 2F');


/* ------------------------------------------------------------
   空中廊下の中間ノード（1階・2階・3階）
   ※ 北館(Z=140)と本館(Z=680)の中間である Z=350 に配置
------------------------------------------------------------ */

// --- 1階 空中廊下中間 ---
mapGraph.addNode(new MapNode('11_bridge_mid_0330,0350', '1階 連絡通路 中間点', 'Connecting Bridge 1F - Mid', 'Bridge/11_bridge_mid.jpg', 0, 0, [330, Y_BASE_1, 350], 1, 'North'));
mapGraph.addNode(new MapNode('11_bridge_mid_0990,0350', '1階 連絡通路 中間点', 'Connecting Bridge 1F - Mid', 'Bridge/11_bridge_mid.jpg', 0, 0, [990, Y_BASE_1, 350], 1, 'North'));

// --- 2階 空中廊下中間 ---
mapGraph.addNode(new MapNode('12_bridge_mid_0330,0350', '2階 連絡通路 中間点', 'Connecting Bridge 2F - Mid', 'Bridge/12_bridge_mid.jpg', 0, 0, [330, Y_BASE_2, 350], 2, 'North'));
mapGraph.addNode(new MapNode('12_bridge_mid_0990,0350', '2階 連絡通路 中間点', 'Connecting Bridge 2F - Mid', 'Bridge/12_bridge_mid.jpg', 0, 0, [990, Y_BASE_2, 350], 2, 'North'));

// --- 3階 空中廊下中間 ---
mapGraph.addNode(new MapNode('13_bridge_mid_0330,0350', '3階 連絡通路 中間点', 'Connecting Bridge 3F - Mid', 'Bridge/13_bridge_mid.jpg', 0, 0, [330, Y_BASE_3, 350], 3, 'North'));
mapGraph.addNode(new MapNode('13_bridge_mid_0990,0350', '3階 連絡通路 中間点', 'Connecting Bridge 3F - Mid', 'Bridge/13_bridge_mid.jpg', 0, 0, [990, Y_BASE_3, 350], 3, 'North'));


/* ============================================================
   空中廊下（中間点経由）の相互リンク定義
============================================================ */

// --- 1階：北館階段 ⇄ 廊下中間 ⇄ 本館階段 ---
mapGraph.getNode('11_stairs_0330,0140').addLink('11_bridge_mid_0330,0350', '空中廊下(本館方面)', 'To Main Bldg');
mapGraph.getNode('11_bridge_mid_0330,0350').addLink('11_stairs_0330,0140', '北館へ', 'To North Bldg');

mapGraph.getNode('11_bridge_mid_0330,0350').addLink('21_stairs_0330,0140', '本館へ', 'Enter Main Bldg');
mapGraph.getNode('21_stairs_0330,0140').addLink('11_bridge_mid_0330,0350', '空中廊下(北館方面)', 'To North Bldg');


mapGraph.getNode('11_stairs_0990,0140').addLink('11_bridge_mid_0990,0350', '空中廊下(本館方面)', 'To Main Bldg');
mapGraph.getNode('11_bridge_mid_0990,0350').addLink('11_stairs_0990,0140', '北館へ', 'To North Bldg');

mapGraph.getNode('11_bridge_mid_0990,0350').addLink('21_stairs_0990,0140', '本館へ', 'Enter Main Bldg');
mapGraph.getNode('21_stairs_0990,0140').addLink('11_bridge_mid_0990,0350', '空中廊下(北館方面)', 'To North Bldg');

// --- 2階：北館階段 ⇄ 廊下中間 ⇄ 本館階段 ---
mapGraph.getNode('12_stairs_0330,0140').addLink('12_bridge_mid_0330,0350', '空中廊下(本館方面)', 'To Bridge');
mapGraph.getNode('12_bridge_mid_0330,0350').addLink('12_stairs_0330,0140', '北館へ', 'To North Bldg');

mapGraph.getNode('12_bridge_mid_0330,0350').addLink('22_stairs_0330,0140', '本館へ', 'Enter Main Bldg');
mapGraph.getNode('22_stairs_0330,0140').addLink('12_bridge_mid_0330,0350', '空中廊下(北館方面)', 'To Bridge');


mapGraph.getNode('12_stairs_0990,0140').addLink('12_bridge_mid_0990,0350', '空中廊下(本館方面)', 'To Bridge');
mapGraph.getNode('12_bridge_mid_0990,0350').addLink('12_stairs_0990,0140', '北館へ', 'To North Bldg');

mapGraph.getNode('12_bridge_mid_0990,0350').addLink('22_stairs_0990,0140', '本館へ', 'Enter Main Bldg');
mapGraph.getNode('22_stairs_0990,0140').addLink('12_bridge_mid_0990,0350', '空中廊下(北館方面)', 'To Bridge');


// --- 3階：北館階段 ⇄ 廊下中間 ⇄ 本館階段 ---
mapGraph.getNode('13_stairs_0330,0140').addLink('13_bridge_mid_0330,0350', '空中廊下(本館方面)', 'To Bridge');
mapGraph.getNode('13_bridge_mid_0330,0350').addLink('13_stairs_0330,0140', '北館へ', 'To North Bldg');

mapGraph.getNode('13_bridge_mid_0330,0350').addLink('23_stairs_0330,0140', '本館へ', 'Enter Main Bldg');
mapGraph.getNode('23_stairs_0330,0140').addLink('13_bridge_mid_0330,0350', '空中廊下(北館方面)', 'To Bridge');


mapGraph.getNode('13_stairs_0990,0140').addLink('13_bridge_mid_0990,0350', '空中廊下(本館方面)', 'To Bridge');
mapGraph.getNode('13_bridge_mid_0990,0350').addLink('13_stairs_0990,0140', '北館へ', 'To North Bldg');

mapGraph.getNode('13_bridge_mid_0990,0350').addLink('23_stairs_0990,0140', '本館へ', 'Enter Main Bldg');
mapGraph.getNode('23_stairs_0990,0140').addLink('13_bridge_mid_0990,0350', '空中廊下(北館方面)', 'To Bridge');


// ------------------------------------------------------------

// 座標変換とベクトルビルドを実行
mapGraph.calcMinimapCoords();
mapGraph.buildAllLinks();

window.NODES = mapGraph.nodes;