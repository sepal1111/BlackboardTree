// 由 static/logo.svg 產生桌面版的圖示（build.ps1 每次建置時執行）
//   desktop/icon.png            256×256：視窗、工作列、系統匣
//   desktop/installer/icon.ico  16～256 多種大小：exe 與安裝程式
// 用法：node make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const svg = readFileSync(here('../static/logo.svg'));
const png = (size) => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());

writeFileSync(here('./icon.png'), png(256));

// ICO：每個大小存一張 PNG（Windows Vista 以後都支援）
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = SIZES.map(png);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // 保留
header.writeUInt16LE(1, 2); // 1 = 圖示
header.writeUInt16LE(SIZES.length, 4);
const dir = Buffer.alloc(16 * SIZES.length);
let offset = header.length + dir.length;
SIZES.forEach((s, i) => {
  const o = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, o);     // 寬（256 寫 0）
  dir.writeUInt8(s >= 256 ? 0 : s, o + 1); // 高
  dir.writeUInt8(0, o + 2);                // 調色盤
  dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4);             // color planes
  dir.writeUInt16LE(32, o + 6);            // 每像素位元數
  dir.writeUInt32LE(images[i].length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += images[i].length;
});
writeFileSync(here('./installer/icon.ico'), Buffer.concat([header, dir, ...images]));
console.log(`已由 static/logo.svg 產生圖示：icon.png、installer/icon.ico（${SIZES.join('、')}）`);
