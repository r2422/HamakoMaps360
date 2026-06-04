/* ============================================================
   OBJECT-ORIENTED MAP GRAPH & ASSET MANAGEMENT (スケーリング対応版)
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
    
    // 💡 ミニマップ用の座標は後から自動計算するため初期値は0
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

  /* 💡 空間絶対座標からミニマップ用SVG座標への自動変換（スケーリング処理） */
  calcMinimapCoords() {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    // 1. 全ノードの中から空間の最大・最小値を自動スキャン
    for (let id in this.nodes) {
      const p = this.nodes[id].pos3D;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }

    // 2. ミニマップSVG内での描画可能余白サイズ（padding）を定義
    const mapWidth = 220;  // SVGの横幅 260 に対する描画有効幅
    const mapHeight = 100; // SVGの縦幅 160 に対する描画有効高
    const offsetX = 20;    // 左余白
    const offsetY = 45;    // 上余白（タイトル文字の回避）

    const rangeX = (maxX - minX) || 1;
    const rangeZ = (maxZ - minZ) || 1;

    // 3. 各ノードの比率を維持したまま、SVGの座標へ落とし込む
    for (let id in this.nodes) {
      const node = this.nodes[id];
      // X座標の線形変換
      node.mmX = offsetX + ((node.pos3D[0] - minX) / rangeX) * mapWidth;
      // Z座標をミニマップのY軸にマッピング
      node.mmY = offsetY + ((node.pos3D[2] - minZ) / rangeZ) * mapHeight;
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
const Y_BASE_1 = 0; // 1F基準高
const Y_BASE_2 = 40; // 2F基準高
const Y_BASE_3 = 80; // 3F基準高
const Y_BASE_4 = 120; // 4F基準高
// 階段の途中は上の階のY_BASEから-20

/* ------------------------------------------------------------
   北館3階のマップデータ定義
------------------------------------------------------------ */

// --- 新しい廊下ノード ---
mapGraph.addNode(new MapNode('13_corridor_0020,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0020,0020.jpg', Math.PI / 2, 0, [ 20, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0120,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0120,0020.jpg', 0, 0, [120, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0220,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0220,0020.jpg', 0, 0, [220, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0330,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0330,0020.jpg', 0, 0, [330, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0380,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0380,0020.jpg', 0, 0, [380, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0520,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0520,0020.jpg', 0, 0, [520, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0570,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0570,0020.jpg', 0, 0, [570, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0750,0020', '北館 3階 廊下', 'North building - Floor 3', '北館3F/13_corridor_0750,0020.jpg', 0, 0, [750, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_0870,0020', '北館 3階 廊下 物理室内', 'North building - Floor 3', '北館3F/13_corridor_0870,0020.jpg', 0, 0, [870, Y_BASE_3,  20]));
mapGraph.addNode(new MapNode('13_corridor_1000,0020', '北館 3階 廊下 物理室内', 'North building - Floor 3', '北館3F/13_corridor_1000,0020.jpg', 0, 0, [1000, Y_BASE_3,  20]));

// --- 教室ノード ---
mapGraph.addNode(new MapNode('13_classroom_0060,0180_131', '北館 3階 131教室', 'North building - Floor 3 131-classroom', '北館3F/13_classroom_0060,0180_131.jpg', 0, 0, [ 60, Y_BASE_3,  180]));
mapGraph.addNode(new MapNode('13_classroom_0180,0180_132', '北館 3階 132教室', 'North building - Floor 3 132-classroom', '北館3F/13_classroom_0180,0180_132.jpg', 0, 0, [180, Y_BASE_3,  180]));
mapGraph.addNode(new MapNode('13_classroom_0450,0180_理数工学室', '北館 3階 理数工学室', 'North building - Floor 3 理数工学室', '北館3F/13_classroom_0450,0180_理数工学室.jpg', 0, 0, [450, Y_BASE_3,  180]));
mapGraph.addNode(new MapNode('13_classroom_0870,0180_物理室', '北館 3階 物理室', 'North building - Floor 3 物理室', '北館3F/13_classroom_0870,0180_物理室.jpg', 0, 0, [870, Y_BASE_3,  180]));

// --- 階段ノード ---
mapGraph.addNode(new MapNode('13_stairs_0330,0140', '北館 3-2階 階段', 'North building - Floor 3', '北館3F/13_stairs_0330,0140.jpg', 0, 0, [330, Y_BASE_3 - 20,  140]));
mapGraph.addNode(new MapNode('13_stairs_1000,0140', '北館 3-2階 階段', 'North building - Floor 3', '北館3F/13_stairs_1000,0140.jpg', 0, 0, [1000, Y_BASE_3 - 20,  140]));

/* ------------------------------------------------------------
   北館3階の隣接リンク定義
------------------------------------------------------------ */

// 隣接リンク 廊下
mapGraph.getNode('13_corridor_0020,0020').addLink('13_corridor_0120,0020', '廊下を東へ', 'East');
mapGraph.getNode('13_corridor_0120,0020').addLink('13_corridor_0020,0020', '廊下を西へ', 'West');
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
mapGraph.getNode('13_corridor_0870,0020').addLink('13_corridor_0750,0020', '廊下を西へ', 'West');
mapGraph.getNode('13_corridor_0870,0020').addLink('13_corridor_1000,0020', '物理室に入る', 'Enter Physics Room');
mapGraph.getNode('13_corridor_1000,0020').addLink('13_corridor_0870,0020', '廊下を西へ', 'West');

// 隣接リンク 教室
mapGraph.getNode('13_corridor_0020,0020').addLink('13_classroom_0060,0180_131', '入る', 'Enter 131room');
mapGraph.getNode('13_classroom_0060,0180_131').addLink('13_corridor_0020,0020', '出る', 'Exit');
mapGraph.getNode('13_corridor_0120,0020').addLink('13_classroom_0060,0180_131', '入る', 'Enter 131room');
mapGraph.getNode('13_classroom_0060,0180_131').addLink('13_corridor_0120,0020', '出る', 'Exit');

mapGraph.getNode('13_corridor_0120,0020').addLink('13_classroom_0180,0180_132', '入る', 'Enter 132room');
mapGraph.getNode('13_classroom_0180,0180_132').addLink('13_corridor_0120,0020', '出る', 'Exit');
mapGraph.getNode('13_corridor_0220,0020').addLink('13_classroom_0180,0180_132', '入る', 'Enter 132room');
mapGraph.getNode('13_classroom_0180,0180_132').addLink('13_corridor_0220,0020', '出る', 'Exit');

mapGraph.getNode('13_corridor_0380,0020').addLink('13_classroom_0450,0180_理数工学室', '入る', 'Enter 理数工学室');
mapGraph.getNode('13_classroom_0450,0180_理数工学室').addLink('13_corridor_0380,0020', '出る', 'Exit');
mapGraph.getNode('13_corridor_0520,0020').addLink('13_classroom_0450,0180_理数工学室', '入る', 'Enter 理数工学室');
mapGraph.getNode('13_classroom_0450,0180_理数工学室').addLink('13_corridor_0520,0020', '出る', 'Exit');

mapGraph.getNode('13_corridor_0870,0020').addLink('13_classroom_0870,0180_物理室', '入る', 'Enter 物理室');
mapGraph.getNode('13_classroom_0870,0180_物理室').addLink('13_corridor_0870,0020', '出る', 'Exit');

// 隣接リンク 階段
mapGraph.getNode('13_corridor_0330,0020').addLink('13_stairs_0330,0140', '入る', 'Enter Stairs');
mapGraph.getNode('13_stairs_0330,0140').addLink('13_corridor_0330,0020', '出る', 'Exit');
mapGraph.getNode('13_corridor_1000,0020').addLink('13_stairs_1000,0140', '入る', 'Enter Stairs');
mapGraph.getNode('13_stairs_1000,0140').addLink('13_corridor_1000,0020', '出る', 'Exit');



// 💡 座標変換とベクトルビルドを実行
mapGraph.calcMinimapCoords();
mapGraph.buildAllLinks();

window.NODES = mapGraph.nodes;