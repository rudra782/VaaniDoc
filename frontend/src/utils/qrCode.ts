// Self-contained QR encoder for a Version 20-L symbol. It runs entirely in the
// browser and supports the concise UTF-8 handout payload used by the dashboard.
const VERSION = 20;
const SIZE = VERSION * 4 + 17;
const DATA_CODEWORDS = 861;
const ECC_CODEWORDS_PER_BLOCK = 28;
const BLOCK_DATA_LENGTHS = [107, 107, 107, 108, 108, 108, 108, 108];
const ALIGNMENT_CENTERS = [6, 34, 62, 90];

const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);
let value = 1;
for (let i = 0; i < 255; i += 1) {
  gfExp[i] = value;
  gfLog[value] = i;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let i = 255; i < gfExp.length; i += 1) gfExp[i] = gfExp[i - 255];

const multiply = (a: number, b: number) => a && b ? gfExp[gfLog[a] + gfLog[b]] : 0;

const generatorPolynomial = (degree: number) => {
  let result = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(result.length + 1).fill(0);
    result.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= multiply(coefficient, gfExp[i]);
    });
    result = next;
  }
  return result;
};

const calculateEcc = (data: number[]) => {
  const generator = generatorPolynomial(ECC_CODEWORDS_PER_BLOCK);
  const remainder = new Array(ECC_CODEWORDS_PER_BLOCK).fill(0);
  data.forEach(byte => {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < remainder.length; i += 1) remainder[i] ^= multiply(generator[i + 1], factor);
  });
  return remainder;
};

const appendBits = (target: number[], value: number, length: number) => {
  for (let i = length - 1; i >= 0; i -= 1) target.push((value >>> i) & 1);
};

const createCodewords = (text: string) => {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // Byte mode
  appendBits(bits, bytes.length, 16);
  bytes.forEach(byte => appendBits(bits, byte, 8));
  if (bits.length > DATA_CODEWORDS * 8) throw new Error('The handout summary is too long to encode as a local QR code.');
  appendBits(bits, 0, Math.min(4, DATA_CODEWORDS * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) data.push(pad % 2 ? 0x11 : 0xec);

  const blocks: number[][] = [];
  let offset = 0;
  BLOCK_DATA_LENGTHS.forEach(length => {
    blocks.push(data.slice(offset, offset + length));
    offset += length;
  });
  const eccBlocks = blocks.map(calculateEcc);
  const result: number[] = [];
  for (let i = 0; i < Math.max(...BLOCK_DATA_LENGTHS); i += 1) blocks.forEach(block => { if (i < block.length) result.push(block[i]); });
  for (let i = 0; i < ECC_CODEWORDS_PER_BLOCK; i += 1) eccBlocks.forEach(block => result.push(block[i]));
  return result;
};

const bchRemainder = (value: number, polynomial: number) => {
  const degree = (number: number) => 31 - Math.clz32(number);
  while (degree(value) >= degree(polynomial)) value ^= polynomial << (degree(value) - degree(polynomial));
  return value;
};

export const createQrMatrix = (text: string): boolean[][] => {
  const modules: Array<Array<boolean | null>> = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const setFinder = (row: number, column: number) => {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) {
      if (row + r < 0 || row + r >= SIZE || column + c < 0 || column + c >= SIZE) continue;
      modules[row + r][column + c] = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
    }
  };
  setFinder(0, 0);
  setFinder(SIZE - 7, 0);
  setFinder(0, SIZE - 7);
  for (let i = 8; i < SIZE - 8; i += 1) {
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0;
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0;
  }
  ALIGNMENT_CENTERS.forEach(row => ALIGNMENT_CENTERS.forEach(column => {
    if (modules[row][column] !== null) return;
    for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) modules[row + r][column + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
  }));

  const versionBits = (VERSION << 12) | bchRemainder(VERSION << 12, 0x1f25);
  for (let i = 0; i < 18; i += 1) {
    const bit = ((versionBits >>> i) & 1) === 1;
    modules[Math.floor(i / 3)][i % 3 + SIZE - 11] = bit;
    modules[i % 3 + SIZE - 11][Math.floor(i / 3)] = bit;
  }
  const formatData = 0b01000; // Error correction L, mask 0
  const formatBits = ((formatData << 10) | bchRemainder(formatData << 10, 0x537)) ^ 0x5412;
  for (let i = 0; i < 15; i += 1) {
    const bit = ((formatBits >>> i) & 1) === 1;
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[SIZE - 15 + i][8] = bit;
    if (i < 8) modules[8][SIZE - i - 1] = bit;
    else if (i === 8) modules[8][7] = bit;
    else modules[8][14 - i] = bit;
  }
  modules[SIZE - 8][8] = true;

  const dataBits: number[] = [];
  createCodewords(text).forEach(byte => appendBits(dataBits, byte, 8));
  let bitIndex = 0;
  let row = SIZE - 1;
  let direction = -1;
  for (let column = SIZE - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    while (true) {
      for (let offset = 0; offset < 2; offset += 1) if (modules[row][column - offset] === null) {
        const raw = dataBits[bitIndex++] === 1;
        modules[row][column - offset] = ((row + column - offset) % 2 === 0) ? !raw : raw;
      }
      row += direction;
      if (row < 0 || row >= SIZE) { row -= direction; direction = -direction; break; }
    }
  }
  return modules.map(rowModules => rowModules.map(Boolean));
};
