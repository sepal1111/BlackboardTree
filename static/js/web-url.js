// 網址判斷：YouTube、社群網站影片、影片檔、一般網頁（匯入資源小工具、手機送網址共用）
// 不碰畫面，方便測試
const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)$/i;

// 判斷網址類型：youtube（嵌入播放器）、video（影片檔）、web（一般網頁）
export function classifyUrl(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtube.com') id = u.searchParams.get('v') || (u.pathname.match(/\/(shorts|live|embed|v)\/([\w-]{6,})/) || [])[2];
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  const list = u.searchParams.get('list');
  if (id || (host === 'youtube.com' && list)) {
    const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    return { kind: 'youtube', id, list, start, href: u.href };
  }
  const social = socialEmbed(u, host);
  if (social) return { kind: 'social', ...social, href: u.href };
  if (VIDEO_EXT.test(u.pathname)) return { kind: 'video', href: u.href };
  return { kind: 'web', href: u.href };
}

export const PLATFORMS = {
  facebook: { name: 'Facebook', icon: '📘' },
  instagram: { name: 'Instagram', icon: '📸' },
  threads: { name: 'Threads', icon: '🧵' },
  tiktok: { name: 'TikTok', icon: '🎵' },
  vimeo: { name: 'Vimeo', icon: '🎞️' },
};

// 社群網站的貼文／影片：轉成官方的嵌入網址。portrait = 直式影片（Reels、短影音）
function socialEmbed(u, host) {
  const path = u.pathname;
  const enc = encodeURIComponent;
  if (/^(facebook\.com|fb\.com|fb\.watch|web\.facebook\.com)$/.test(host)) {
    const href = enc(u.href);
    const reel = /\/(reel|share\/r)\//.test(path);
    if (host === 'fb.watch' || reel || /\/(videos|watch|share\/v)(\/|$)/.test(path)) {
      return { platform: 'facebook', portrait: reel, embed: `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false` };
    }
    if (/\/(posts|permalink\.php|share\/p|photo|story\.php)/.test(path)) {
      return { platform: 'facebook', portrait: true, embed: `https://www.facebook.com/plugins/post.php?href=${href}&show_text=true` };
    }
    return null; // 粉絲專頁首頁等：當一般網頁用瀏覽器開
  }
  if (host === 'instagram.com') {
    const m = path.match(/^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/);
    if (m) return { platform: 'instagram', portrait: true, embed: `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed/` };
    return null;
  }
  if (host === 'threads.net' || host === 'threads.com') {
    const m = path.match(/^\/(@[\w.]+)\/post\/([\w-]+)/);
    if (m) return { platform: 'threads', portrait: true, embed: `https://www.threads.com/${m[1]}/post/${m[2]}/embed` };
    return null;
  }
  if (host === 'tiktok.com') {
    const m = path.match(/\/video\/(\d+)/);
    if (m) return { platform: 'tiktok', portrait: true, embed: `https://www.tiktok.com/embed/v2/${m[1]}` };
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = path.match(/\/(?:video\/)?(\d+)(?:\/(\w+))?/);
    if (m) return { platform: 'vimeo', portrait: false, embed: `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}` };
  }
  return null;
}

// 用電腦的預設瀏覽器開啟（桌面版），網頁版則開新分頁
export async function openExternal(url) {
  if (window.Neutralino && window.NL_PORT) { await window.Neutralino.os.open(url); return true; }
  return !!window.open(url, '_blank', 'noopener');
}

export const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation';

export function youtubeSrc(info, autoplay) {
  const q = new URLSearchParams({ enablejsapi: '1', rel: '0', playsinline: '1' });
  if (autoplay) q.set('autoplay', '1');
  if (info.start) q.set('start', info.start);
  if (info.list) q.set('list', info.list);
  return `https://www.youtube-nocookie.com/embed/${info.id || 'videoseries'}?${q}`;
}
