/**
 * 天地图矢量瓦片 GeoJSON 聚合与文件导出管理器
 * 采用原生 fs.promises 实现，无任何第三方依赖
 */

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// 图层代号对照中文表（已对照天地图官方样式配色及地物属性精确修正）
const LAYER_NAME_MAP = {
  CE: '建筑物_CE',
  BM: '水系面_BM',
  AN: '水系线_AN',
  CK: '绿地面_CK',
  AP: '地块面_AP',
  BV: '陆地底板_BV',
  AB: '道路网_AB',
  BK: '水系注记_BK',
  BI: 'POI标注_BI',
  AA: '交通标注_AA',
  AX: '路网注记_AX',
};

/**
 * 判断当前图层是否符合用户选定的矢量类型
 * @param {string} layerName 图层名称
 * @param {string} vectorType 矢量类型 (all, base, building, water_green, road, label)
 * @param {Array<object>} features 该图层内的要素集合
 */
function shouldIncludeLayer(layerName, vectorType, features) {
  if (!vectorType || vectorType === 'all') return true;

  const upper = (layerName || '').toUpperCase();

  // 1. 仅建筑物要素 (CE 为带楼高与唯一ID的建筑面)
  if (vectorType === 'building') {
    return upper === 'CE' || upper.includes('BUILDING');
  }

  // 2. 水系与绿地要素 (BM 水系面, AN 水系线, CK 绿地面)
  if (vectorType === 'water_green') {
    return upper === 'BM' || upper === 'AN' || upper === 'CK';
  }

  // 3. 仅道路路网要素 (AB 道路中心线, AA 交通线, AX 路网)
  if (vectorType === 'road') {
    return upper === 'AB' || upper === 'AX' || upper === 'AA' || upper.includes('ROAD');
  }

  // 4. 基础底图要素 (建筑CE、水系面BM、水系线AN、绿地面CK、地块面AP、道路网AB、底板BV)
  if (vectorType === 'base') {
    return upper === 'CE' || upper === 'BM' || upper === 'AN' || upper === 'CK' || upper === 'AP' || upper === 'BV' || upper === 'AB';
  }

  // 5. 文字注记要素 (POI标注BI、交通标注AA、路网注记AX、水系注记BK等)
  if (vectorType === 'label') {
    if (upper === 'BI' || upper === 'AA' || upper === 'AX' || upper === 'BK' || upper.includes('LABEL') || upper.includes('ANNO')) {
      return true;
    }
    if (features && features.some((f) => f.geometry && (f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint'))) {
      return true;
    }
    return false;
  }

  return true;
}

class GeoJsonExporter {
  constructor() {
    this.jobs = new Map();
  }

  /**
   * 初始化一个新的导出任务
   * @param {string} jobId 任务ID
   * @param {string} saveDir 保存目录
   * @param {string} vectorType 矢量类型 (all, base, building, road, label)
   */
  async startJob(jobId, saveDir, vectorType = 'all') {
    const normalizedDir = path.normalize(saveDir);
    await fsp.mkdir(normalizedDir, { recursive: true });
    this.jobs.set(jobId, {
      saveDir: normalizedDir,
      vectorType: vectorType || 'all',
      featureCounts: {},
      totalCount: 0,
    });
    return { success: true };
  }

  /**
   * 写入单个瓦片解析出的图层要素
   * @param {string} jobId
   * @param {Record<string, Array<object>>} featuresByLayer
   */
  async appendFeatures(jobId, featuresByLayer) {
    const job = this.jobs.get(jobId);
    if (!job) return { success: false, error: 'Job not found' };

    for (const layerName in featuresByLayer) {
      const features = featuresByLayer[layerName];
      if (!features || !features.length) continue;

      // 根据矢量类型进行图层过滤
      if (!shouldIncludeLayer(layerName, job.vectorType, features)) {
        continue;
      }

      const tmpFile = path.join(job.saveDir, `.__tmp_${layerName}.jsonl`);
      const lines = features.map((f) => JSON.stringify(f)).join('\n') + '\n';
      await fsp.appendFile(tmpFile, lines, 'utf8');

      job.featureCounts[layerName] = (job.featureCounts[layerName] || 0) + features.length;
      job.totalCount += features.length;
    }

    return { success: true, count: job.totalCount };
  }

  /**
   * 结束任务：将各图层的 .jsonl 包装为规范的 .geojson 文件
   * @param {string} jobId
   */
  async finishJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return { success: false, error: 'Job not found' };

    const exportedFiles = [];
    const allFeatures = [];

    // 1. 生成各分图层 GeoJSON
    for (const layerName in job.featureCounts) {
      const tmpFile = path.join(job.saveDir, `.__tmp_${layerName}.jsonl`);
      let content = '';
      try {
        content = await fsp.readFile(tmpFile, 'utf8');
      } catch {
        continue;
      }
      const lines = content.trim().split('\n').filter(Boolean);
      const layerFeatures = lines.map((l) => JSON.parse(l));

      const friendlyName = LAYER_NAME_MAP[layerName] || layerName;
      const geojsonObj = {
        type: 'FeatureCollection',
        name: `tianditu_${friendlyName}`,
        features: layerFeatures,
      };

      const finalPath = path.join(job.saveDir, `${friendlyName}.geojson`);
      await fsp.writeFile(finalPath, JSON.stringify(geojsonObj, null, 2), 'utf8');
      try {
        await fsp.unlink(tmpFile); // 删除临时缓存文件
      } catch {
        // ignore
      }

      exportedFiles.push({
        layer: friendlyName,
        count: layerFeatures.length,
        path: finalPath,
      });

      // 如果数据量在合理范围内，同时合并到汇总文件
      if (allFeatures.length + layerFeatures.length <= 100000) {
        allFeatures.push(...layerFeatures);
      }
    }

    // 2. 生成全要素汇总 all_layers.geojson
    if (allFeatures.length > 0) {
      const allPath = path.join(job.saveDir, 'all_layers.geojson');
      await fsp.writeFile(
        allPath,
        JSON.stringify(
          {
            type: 'FeatureCollection',
            name: `tianditu_all_${job.vectorType || 'layers'}`,
            features: allFeatures,
          },
          null,
          2
        ),
        'utf8'
      );
      exportedFiles.push({
        layer: 'all_layers',
        count: allFeatures.length,
        path: allPath,
      });
    }

    // 3. 自动生成图层与属性说明文档 图层与属性说明.txt
    try {
      const readmeLines = [
        '======================================================================',
        '天地图矢量切片导出图层与属性说明',
        '======================================================================',
        `导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        `矢量类型: ${job.vectorType || 'all'}`,
        `要素总数: ${job.totalCount}`,
        `图层文件数: ${exportedFiles.length}`,
        '',
        '【本次导出的图层清单及要素数量】',
      ];

      exportedFiles.forEach((file, index) => {
        readmeLines.push(`${index + 1}. ${path.basename(file.path)} (要素数: ${file.count})`);
      });

      readmeLines.push(
        '',
        '【天地图图层对照表】',
        '1. 建筑物_CE.geojson (代号 CE)：建筑物多边形面，包含三维建筑白模与楼层高度。',
        '2. 水系面_BM.geojson (代号 BM)：河流、湖泊、水库、水塘等多边形水面。',
        '3. 水系线_AN.geojson (代号 AN)：细小河流中心线、水系边线。',
        '4. 绿地面_CK.geojson (代号 CK)：公园、绿化带、草坪、林地多边形面。',
        '5. 地块面_AP.geojson (代号 AP)：城市规划建设用地、功能区地块面。',
        '6. 陆地底板_BV.geojson (代号 BV)：基础陆地轮廓面、背景底板。',
        '7. 道路网_AB.geojson (代号 AB)：道路路网中心线（高速、主干道、次干道、支路）。',
        '8. 水系注记_BK.geojson (代号 BK)：河流湖泊名称文字标注 (属性 Z5 为名称)。',
        '9. POI标注_BI.geojson (代号 BI)：小区、学校、医院、企事业单位等兴趣点与标注。',
        '10. 交通标注_AA.geojson (代号 AA)：道路名称、立交桥、交通路名沿线标注。',
        '11. 路网注记_AX.geojson (代号 AX)：路网设施注记。',
        '12. all_layers.geojson：全要素汇总文件（可直接在 QGIS/ArcGIS 中一键加载预览全量数据）。',
        '',
        '【核心属性字段定义】',
        '* Z5 / name : 地物名称、地名、路名、水系名等文本注记内容',
        '* h        : 建筑物实际高度（单位：米，可直接用于三维拉伸建模）',
        '* floor    : 建筑物楼层数',
        '* elemid   : 建筑物唯一要素编码',
        '* S8/A6/B1 : 天地图国家基础地理信息分类代码',
        '======================================================================'
      );

      const readmePath = path.join(job.saveDir, '图层与属性说明.txt');
      await fsp.writeFile(readmePath, readmeLines.join('\r\n'), 'utf8');
    } catch (e) {
      console.warn('[GeoJSON Exporter] 写入说明文件失败:', e);
    }

    this.jobs.delete(jobId);
    return {
      success: true,
      totalCount: job.totalCount,
      files: exportedFiles,
    };
  }

  /**
   * 取消任务并清理临时文件
   */
  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      const files = await fsp.readdir(job.saveDir);
      for (const f of files) {
        if (f.startsWith('.__tmp_')) {
          await fsp.unlink(path.join(job.saveDir, f));
        }
      }
    } catch {
      // 忽略清理异常
    }
    this.jobs.delete(jobId);
  }
}

const geoJsonExporter = new GeoJsonExporter();

module.exports = {
  geoJsonExporter,
  LAYER_NAME_MAP,
  shouldIncludeLayer,
};
