// 畫面偏好：工具列位置、圖示大小、工具列文字、要顯示哪些小工具、畫布格線
// 存在老師的 settings.json（{ ui: {...} }），換到其他電腦也會套用

export const DOCK_POSITIONS = [
  { value: 'bottom', label: '下', arrow: '👇', where: '下方' },
  { value: 'top', label: '上', arrow: '👆', where: '上方' },
  { value: 'left', label: '左', arrow: '👈', where: '左側' },
  { value: 'right', label: '右', arrow: '👉', where: '右側' },
];

// px：圖示大小（中 = 原本的大小）
export const ICON_SIZES = [
  { value: 'xs', label: '迷你', px: 14 },
  { value: 's', label: '小', px: 18 },
  { value: 'm', label: '中', px: 24 },
  { value: 'l', label: '大', px: 32 },
  { value: 'xl', label: '特大', px: 42 },
];

// 工具列文字：自動 = 視窗小的時候（例如 1366×768 筆電、投影機）只顯示圖示
export const LABEL_MODES = [
  { value: 'auto', label: '自動' },
  { value: 'show', label: '顯示' },
  { value: 'hide', label: '隱藏' },
];

// 畫布格線：格子大小是畫布寬度的幾分之一（1920 寬時約 30／60／120 px），換到不同解析度的螢幕仍然對齊
export const GRID_SIZES = [
  { value: 'off', label: '關閉' },
  { value: 's', label: '小', cols: 64 },
  { value: 'm', label: '中', cols: 32 },
  { value: 'l', label: '大', cols: 16 },
];
export const GRID_SHOW = [
  { value: 'drag', label: '拖曳時顯示' },
  { value: 'always', label: '一直顯示' },
];

export const DEFAULT_UI = Object.freeze({ dock: 'bottom', icon: 'm', labels: 'auto', grid: 'off', gridShow: 'drag', hidden: [] });

// 讀進來的設定可能是舊版、手動修改或其他版本寫的：不認得的值改回預設，
// hidden 只保留存在的小工具；全部隱藏時改回全部顯示（不然就沒辦法加小工具了）
export function normalizeUi(ui, types = []) {
  const src = ui && typeof ui === 'object' ? ui : {};
  const dock = DOCK_POSITIONS.some((p) => p.value === src.dock) ? src.dock : DEFAULT_UI.dock;
  const icon = ICON_SIZES.some((s) => s.value === src.icon) ? src.icon : DEFAULT_UI.icon;
  const labels = LABEL_MODES.some((m) => m.value === src.labels) ? src.labels : DEFAULT_UI.labels;
  const grid = GRID_SIZES.some((g) => g.value === src.grid) ? src.grid : DEFAULT_UI.grid;
  const gridShow = GRID_SHOW.some((g) => g.value === src.gridShow) ? src.gridShow : DEFAULT_UI.gridShow;
  let hidden = Array.isArray(src.hidden) ? [...new Set(src.hidden.filter((t) => types.includes(t)))] : [];
  if (types.length && hidden.length >= types.length) hidden = [];
  return { dock, icon, labels, grid, gridShow, hidden };
}

export const iconPx = (ui) => (ICON_SIZES.find((s) => s.value === ui.icon) || ICON_SIZES.find((s) => s.value === 'm')).px;
export const dockInfo = (ui) => DOCK_POSITIONS.find((p) => p.value === ui.dock) || DOCK_POSITIONS[0];

// 小工具列要顯示的工具（保持原本的順序）
export const visibleTools = (list, ui) => list.filter((d) => !ui.hidden.includes(d.type));

// 切換某個工具顯示／隱藏；至少要留一個
export function toggleTool(ui, type, show, types) {
  const hidden = show ? ui.hidden.filter((t) => t !== type) : [...ui.hidden, type];
  if (hidden.length >= types.length) return ui;
  return normalizeUi({ ...ui, hidden }, types);
}

// ---- 畫布格線與對齊
// 格子的邊長（px）；格線關閉時回傳 0
export function gridCell(ui, stageW) {
  const g = GRID_SIZES.find((x) => x.value === ui?.grid);
  return g?.cols && stageW > 0 ? stageW / g.cols : 0;
}
// 下一個格線大小（快捷鍵 G：關閉 → 小 → 中 → 大 → 關閉）
export function nextGrid(grid) {
  const i = GRID_SIZES.findIndex((g) => g.value === grid);
  return GRID_SIZES[(i + 1) % GRID_SIZES.length].value;
}
// 位置與大小都用畫布的比例（0～1）存；對齊時換成 px 算，再換回比例
const snapTo = (px, cell) => Math.round(px / cell) * cell;
// 移動：左上角對齊格線
export function snapMove(box, cell, W, H) {
  if (!cell || !W || !H) return { x: box.x, y: box.y };
  return { x: snapTo(box.x * W, cell) / W, y: snapTo(box.y * H, cell) / H };
}
// 調整大小：右下角對齊格線，而且不小於最小尺寸（px）
export function snapResize(box, cell, W, H, minW = 0, minH = 0) {
  if (!cell || !W || !H) return { w: box.w, h: box.h };
  const fix = (start, size, total, min) => {
    let end = snapTo((start + size) * total, cell);
    while (end - start * total < min - 0.5) end += cell;
    return (end - start * total) / total;
  };
  return { w: fix(box.x, box.w, W, minW), h: fix(box.y, box.h, H, minH) };
}
