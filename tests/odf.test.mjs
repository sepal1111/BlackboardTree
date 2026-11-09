import { makeZip } from './helpers.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toPt, odtToHtml, odsToHtml, odpToHtml } from '../static/js/odf.js';

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
  + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
  + 'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
  + 'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
  + 'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';
const content = (auto, body) => `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:automatic-styles>${auto}</office:automatic-styles><office:body>${body}</office:body></office:document-content>`;
const styles = (inner = '', auto = '') => `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}><office:styles>
  <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt"/></style:default-style>${inner}</office:styles>
  <office:automatic-styles>${auto}</office:automatic-styles></office:document-styles>`;

describe('ODF：長度單位', () => {
  it('cm、mm、in、pt 轉成 pt', () => {
    assert.equal(Math.round(toPt('2.54cm')), 72);
    assert.equal(Math.round(toPt('10mm') * 100) / 100, 28.35);
    assert.equal(toPt('1in'), 72);
    assert.equal(toPt('18pt'), 18);
    assert.equal(toPt('x'), null);
  });
});

describe('ODF 文字文件（.odt）', () => {
  it('段落、標題、粗體、顏色、超連結、清單、表格、圖片', async () => {
    const auto = `<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#ff0000"/></style:style>
      <style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>`;
    const body = `<office:text>
      <text:h text:outline-level="1">第一章</text:h>
      <text:p text:style-name="P1">你好<text:span text:style-name="T1">重點</text:span>&lt;b&gt;</text:p>
      <text:p><text:a xlink:href="https://example.com">連結</text:a><text:a xlink:href="javascript:alert(1)">壞連結</text:a></text:p>
      <text:list><text:list-item><text:p>項目一</text:p></text:list-item><text:list-item><text:p>項目二</text:p></text:list-item></text:list>
      <table:table><table:table-row><table:table-cell><text:p>A1</text:p></table:table-cell><table:table-cell><text:p>B1</text:p></table:table-cell></table:table-row></table:table>
      <text:p><draw:frame svg:width="2cm" svg:height="1cm"><draw:image xlink:href="Pictures/a.png"/></draw:frame></text:p>
    </office:text>`;
    const buf = await makeZip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': content(auto, body), 'styles.xml': styles(), 'Pictures/a.png': new Uint8Array([1, 2, 3]) });
    const seen = [];
    const { html, images } = await odtToHtml(buf, { imageUrl: (p, data) => { seen.push([p, data.length]); return 'blob:x'; } });
    assert.match(html, /<h\d[^>]*>第一章<\/h\d>/);
    assert.match(html, /text-align:center/);
    assert.match(html, /font-weight:bold[^>]*>重點|>重點/);
    assert.match(html, /color:#ff0000/);
    assert.match(html, /&lt;b&gt;/); // 文字要跳脫
    assert.ok(!/<b>/.test(html.replace(/<b>重點/, '')));
    assert.match(html, /data-href="https:\/\/example.com"/);
    assert.ok(!html.includes('javascript:'));
    assert.match(html, /<li[^>]*>.*項目一/s);
    assert.match(html, /<table[^>]*>.*A1.*B1/s);
    assert.match(html, /src="blob:x"/);
    assert.equal(images, 1);
    assert.deepEqual(seen, [['Pictures/a.png', 3]]);
  });

  it('不是 ODF 檔案時給清楚的錯誤', async () => {
    await assert.rejects(odtToHtml(new TextEncoder().encode('hello').buffer), /OpenDocument/);
    const buf = await makeZip({ 'content.xml': content('', '<office:spreadsheet/>'), 'styles.xml': styles() });
    await assert.rejects(odtToHtml(buf), /\.odt/);
  });
});

describe('ODF 試算表（.ods）', () => {
  it('每個工作表一個表格，去掉後面重複的空白列與欄，數字靠右', async () => {
    const body = `<office:spreadsheet><table:table table:name="成績">
      <table:table-row><table:table-cell office:value-type="string"><text:p>姓名</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>分數</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row>
      <table:table-row><table:table-cell office:value-type="string"><text:p>小明</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="95"><text:p>95</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row>
      <table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
    </table:table><table:table table:name="空白"><table:table-row><table:table-cell/></table:table-row></table:table></office:spreadsheet>`;
    const buf = await makeZip({ 'content.xml': content('', body), 'styles.xml': styles() });
    const { html } = await odsToHtml(buf);
    assert.match(html, /成績/);
    assert.ok(!html.includes('空白')); // 空的工作表不顯示
    assert.equal((html.match(/<tr>/g) || []).length, 2);
    assert.equal((html.match(/<td/g) || []).length, 4);
    assert.match(html, /text-align:right[^>]*>95/);
  });
});

describe('ODF 簡報（.odp）', () => {
  it('逐頁顯示，物件依位置排列，跳過備忘稿與頁碼', async () => {
    const st = styles('', '<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout>');
    const body = `<office:presentation>
      <draw:page draw:name="p1">
        <draw:frame presentation:class="title" svg:x="2.8cm" svg:y="1.575cm" svg:width="14cm" svg:height="3cm"><draw:text-box><text:p>標題</text:p></draw:text-box></draw:frame>
        <draw:frame presentation:class="page-number" svg:x="0cm" svg:y="0cm" svg:width="1cm" svg:height="1cm"><draw:text-box><text:p>1</text:p></draw:text-box></draw:frame>
        <draw:frame svg:x="0cm" svg:y="0cm" svg:width="28cm" svg:height="15.75cm"><draw:image xlink:href="Pictures/bg.png"/></draw:frame>
        <presentation:notes><draw:frame><draw:text-box><text:p>老師的備忘稿</text:p></draw:text-box></draw:frame></presentation:notes>
      </draw:page>
      <draw:page draw:name="p2"><draw:custom-shape svg:x="1cm" svg:y="1cm" svg:width="5cm" svg:height="2cm"><text:p>第二頁</text:p></draw:custom-shape></draw:page>
    </office:presentation>`;
    const buf = await makeZip({ 'content.xml': content('', body), 'styles.xml': st, 'Pictures/bg.png': new Uint8Array([9]) });
    const { html, slides, images } = await odpToHtml(buf, { imageUrl: () => 'blob:bg' });
    assert.equal(slides, 2);
    assert.equal(images, 1);
    assert.match(html, /aspect-ratio:793\.\d+\/446\.\d+/);
    assert.match(html, /left:10%;top:10%;width:50%/);
    assert.match(html, /od-title[^>]*font-size:2\.2em[^>]*>.*標題/s);
    assert.ok(!html.includes('備忘稿'));
    assert.ok(!/>1<\/p>/.test(html));
    assert.match(html, /第二頁/);
  });
});
