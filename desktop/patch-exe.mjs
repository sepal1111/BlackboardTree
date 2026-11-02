// 把黑板樹圖示與版本資訊寫進 Neutralino 執行檔
// 用法：node patch-exe.mjs <來源 exe> <輸出 exe>
import fs from 'node:fs';
import * as ResEdit from 'resedit';

const [src, out] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(new URL('./neutralino.config.json', import.meta.url), 'utf8'));
const version = config.version || '1.0.0';

const exe = ResEdit.NtExecutable.from(fs.readFileSync(src));
const res = ResEdit.NtExecutableResource.from(exe);

// 圖示：取代所有圖示群組（沒有就新增一個）
const icon = ResEdit.Data.IconFile.from(fs.readFileSync(new URL('./installer/icon.ico', import.meta.url)));
const groups = res.entries.filter((e) => e.type === 14);
for (const g of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang ?? 1033, icon.icons.map((i) => i.data));
}

// 版本資訊（檔案內容、工作管理員顯示的名稱）
const [ma, mi, pa] = version.split('.').map((n) => parseInt(n, 10) || 0);
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
vi.setFileVersion(ma, mi, pa, 0, 1033);
vi.setProductVersion(ma, mi, pa, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: '黑板樹 Blackboard Tree',
  ProductName: '黑板樹 Blackboard Tree',
  CompanyName: '黑板樹',
  OriginalFilename: 'BlackboardTree.exe',
  InternalName: 'BlackboardTree',
  FileVersion: version,
  ProductVersion: version,
  LegalCopyright: '',
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
fs.writeFileSync(out, Buffer.from(exe.generate()));
console.log(`已寫入圖示與版本 ${version}：${out}`);
