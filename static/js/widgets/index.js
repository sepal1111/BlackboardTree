import { clock, timer, stopwatch, calendar } from './time.js';
import { names, groups, dice, traffic, work, poll, sound, seats, points } from './classroom.js';
import { text, draw, image, qr, embed, webcam } from './media.js';

// 下方工具列的順序
export const widgetList = [timer, clock, stopwatch, names, groups, seats, points, text, draw, image, work, traffic, sound, dice, poll, qr, calendar, embed, webcam];
export const widgets = Object.fromEntries(widgetList.map((w) => [w.type, w]));
