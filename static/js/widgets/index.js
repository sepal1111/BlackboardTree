import { clock, timer, stopwatch, exam } from './time.js';
import { names, groups, work, poll, sound, seats, points } from './classroom.js';
import { text, draw, image, qr, embed, webcam } from './media.js';
import { examdoc } from './exam-doc.js';

// 下方工具列的順序
export const widgetList = [timer, clock, stopwatch, exam, names, groups, seats, points, text, draw, image, work, sound, poll, qr, embed, examdoc, webcam];
// 工具列圖示：static/icons/tools/<type>.svg（手機遙控的下拉選單仍用 icon 的 emoji）
for (const w of widgetList) w.img = `icons/tools/${w.type}.svg`;
export const widgets = Object.fromEntries(widgetList.map((w) => [w.type, w]));

// 舊版白板裡的小工具：已移除的回傳 null，舊格式轉成新格式
const REMOVED = ['dice', 'traffic'];
export function upgradeWidget(w) {
  if (!w || REMOVED.includes(w.type)) return null;
  const st = w.state || {};
  if (w.type === 'calendar') { // 1.2 以前的「日期」併入時鐘日期，只顯示日期
    return { ...w, type: 'clock', state: { mode: 'none', date: st.month === false ? 'line' : 'month', roc: st.roc !== false } };
  }
  if (w.type === 'clock' && typeof st.date === 'boolean') { // 舊時鐘的「顯示日期」是勾選框
    return { ...w, state: { ...st, date: st.date ? 'line' : 'none' } };
  }
  return w;
}
