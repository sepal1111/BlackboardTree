// 教室電腦端的遙控連線：向轉送伺服器取得代碼、推送白板狀態、接收手機的指令
// 也負責學生投票：開放投票時另外取得一組投票代碼，學生只能送出投票
import { LS } from './store.js';

export class RemoteHost extends EventTarget {
  // base：轉送伺服器網址，例如 http://192.168.1.5:8080
  // publicBase：給手機的網址（內建伺服器時，電腦自己連 127.0.0.1，手機要用校內 IP）
  constructor(base, { getState, onCmd, onVote, publicBase }) {
    super();
    this.base = base.replace(/\/+$/, '');
    this.publicBase = (publicBase || base).replace(/\/+$/, '');
    this.getState = getState;
    this.onCmd = onCmd;
    this.onVote = onVote;
    this.poll = null;      // 開放學生投票中的題目 { id, question, options }；null 代表沒有開放
    this.voteCode = '';
    this.voters = 0;       // 連線中的學生數
    this.ws = null;
    this.code = '';
    this.remotes = 0;
    this.status = 'off'; // off | connecting | online | error
    this.started = false;
    this.pushTimer = null;
    this.retry = 0;
  }

  get url() { return `${this.publicBase}/remote.html#${this.code}`; }
  get voteUrl() { return `${this.publicBase}/vote.html#${this.voteCode}`; }

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
        if (this.poll) this.sendPoll(); // 重新連線後恢復投票，沿用原本的投票代碼
      } else if (m.type === 'remotes') {
        this.remotes = m.count;
        if (m.joined) this.dispatchEvent(new Event('joined'));
        this.dispatchEvent(new Event('change'));
        this.push(true);
      } else if (m.type === 'cmd') {
        Promise.resolve(this.onCmd(m)).catch((err) => this.notice('執行失敗：' + err.message)).finally(() => this.push());
      } else if (m.type === 'vote-room') {
        if (!this.poll && m.code) { this.send({ type: 'vote-close' }); return; } // 已經關閉了
        this.voteCode = m.code || '';
        this.voters = m.voters || 0;
        if (this.voteCode) LS.set('ms:voteCode', this.voteCode);
        this.dispatchEvent(new Event('vote'));
      } else if (m.type === 'voters') {
        this.voters = m.count || 0;
        this.dispatchEvent(new Event('vote'));
      } else if (m.type === 'vote') {
        let res;
        try { res = this.onVote?.(m) || { ok: false, text: '目前沒有開放投票' }; } catch (err) { res = { ok: false, text: '投票失敗：' + err.message }; }
        this.send({ type: 'vote-ack', to: m.from, ...res });
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

  // 開放學生投票，或更新題目（poll：{ id, question, options: [文字] }）
  openPoll(poll) {
    this.poll = poll;
    this.sendPoll();
    this.dispatchEvent(new Event('vote'));
  }

  sendPoll() {
    // 沿用上次的投票代碼，學生的頁面斷線後可以自動連回
    this.send({ type: 'vote-open', code: this.voteCode || LS.get('ms:voteCode', ''), poll: this.poll });
  }

  closePoll() {
    if (!this.poll) return;
    this.poll = null;
    this.voteCode = '';
    this.voters = 0;
    this.send({ type: 'vote-close' });
    this.dispatchEvent(new Event('vote'));
  }

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
