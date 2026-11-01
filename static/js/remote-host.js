// 教室電腦端的遙控連線：向轉送伺服器取得代碼、推送白板狀態、接收手機的指令
import { LS } from './store.js';

export class RemoteHost extends EventTarget {
  // base：轉送伺服器網址，例如 http://192.168.1.5:8080
  constructor(base, { getState, onCmd }) {
    super();
    this.base = base.replace(/\/+$/, '');
    this.getState = getState;
    this.onCmd = onCmd;
    this.ws = null;
    this.code = '';
    this.remotes = 0;
    this.status = 'off'; // off | connecting | online | error
    this.started = false;
    this.pushTimer = null;
    this.retry = 0;
  }

  get url() { return `${this.base}/remote.html#${this.code}`; }

  setStatus(s) { this.status = s; this.dispatchEvent(new Event('change')); }

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  connect() {
    if (!this.started) return;
    this.setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(this.base.replace(/^http/, 'ws') + '/ws/screen');
    } catch {
      this.setStatus('error');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      const saved = LS.get('ms:remote', {});
      ws.send(JSON.stringify({ type: 'hello', code: saved.code, secret: saved.secret }));
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'room') {
        this.code = m.code;
        this.remotes = m.remotes || 0;
        this.retry = 0;
        LS.set('ms:remote', { code: m.code, secret: m.secret });
        this.setStatus('online');
        this.push(true);
      } else if (m.type === 'remotes') {
        this.remotes = m.count;
        if (m.joined) this.dispatchEvent(new Event('joined'));
        this.dispatchEvent(new Event('change'));
        this.push(true);
      } else if (m.type === 'cmd') {
        Promise.resolve(this.onCmd(m)).catch((err) => this.notice('執行失敗：' + err.message)).finally(() => this.push());
      } else if (m.type === 'replaced') {
        this.started = false; // 同一組代碼在別的視窗開啟了
        this.setStatus('off');
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.started) return;
      this.setStatus('error');
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.connect(), 1000 * this.retry);
    };
  }

  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  // 白板有變化時呼叫；短時間內多次變化只送一次
  push(now = false) {
    if (this.status !== 'online') return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.send({ type: 'state', state: this.getState() }), now ? 0 : 120);
  }

  notice(text) { this.send({ type: 'notice', text }); }

  // 中斷所有遙控裝置並更換代碼
  kick() { this.send({ type: 'kick' }); }

  stop() {
    this.started = false;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.remotes = 0;
    this.setStatus('off');
  }
}
