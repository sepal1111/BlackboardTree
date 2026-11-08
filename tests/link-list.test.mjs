import { MemFs } from './helpers.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkList, fileGroup, loadLinkLists, filterLinks, groupLinks, LINK_SAMPLE } from '../static/js/link-list.js';
import { FolderBackend, LocalBackend } from '../static/js/backends/index.js';
import { toEmbedUrl } from '../static/js/widgets/media.js';

describe('parseLinkList：網址清單的寫法', () => {
  it('分類標題、名稱與網址、說明行', () => {
    const items = parseLinkList(`# 說明
[七年級]
國文 試題疑義 https://docs.google.com/presentation/d/abc/preview

【八年級】
數學：更正說明 https://www.canva.com/design/X/Y/view
九年級
// 這行不顯示
英語 | https://example.com/a`);
    assert.deepEqual(items, [
      { group: '七年級', name: '國文 試題疑義', url: 'https://docs.google.com/presentation/d/abc/preview' },
      { group: '八年級', name: '數學：更正說明', url: 'https://www.canva.com/design/X/Y/view' },
      { group: '九年級', name: '英語', url: 'https://example.com/a' },
    ]);
  });

  it('Excel 存的 CSV、Tab：欄位變成空格，網址的引號拿掉', () => {
    const items = parseLinkList('七年級,國文,"https://a.com/x"\r\n八年級\t數學\thttps://b.com/y\r\n');
    assert.deepEqual(items.map((i) => [i.group, i.name, i.url]), [
      ['', '七年級 國文', 'https://a.com/x'],
      ['', '八年級 數學', 'https://b.com/y'],
    ]);
  });

  it('只有網址：名稱用網址後面的文字，沒有就用網站名稱；網址後面的標點拿掉', () => {
    const items = parseLinkList('https://a.com/x 國文更正\nhttps://www.b.com/y。');
    assert.equal(items[0].name, '國文更正');
    assert.deepEqual(items[1], { group: '', name: 'www.b.com', url: 'https://www.b.com/y' });
  });

  it('檔名當作預設分類', () => {
    assert.equal(fileGroup('網址清單-七年級.txt'), '七年級');
    assert.equal(fileGroup('網址清單(八年級).txt'), '八年級');
    assert.equal(fileGroup('網址清單.txt'), '');
    assert.equal(fileGroup('網址清單 (1).txt'), '');
    assert.equal(fileGroup('網址清單-七年級 - 複製.txt'), '七年級');
    assert.equal(parseLinkList('國文 https://a.com', '七年級')[0].group, '七年級');
  });

  it('範例檔可以解析', () => {
    const items = parseLinkList(LINK_SAMPLE);
    assert.equal(items.length, 4);
    assert.deepEqual([...new Set(items.map((i) => i.group))], ['七年級', '八年級']);
  });
});

describe('loadLinkLists：讀取白板資料夾裡的網址清單', () => {
  it('讀取「網址清單」開頭的 .txt，其他檔案不讀', async () => {
    const fs = new MemFs();
    await fs.write('MyScreen/網址清單.txt', '[七年級]\n國文 https://a.com/1\n');
    await fs.write('MyScreen/網址清單-八年級.txt', '數學 https://a.com/2\n');
    await fs.write('MyScreen/筆記.txt', '不要 https://a.com/3\n');
    await fs.write('MyScreen/boards/x.json', '{}');
    const r = await loadLinkLists(new FolderBackend(fs));
    assert.deepEqual(r.files, ['網址清單-八年級.txt', '網址清單.txt']);
    assert.deepEqual(r.items.map((i) => [i.group, i.name]), [['八年級', '數學'], ['七年級', '國文']]);
  });

  it('Big5 編碼（舊版記事本）也看得懂', async () => {
    const fs = new MemFs();
    // 「國文 https://a.com」的 Big5
    const big5 = new Uint8Array([0xb0, 0xea, 0xa4, 0xe5, 0x20, ...Buffer.from('https://a.com')]);
    await fs.write('網址清單.txt', big5);
    const r = await loadLinkLists(new FolderBackend(fs, { dataDir: '' }));
    assert.deepEqual(r.items[0], { group: '', name: '國文', url: 'https://a.com', file: '網址清單.txt' });
  });

  it('同一份清單放兩次不會重複；只存在這台電腦時沒有清單', async () => {
    const fs = new MemFs();
    await fs.write('MyScreen/網址清單.txt', '國文 https://a.com\n');
    await fs.write('MyScreen/網址清單 (1).txt', '國文 https://a.com\n');
    assert.equal((await loadLinkLists(new FolderBackend(fs))).items.length, 1);
    assert.deepEqual(await loadLinkLists(new LocalBackend()), { files: [], items: [] });
  });
});

describe('搜尋與分組', () => {
  const items = parseLinkList('[七年級]\n國文 https://a.com/1\n數學 https://a.com/2\n[八年級]\n數學 https://a.com/3');
  it('每個字都要符合', () => {
    assert.equal(filterLinks(items, '數學').length, 2);
    assert.deepEqual(filterLinks(items, '七 數學').map((i) => i.url), ['https://a.com/2']);
    assert.equal(filterLinks(items, '  ').length, 3);
  });
  it('依分類分組，保留順序', () => {
    assert.deepEqual(groupLinks(items).map((g) => [g.group, g.items.length]), [['七年級', 2], ['八年級', 1]]);
  });
});

describe('toEmbedUrl：放進網頁框的網址', () => {
  it('Google 簡報、文件、雲端硬碟檔案改用 /preview', () => {
    assert.equal(toEmbedUrl('https://docs.google.com/presentation/d/abc/edit?usp=sharing'), 'https://docs.google.com/presentation/d/abc/preview');
    assert.equal(toEmbedUrl('https://docs.google.com/presentation/d/abc/present#slide=id.p'), 'https://docs.google.com/presentation/d/abc/preview');
    assert.equal(toEmbedUrl('https://drive.google.com/file/d/abc/view?usp=drive_link'), 'https://drive.google.com/file/d/abc/preview');
    assert.equal(toEmbedUrl('https://docs.google.com/presentation/d/e/xyz/pub?start=false'), 'https://docs.google.com/presentation/d/e/xyz/pub?start=false');
  });
  it('Canva 公開檢視連結加上 ?embed', () => {
    assert.equal(toEmbedUrl('https://www.canva.com/design/DAF1/abc/view?utm_content=x&utm_source=publishsharelink'), 'https://www.canva.com/design/DAF1/abc/view?embed');
    assert.equal(toEmbedUrl('https://www.canva.com/design/DAF1/view?embed'), 'https://www.canva.com/design/DAF1/view?embed');
  });
  it('其他網址不變', () => {
    assert.equal(toEmbedUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(toEmbedUrl('not a url'), null);
  });
});
