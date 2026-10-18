import { setState, setProgress, notifyStatusChange } from './progress';
import {
  downloadController,
  initPerformanceMonitor,
  updatePerformanceMonitor,
  getPerformanceStats,
  setCurrentQueue,
} from './download';
import { setMapLoading } from './baseMap.js';
import { getDownloadConcurrency } from './config';
import { DownloadQueue } from './downloadQueue';
import { xyz2pk } from './tianditu_pk.js';
import { getKeys } from './mapKey';
import { getFailedTilesManager } from './failedTilesManager';

function long2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tileGoogle(lat, zoom) {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
}

export class TileTdtVector {
  constructor(data) {
    this.savePath = data.savePath;
    this.minZoom = data.minZoom;
    this.maxZoom = data.maxZoom;
    this.extent = data.extent;
    this.downloadTarget = data.downloadTarget || 'tdt_vector';
    this.vectorType = data.vectorType || 'all';
    this.startDownload();
  }

  async startDownload() {
    downloadController.cancelled = false;
    downloadController.paused = false;

    // 1. 获取 Key
    const { tdtKey } = getKeys();
    const key = tdtKey || 'b88bfb160c81dab8d9d20aaa74846360';
    if (!tdtKey) {
      window.$message.info('未配置专属天地图Key，正在使用内置官方矢量Token下载');
    }

    // 2. 计算所有层级瓦片
    const tileList = [];
    const minZ = Math.min(this.minZoom, this.maxZoom);
    const maxZ = Math.max(this.minZoom, this.maxZoom);

    for (let z = minZ; z <= maxZ; z++) {
      const xmin_tile = Math.max(0, Math.min(long2tile(this.extent.xmin, z), long2tile(this.extent.xmax, z)));
      const xmax_tile = Math.min(Math.pow(2, z) - 1, Math.max(long2tile(this.extent.xmin, z), long2tile(this.extent.xmax, z)));
      const ymin_tile = Math.max(0, Math.min(lat2tileGoogle(this.extent.ymax, z), lat2tileGoogle(this.extent.ymin, z)));
      const ymax_tile = Math.min(Math.pow(2, z) - 1, Math.max(lat2tileGoogle(this.extent.ymax, z), lat2tileGoogle(this.extent.ymin, z)));

      for (let x = xmin_tile; x <= xmax_tile; x++) {
        for (let y = ymin_tile; y <= ymax_tile; y++) {
          const pk = xyz2pk(x, y, z);
          // 天地图官方矢量服务部署在 tile0、tile1、tile2（tile3~7不可用）
          // 在 tile0~2 之间进行轮询负载均衡，提升并发吞吐量
          const baseSub = (x + y) % 3;
          const url = `https://tile${baseSub}.tianditu.gov.cn/vts?t=vt&pk=${pk}&tk=${key}`;
          tileList.push({
            x,
            y,
            z,
            pk,
            sub: baseSub,
            url,
          });
        }
      }
    }

    if (tileList.length === 0) {
      setMapLoading(false);
      window.$message.warning('所选范围内没有需要下载的瓦片');
      return;
    }

    const VECTOR_TYPE_TEXT = {
      all: '全部要素 (底图+注记)',
      base: '基础底图要素 (建筑/道路/水系/绿地)',
      building: '建筑物要素 (轮廓与层高)',
      road: '道路路网要素 (路网与中心线)',
      label: '文字注记要素 (POI与地名标注)',
    };
    const typeLabel = VECTOR_TYPE_TEXT[this.vectorType] || this.vectorType;
    console.log(`[TDT-Vector] 🚀 开始天地图矢量下载: 范围 [${this.extent.xmin}, ${this.extent.ymin}] ~ [${this.extent.xmax}, ${this.extent.ymax}], 层级 ${minZ}~${maxZ}, 类型 [${typeLabel}], 共 ${tileList.length} 块瓦片`);

    // 3. 失败记录管理器初始化
    const failedManager = getFailedTilesManager();
    let failedTaskId = null;
    try {
      await failedManager.init();
      failedTaskId = failedManager.generateTaskId();
      await failedManager.createFailedTask({
        taskId: failedTaskId,
        taskConfig: {
          savePath: this.savePath,
          minZoom: this.minZoom,
          maxZoom: this.maxZoom,
          imageType: 'geojson',
          downloadTarget: this.downloadTarget,
          vectorType: this.vectorType,
        },
        totalTiles: tileList.length,
      });
    } catch (err) {
      console.warn('[TDT-Vector] 初始化失败记录器警告:', err);
    }

    // 4. 启动后端 GeoJSON Export Job
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      const startRes = await window.electron.ipcRenderer.invoke('start-tdt-geojson-job', {
        jobId,
        saveDir: this.savePath,
        vectorType: this.vectorType,
      });
      if (!startRes || !startRes.success) {
        setMapLoading(false);
        window.$message.error('启动 GeoJSON 导出任务失败: ' + (startRes?.error || '未知错误'));
        return;
      }
    } catch (err) {
      setMapLoading(false);
      console.error('start-tdt-geojson-job 失败:', err);
      window.$message.error('启动 GeoJSON 导出任务异常');
      return;
    }

    // 5. 初始化状态与监控
    const concurrency = getDownloadConcurrency();
    initPerformanceMonitor(concurrency);
    setState(true);

    const statistics = { success: 0, error: 0, percentage: 0, count: tileList.length };
    setProgress(statistics);

    // 6. 构建任务列表，支持自动重试与精准日志记录
    const tasks = tileList.map((tile) => ({
      handler: async () => {
        const maxRetries = 3;
        let attempt = 0;
        while (attempt < maxRetries) {
          attempt++;
          // 重试时自动轮转子域名 (tile0 -> tile1 -> tile2)
          const currentSub = (tile.sub + attempt - 1) % 3;
          const currentUrl = `https://tile${currentSub}.tianditu.gov.cn/vts?t=vt&pk=${tile.pk}&tk=${key}`;
          const param = {
            jobId,
            url: currentUrl,
            tile: {
              x: tile.x,
              y: tile.y,
              z: tile.z,
            },
            timeout: 30000,
          };

          try {
            const result = await window.electron.ipcRenderer.invoke('save-tdt-geojson-tile', param);
            if (result && result.success) {
              console.log(`[TDT-Vector] ✅ 瓦片成功: z=${tile.z}, x=${tile.x}, y=${tile.y} (节点: tile${currentSub}, 第${attempt}次尝试)`);
              return true;
            } else {
              console.warn(
                `[TDT-Vector] ⚠️ 瓦片失败: z=${tile.z}, x=${tile.x}, y=${tile.y} (节点: tile${currentSub}, 第 ${attempt} 次尝试), 原因:`,
                result?.error || '未知错误'
              );
            }
          } catch (error) {
            console.error(
              `[TDT-Vector] ❌ 瓦片调用异常: z=${tile.z}, x=${tile.x}, y=${tile.y} (节点: tile${currentSub}, 第 ${attempt} 次尝试):`,
              error
            );
          }

          if (attempt < maxRetries && !downloadController.cancelled) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }

        console.error(`[TDT-Vector] 🛑 瓦片彻底失败: z=${tile.z}, x=${tile.x}, y=${tile.y}, URL: ${tile.url}`);
        return false;
      },
      tileData: tile,
    }));

    // 7. 启动队列
    const queue = new DownloadQueue({
      concurrency,
      onProgress: (stats) => {
        statistics.success = stats.success;
        statistics.error = stats.error;
        statistics.percentage = stats.percentage;
        setProgress(statistics);

        const perfStats = updatePerformanceMonitor(stats);
        notifyStatusChange({ performance: perfStats });
      },
      onComplete: async (stats) => {
        statistics.success = stats.success;
        statistics.error = stats.error;
        statistics.percentage = 100;
        setProgress(statistics);
        setState(false);
        setMapLoading(false);

        const finalPerfStats = getPerformanceStats();
        setCurrentQueue(null);

        // 同步失败任务管理器状态
        if (failedManager && failedTaskId) {
          try {
            if (stats.error > 0) {
              await failedManager.updateFailedTask(failedTaskId, { failedCount: stats.error });
            } else {
              await failedManager.deleteFailedTask(failedTaskId);
            }
          } catch (e) {
            console.warn('[TDT-Vector] 更新失败任务记录失败:', e);
          }
        }

        if (stats.cancelled) {
          await window.electron.ipcRenderer.invoke('cancel-tdt-geojson-job', { jobId }).catch(() => {});
          window.$message.info(`下载已取消。已下载 ${stats.success} 瓦片，失败 ${stats.error} 瓦片`);
          console.log(`[TDT-Vector] 下载任务已取消: 成功 ${stats.success}, 失败 ${stats.error}`);
        } else {
          try {
            const finishRes = await window.electron.ipcRenderer.invoke('finish-tdt-geojson-job', { jobId });
            if (finishRes && finishRes.success) {
              const avgSpeed = finalPerfStats ? finalPerfStats.avgSpeed || 0 : 0;
              const elapsedTime = finalPerfStats ? finalPerfStats.elapsedTime || 0 : 0;
              window.$message.success(
                `天地图矢量 GeoJSON 导出完成！共提取 ${finishRes.totalFeatures} 个要素，保存至 ${finishRes.exportedFiles} 个图层文件及汇总文件。平均速度: ${avgSpeed} 瓦片/秒，耗时: ${elapsedTime} 秒`,
              );
              console.log(`[TDT-Vector] 🏁 导出成功: 要素总数 ${finishRes.totalFeatures}, 图层文件数 ${finishRes.exportedFiles}, 耗时 ${elapsedTime}s`);
            } else {
              window.$message.error('矢量数据导出完成，但写入文件失败: ' + (finishRes?.error || '未知错误'));
              console.error('[TDT-Vector] finish-tdt-geojson-job 写入文件失败:', finishRes?.error);
            }
          } catch (err) {
            console.error('[TDT-Vector] finish-tdt-geojson-job 异常:', err);
            window.$message.error('封包 GeoJSON 发生异常');
          }
        }

        notifyStatusChange({ downloading: false, queueStatus: null, failedCount: stats.error });
      },
      onTaskFailed: async (tileData) => {
        // 失败瓦片记录到持久化存储
        if (failedManager && failedTaskId && tileData) {
          try {
            await failedManager.addFailedTile({
              taskId: failedTaskId,
              tileUrl: tileData.url,
              savePath: `${this.savePath}/${tileData.z}_${tileData.x}_${tileData.y}.geojson`,
              tileData: {
                x: tileData.x,
                y: tileData.y,
                z: tileData.z,
              },
            });
          } catch (err) {
            console.error('[TDT-Vector] 记录失败瓦片错误:', err);
          }
        }
      },
    });

    setCurrentQueue(queue);
    queue.add(tasks);
    queue.start();
  }
}
