/* ============================================================
   OBJECT-ORIENTED MAP GRAPH & ASSET MANAGEMENT (JSON対応版)
============================================================ */

class PanoramaAsset {
  // コンストラクタに nodeInfo を渡せるように変更
  constructor(fileName, nodeInfo) {
    this.folderPath = '../images/';
    
    // nodeInfo があればフォルダ名を構築（例: 'North' + '3F' -> '北館3F'）
    // ※ フォルダ名が「北館3F」などの日本語名であることを前提としています
    if (nodeInfo && nodeInfo.building && nodeInfo.floor) {
      const bMap = { 'North': '北館', 'Main': '本館', 'South': '南館' };
      const folderName = `${bMap[nodeInfo.building] || nodeInfo.building}${nodeInfo.floor}F/`;
      this.folderPath += folderName;
    }

    this.url = fileName ? this.folderPath + fileName : '../images/entrance.jpg';
  }
}

class MapNode {
  constructor(id, data) {
    this.id = id;
    this.name = data.name;
    this.sub = data.sub;
    
    // 第2引数として建物・階数情報を渡す
    this.asset = new PanoramaAsset(data.imageFile, {
      building: data.building,
      floor: data.floor
    });
    
    this.initYaw = data.initYaw; // TPしたときに向いている方向
    this.mmIdx = data.mmIdx;
    this.pos3D = data.pos3D; // [x, y, z] 絶対空間座標
    this.floor = data.floor || 3;
    this.building = data.building || 'North';
    // 巨大地図用2D座標（calcMinimapCoordsでSVG座標系へ固定マッピング）
    this.mmX = 0;
    this.mmY = 0;
    
    this.links = data.links || [];
  }
}

class MapGraph {
  constructor() { this.nodes = {}; }
  
  getNode(id) { return this.nodes[id]; }

  // 複数のJSONデータ（配列）をまとめて取り込むメソッド
  loadFromMultipleJSON(jsonArray) {
    jsonArray.forEach(jsonData => {
      for (let id in jsonData.nodes) {
        this.nodes[id] = new MapNode(id, jsonData.nodes[id]);
      }
    });
    // 全データロード後にリンク計算と座標計算を実行
    this.calcMinimapCoords();
    this.buildAllLinks();

    window.NODES = this.nodes;
  }

  // ミニマップ座標の計算
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

// 各階の基準高（JSON読み込み後の計算用として定数だけ残しておく）
const Y_BASE_1 = 0; 
const Y_BASE_2 = 80; 
const Y_BASE_3 = 160; 
const Y_BASE_4 = 240;

  
// window.NODES = mapGraph.nodes;

// 外部JSON（mapData.json）を読み込んで初期化するための関数
async function loadMapData() {
    try {
        const response = await fetch('./mapData.json'); // JSONファイルのパス
        const data = await response.json();
        
        // ここでデータを流し込み、座標・リンク計算を実行
        mapGraph.loadFromMultipleJSON([data]);
        
        // グローバル変数へ公開
        window.NODES = mapGraph.nodes;
        
        console.log("マップデータ読み込み完了");
    } catch (e) {
        console.error("マップデータの読み込みに失敗しました:", e);
    }
}

// 実行する
loadMapData();