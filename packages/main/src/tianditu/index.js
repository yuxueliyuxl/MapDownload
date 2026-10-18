/**
 * 天地图矢量解析与导出模块统一入口
 */

const { xyz2pk, pk2xyz } = require('./pk');
const { is_tvt_cipher, decrypt_tvt_binary } = require('./tvt');
const { geoJsonExporter } = require('./geojsonExporter');
const vts = require('./vts');
const geom = require('./geometry');

/**
 * 将单个天地图切片二进制数据转为按图层划分的 GeoJSON Features
 * @param {Buffer|Uint8Array} rawData
 * @param {{x: number, y: number, z: number}} tile
 * @returns {Promise<Record<string, Array<object>>>}
 */
async function parseTileToGeoJSON(rawData, tile) {
  geom.validateXYZ(tile);

  let b = Buffer.from(rawData);
  // tvt 密文流自动解密
  if (is_tvt_cipher(b)) {
    const plain = decrypt_tvt_binary(b);
    if (plain && plain.length) b = plain;
  }

  const { layers } = vts.parse_vts_tile(b);
  const result = {};

  for (const layer of layers) {
    if (!layer.name || !layer.features || !layer.features.length) continue;
    const features = [];
    for (let i = 0; i < layer.features.length; i++) {
      const f = layer.features[i];
      try {
        const gf = geom.featureToGeoJSON(f, layer, tile, i);
        if (gf) features.push(gf);
      } catch {
        // 跳过损坏的个别图元
      }
    }
    if (features.length > 0) {
      result[layer.name] = (result[layer.name] || []).concat(features);
    }
  }

  return result;
}

module.exports = {
  xyz2pk,
  pk2xyz,
  is_tvt_cipher,
  decrypt_tvt_binary,
  parseTileToGeoJSON,
  geoJsonExporter,
};
