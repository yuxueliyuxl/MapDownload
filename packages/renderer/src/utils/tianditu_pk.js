/**
 * 前端使用的天地图瓦片坐标 XYZ -> pk 编码
 */
export function xyz2pk(x, y, z) {
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
