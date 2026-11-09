import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { docxToHtml, readZip, parseXml, formatNumber } from '../static/js/docx.js';
import { makeZip } from './helpers.mjs';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const doc = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`;
const STYLES = `<w:styles ${W}>
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="a"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
</w:styles>`;
const RELS = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/a?b=1&amp;c=2" TargetMode="External"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
</Relationships>`;
const NUMBERING = `<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="taiwaneseCountingThousand"/><w:lvlText w:val="%1、"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="(%2)"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

async function render(body, extra = {}, opts = {}) {
  const buf = await makeZip({
    'word/document.xml': doc(body),
    'word/styles.xml': STYLES,
    'word/_rels/document.xml.rels': RELS,
    'word/numbering.xml': NUMBERING,
    ...extra,
  }, opts);
  return docxToHtml(buf, { imageUrl: (path, data) => `blob:${path}:${data.length}` });
}

describe('Word（.docx）轉成 HTML', () => {
  it('讀取 ZIP：壓縮與不壓縮的檔案都可以', async () => {
    const buf = await makeZip({ 'a.txt': '你好', 'b.txt': 'abc' }, { store: ['b.txt'] });
    const zip = readZip(buf);
    const dec = new TextDecoder();
    assert.equal(dec.decode(await zip.get('a.txt')()), '你好');
    assert.equal(dec.decode(await zip.get('b.txt')()), 'abc');
    assert.throws(() => readZip(new TextEncoder().encode('not a zip').buffer));
  });

  it('XML：屬性、實體字元、自己結束的標籤', () => {
    const root = parseXml('<?xml version="1.0"?><a x="1 &amp; 2"><b/><c>&lt;好&#x4E2D;&#25991;&gt;</c></a>');
    const a = root.children[0];
    assert.equal(a.attrs.x, '1 & 2');
    assert.deepEqual(a.children.map((c) => c.name), ['b', 'c']);
    assert.equal(a.children[1].children[0].text, '<好中文>');
  });

  it('段落、粗體、顏色、字大小（相對於預設大小）、置中、上下標', async () => {
    const { html } = await render(`
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr>
        <w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>第 3 題</w:t></w:r>
        <w:r><w:t xml:space="preserve"> 答案改為 </w:t></w:r>
        <w:r><w:rPr><w:sz w:val="48"/><w:u w:val="single"/></w:rPr><w:t>(B)</w:t></w:r>
        <w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r>
      </w:p>`);
    assert.equal(html, '<p class="dx-p" style="text-align:center"><span style="font-weight:700;color:#FF0000">第 3 題</span> 答案改為 <span style="text-decoration:underline;font-size:2em">(B)</span><sup>2</sup></p>');
  });

  it('標題、空白段落、換行與定位點', async () => {
    const { html } = await render(`
      <w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>試題疑義</w:t></w:r></w:p>
      <w:p/>
      <w:p><w:r><w:t>甲</w:t><w:tab/><w:t>乙</w:t><w:br/><w:t>丙</w:t></w:r></w:p>`);
    assert.match(html, /^<h2 class="dx-p"><span style="font-weight:700;font-size:1\.5em">試題疑義<\/span><\/h2>/);
    assert.match(html, /<p class="dx-p"><br><\/p>/);
    assert.match(html, /甲<span class="dx-tab">\t<\/span>乙<br>丙/);
  });

  it('文字會跳脫，不會變成網頁程式', async () => {
    const { html } = await render('<w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "x"</w:t></w:r></w:p>');
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;x&quot;/);
  });

  it('超連結：只接受 http(s) 網址', async () => {
    const { html } = await render(`
      <w:p><w:hyperlink r:id="rId1"><w:r><w:t>說明</w:t></w:r></w:hyperlink></w:p>
      <w:p><w:hyperlink r:id="rId3"><w:r><w:t>壞連結</w:t></w:r></w:hyperlink></w:p>`);
    assert.match(html, /<a class="dx-link" href="https:\/\/example\.com\/a\?b=1&amp;c=2" data-href="https:\/\/example\.com\/a\?b=1&amp;c=2">說明<\/a>/);
    assert.ok(!html.includes('javascript'));
    assert.match(html, /<p class="dx-p">壞連結<\/p>/);
  });

  it('編號：一、二、和 (1)(2)，下一層重新編號', async () => {
    const item = (lvl, t) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const { html } = await render(item(0, 'A') + item(1, 'a') + item(1, 'b') + item(0, 'B') + item(1, 'c'));
    const nums = [...html.matchAll(/<span class="dx-num">([^<]*)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(nums, ['一、', '(1)', '(2)', '二、', '(1)']);
  });

  it('樣式自帶的編號（Word 的「編號清單」）', async () => {
    const item = (t) => `<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const { html } = await render(item('A') + item('B'));
    const nums = [...html.matchAll(/<span class="dx-num">([^<]*)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(nums, ['一、', '二、']);
  });

  it('數字格式', () => {
    assert.equal(formatNumber(1, 'taiwaneseCountingThousand'), '一');
    assert.equal(formatNumber(10, 'taiwaneseCountingThousand'), '十');
    assert.equal(formatNumber(23, 'taiwaneseCountingThousand'), '二十三');
    assert.equal(formatNumber(3, 'decimalEnclosedCircle'), '③');
    assert.equal(formatNumber(4, 'upperRoman'), 'IV');
    assert.equal(formatNumber(28, 'lowerLetter'), 'ab');
    assert.equal(formatNumber(2, 'ideographTraditional'), '乙');
  });

  it('表格：合併儲存格', async () => {
    const { html } = await render(`
      <w:tbl>
        <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>題號與答案</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>`);
    assert.equal(html, '<table class="dx-table">'
      + '<tr><td colspan="2"><p class="dx-p">題號與答案</p></td></tr>'
      + '<tr><td rowspan="2"><p class="dx-p">3</p></td><td><p class="dx-p">B</p></td></tr>'
      + '<tr><td><p class="dx-p">C</p></td></tr></table>');
  });

  it('圖片：用 imageUrl 取得網址，寬度換成像素；同一張圖只讀一次', async () => {
    const pic = `<w:r><w:drawing><wp:inline xmlns:wp="x"><wp:extent cx="952500" cy="476250"/><a:graphic xmlns:a="y"><a:graphicData><pic:pic xmlns:pic="z"><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const r = await render(`<w:p>${pic}${pic}</w:p>`, { 'word/media/image1.png': new Uint8Array([1, 2, 3]) });
    assert.equal(r.images, 2);
    assert.equal(r.html, '<p class="dx-p"><img src="blob:word/media/image1.png:3" alt="" style="width:100px"><img src="blob:word/media/image1.png:3" alt="" style="width:100px"></p>');
  });

  it('追蹤修訂刪除的文字、隱藏文字不顯示', async () => {
    const { html } = await render(`<w:p><w:r><w:t>保留</w:t></w:r><w:del><w:r><w:delText>刪掉</w:delText></w:r></w:del><w:ins><w:r><w:t>新增</w:t></w:r></w:ins><w:r><w:rPr><w:vanish/></w:rPr><w:t>隱藏</w:t></w:r></w:p>`);
    assert.equal(html, '<p class="dx-p">保留新增</p>');
  });

  it('不是 Word 檔時丟出錯誤', async () => {
    await assert.rejects(() => docxToHtml(new TextEncoder().encode('hello').buffer));
    const buf = await makeZip({ 'x.txt': 'x' });
    await assert.rejects(() => docxToHtml(buf), /找不到/);
  });
});
