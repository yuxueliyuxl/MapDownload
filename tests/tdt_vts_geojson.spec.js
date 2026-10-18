const fs = require('fs');
const path = require('path');
const { parseTileToGeoJSON, geoJsonExporter } = require('../packages/main/src/tianditu/index.js');

async function runTest() {
  console.log('=== 开始天地图矢量转 GeoJSON 端到端测试 ===');

  const testDir = path.join(__dirname, 'test_output_geojson');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const sampleDir = 'C:\\Users\\vdmin\\.gemini\\antigravity\\brain\\c7ce6c55-b195-4062-814d-9e9d39043849\\scratch\\libs\\packages\\tianditu\\tests\\data';
  const vtsPath = path.join(sampleDir, 'vts.mvt');
  const tvtPath = path.join(sampleDir, 'tvt.mvt');
  const tvt2Path = path.join(sampleDir, 'tvt2.mvt');

  const jobId = 'test_job_' + Date.now();
  console.log('1. 初始化 Job:', jobId);
  const startRes = await geoJsonExporter.startJob(jobId, testDir);
  console.log('   startJob 结果:', startRes);

  // 测试 1: 解析标准 vts.mvt (x=1680, y=786, z=11)
  console.log('2. 解析 vts.mvt 瓦片...');
  const vtsBuf = fs.readFileSync(vtsPath);
  const vtsFeatures = await parseTileToGeoJSON(vtsBuf, { x: 1680, y: 786, z: 11 });
  const vtsLayers = Object.keys(vtsFeatures);
  console.log(`   解析出 ${vtsLayers.length} 个图层`);
  await geoJsonExporter.appendFeatures(jobId, vtsFeatures);

  // 测试 2: 解析 tvt.mvt 加密瓦片
  console.log('3. 解析加密 tvt.mvt 瓦片...');
  const tvtBuf = fs.readFileSync(tvtPath);
  const tvtFeatures = await parseTileToGeoJSON(tvtBuf, { x: 1680, y: 786, z: 11 });
  const tvtLayers = Object.keys(tvtFeatures);
  console.log(`   解析出 ${tvtLayers.length} 个图层`);
  await geoJsonExporter.appendFeatures(jobId, tvtFeatures);

  // 测试 3: 解析加密 tvt2.mvt 瓦片
  console.log('4. 解析加密 tvt2.mvt 瓦片...');
  const tvt2Buf = fs.readFileSync(tvt2Path);
  const tvt2Features = await parseTileToGeoJSON(tvt2Buf, { x: 1680, y: 786, z: 11 });
  const tvt2Layers = Object.keys(tvt2Features);
  console.log(`   解析出 ${tvt2Layers.length} 个图层`);
  await geoJsonExporter.appendFeatures(jobId, tvt2Features);

  // 完成任务
  console.log('5. 封包生成 GeoJSON 文件...');
  const finishRes = await geoJsonExporter.finishJob(jobId);
  console.log('   finishJob 结果:', finishRes);

  // 验证输出文件
  console.log('6. 验证输出目录中的 GeoJSON 文件...');
  const files = fs.readdirSync(testDir);
  console.log(`   共生成 ${files.length} 个文件:`, files.slice(0, 5), '...');

  const allLayersFile = path.join(testDir, 'all_layers.geojson');
  if (!fs.existsSync(allLayersFile)) {
    throw new Error('未找到汇总文件 all_layers.geojson！');
  }
  const allJson = JSON.parse(fs.readFileSync(allLayersFile, 'utf8'));
  console.log(`   all_layers.geojson 包含 ${allJson.features.length} 个 Feature，类型为 ${allJson.type}`);
  if (allJson.features.length > 0) {
    const f0 = allJson.features[0];
    console.log('   示例要素属性与几何类型:', {
      type: f0.type,
      geometryType: f0.geometry.type,
      layer: f0.properties.layer,
      sampleProps: Object.keys(f0.properties).slice(0, 5),
    });
  }

  console.log('=== 测试全部通过！===');
}

runTest().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
