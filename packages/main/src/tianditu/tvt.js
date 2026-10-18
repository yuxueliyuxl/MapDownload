/**
 * 天地图 tvt 接口密文流解密
 * 算法来源：tdt.js ye.decryptBinary 与 liuxspro/libs
 */
const { createHash } = require('crypto');

const SALT_LENGTH = 4;
const rot_right_1 = (x) => ((x >> 1) | ((x & 1) << 7)) & 255;
const to_hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = (d) => createHash('sha256').update(d).digest();

/**
 * 从密文前 32 字节恢复内嵌的 TK（逐字节取反后的 ASCII）
 */
function recover_tk(input) {
  if (input.length < 32) return undefined;
  const prefix = Buffer.from(input.subarray(0, 32));
  for (let i = 0; i < prefix.length; i++) prefix[i] = ~prefix[i] & 255;
  return prefix.toString('utf8');
}


/**
 * 判断输入是否为 tvt 密文流
 */
function is_tvt_cipher(input) {
  if (input.length < 32 + SALT_LENGTH) return false;
  const tk = recover_tk(input);
  return !!(tk && /^[0-9a-f]{16,64}$/.test(tk));
}

/**
 * 解密 tvt 密文流为 vts 载荷
 * @param {Uint8Array|Buffer} input
 * @param {string} [expect_tk]
 * @returns {Buffer|undefined}
 */
function decrypt_tvt_binary(input, expect_tk) {
  if (input.length < 32 + SALT_LENGTH) return undefined;
  const tk = recover_tk(input);
  if (!tk) return undefined;
  if (expect_tk !== undefined && tk !== expect_tk) return Buffer.alloc(0);

  const salt = input.subarray(32, 32 + SALT_LENGTH);
  const cipher = input.subarray(32 + SALT_LENGTH);

  // 种子是 hex(前缀) + hex(salt) 这串文本的 UTF-8 字节（小写 hex）
  const seed = to_hex(Buffer.from(tk, 'utf8')) + to_hex(salt);
  const key = sha256(Buffer.from(seed, 'utf8'));

  const out = Buffer.alloc(cipher.length);
  for (let i = 0; i < cipher.length; i++) {
    out[i] = (rot_right_1(cipher[i]) ^ key[i % key.length]) & 255;
  }
  return out;
}

module.exports = {
  is_tvt_cipher,
  decrypt_tvt_binary,
  recover_tk,
};
