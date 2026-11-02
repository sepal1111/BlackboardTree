// 畫面偏好：工具列位置、圖示大小、要顯示哪些小工具
// 存在老師的 settings.json（{ ui: {...} }），換到其他電腦也會套用

export const DOCK_POSITIONS = [
  { value: 'bottom', label: '下', arrow: '👇', where: '下方' },
  { value: 'top', label: '上', arrow: '👆', where: '上方' },
  { value: 'left', label: '左', arrow: '👈', where: '左側' },
  { value: 'right', label: '右', arrow: '👉', where: '右側' },
];

// px：圖示大小（中 = 原本的大小）
export const ICON_SIZES = [
  { value: 's', label: '小', px: 18 },
  { value: 'm', label: '中', px: 24 },
  { value: 'l', label: '大', px: 32 },
  { value: 'xl', label: '特大', px: 42 },
];

export const DEFAULT_UI = Object.freeze({ dock: 'bottom', icon: 'm', hidden: [] });

// 讀進來的設定可能是舊版、手動修改或其他版本寫的：不認得的值改回預設，
// hidden 只保留存在的小工具；全部隱藏時改回全部顯示（不然就沒辦法加小工具了）
export function normalizeUi(ui, types = []) {
  const src = ui && typeof ui === 'object' ? ui : {};
  const dock = DOCK_POSITIONS.some((p) => p.value === src.dock) ? src.dock : DEFAULT_UI.dock;
  const icon = ICON_SIZES.some((s) => s.value === src.icon) ? src.icon : DEFAULT_UI.icon;
  let hidden = Array.isArray(src.hidden) ? [...new Set(src.hidden.filter((t) => types.includes(t)))] : [];
  if (types.length && hidden.length >= types.length) hidden = [];
  return { dock, icon, hidden };
}

export const iconPx = (ui) => (ICON_SIZES.find((s) => s.value === ui.icon) || ICON_SIZES[1]).px;
export const dockInfo = (ui) => DOCK_POSITIONS.find((p) => p.value === ui.dock) || DOCK_POSITIONS[0];

// 小工具列要顯示的工具（保持原本的順序）
export const visibleTools = (list, ui) => list.filter((d) => !ui.hidden.includes(d.type));

// 切換某個工具顯示／隱藏；至少要留一個
export function toggleTool(ui, type, show, types) {
  const hidden = show ? ui.hidden.filter((t) => t !== type) : [...ui.hidden, type];
  if (hidden.length >= types.length) return ui;
  return normalizeUi({ ...ui, hidden }, types);
}
