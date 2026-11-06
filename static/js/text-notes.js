// 文字小工具的紀錄：寫過的內容自動存在老師的 settings.json（settings.textNotes），換電腦、換白板都找得到
// 每則：{ id, html, text, at }；同一則（同一個 id）繼續編輯時更新，不會每打一個字就多一筆

export const MAX_NOTES = 200; // 太多時刪掉最舊的，避免 settings.json 太大
export const MAX_HTML = 20000;

// html → 純文字（搜尋、預覽用）；在瀏覽器以外（測試）用簡單的取代
export function htmlToText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<(div|p|li)\b[^>]*>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/[\u{E0100}-\u{E01EF}]/gu, '') // 注音字型的破音字選擇符（看不見），搜尋時不算
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

// 新增或更新一則；空白內容不記錄。回傳是否有改變
export function upsertNote(list, { id, html }, now = Date.now(), max = MAX_NOTES) {
  if (!Array.isArray(list) || !id) return false;
  const text = htmlToText(html);
  if (!text) return false;
  const clean = String(html).slice(0, MAX_HTML);
  const i = list.findIndex((n) => n.id === id);
  if (i >= 0) {
    if (list[i].html === clean) return false;
    list.splice(i, 1);
  }
  list.unshift({ id, html: clean, text: text.slice(0, 2000), at: now });
  if (list.length > max) list.length = max;
  return true;
}

export function deleteNote(list, id) {
  const i = Array.isArray(list) ? list.findIndex((n) => n.id === id) : -1;
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

// 搜尋（空白分隔多個關鍵字都要符合），最新的在前
export function searchNotes(list, q = '') {
  const words = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n.html === 'string' && words.every((w) => String(n.text || '').toLowerCase().includes(w)))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

export const newNoteId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
