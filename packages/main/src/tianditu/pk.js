/**
 * 天地图瓦片坐标 XYZ 与 pk 编码转换
 * 算法来源：tianditu 官方客户端与 liuxspro/libs 逆向实现
 */

function validateXYZ(tile) {
  const { x, y, z } = tile;
  if (![x, y, z].every(Number.isSafeInteger) || z < 0 || z > 30 ||
      x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw new Error('Invalid XYZ: require integers, 0 <= z <= 30, 0 <= x,y < 2^z.');
  }
  return { x, y, z };
}

/**
 * 将 Web Mercator 瓦片编号 (x, y, z) 转换为天地图 vts 接口使用的 pk 字符串
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {string} pk 字符串
 */
function xyz2pk(x, y, z) {
  validateXYZ({ x, y, z });
  const digits = [];
  for (let bit = 0; bit <= z; bit++) {
    digits.push(
      (Math.floor(x / 2 ** bit) % 2) +
      2 * (Math.floor(y / 2 ** bit) % 2) +
      (bit >= 6 && bit <= 9 ? 1 : 0)
    );
  }
  let result = '';
  for (let i = 0; i < digits.length;) {
    let j = i + 1;
    while (j < digits.length && digits[j] === digits[i]) j++;
    result += String.fromCharCode(97 + 3 * digits[i]);
    if (j > i + 1) result += String(j - i - 1);
    i = j;
  }
  return result;
}

/**
 * 将天地图 pk 字符串逆运算反推瓦片编号 (x, y, z)
 * @param {string} pk
 * @returns {{x: number, y: number, z: number}}
 */
function pk2xyz(pk) {
  if (typeof pk !== 'string' || !pk.length || pk.length > 128) {
    throw new Error('Invalid pk length.');
  }
  const digits = [];
  let offset = 0;
  for (const m of pk.matchAll(/([adgjm])(\d{0,2})/g)) {
    if (m.index !== offset) throw new Error('Invalid pk syntax.');
    offset += m[0].length;
    const count = 1 + Number(m[2] || 0);
    if (digits.length + count > 31) throw new Error('pk expands beyond supported z <= 30.');
    for (let i = 0; i < count; i++) digits.push((m[1].charCodeAt(0) - 97) / 3);
  }
  if (offset !== pk.length) throw new Error('Invalid pk syntax.');
  let x = 0, y = 0;
  digits.forEach((d, bit) => {
    d -= bit >= 6 && bit <= 9 ? 1 : 0;
    if (d < 0 || d > 3) throw new Error('Invalid pk digit after deobfuscation.');
    x += (d % 2) * 2 ** bit;
    y += Math.floor(d / 2) * 2 ** bit;
  });
  return validateXYZ({ x, y, z: digits.length - 1 });
}

module.exports = {
  xyz2pk,
  pk2xyz,
  validateXYZ,
};
