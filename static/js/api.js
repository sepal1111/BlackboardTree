// 與伺服器溝通的薄包裝
export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function req(method, url, body, { quiet401 = false } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof Blob) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new ApiError('無法連線到伺服器', 0);
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !quiet401) window.dispatchEvent(new Event('ms:unauthorized'));
    const d = data?.detail;
    const msg = typeof d === 'string' ? d : d?.message || res.statusText;
    throw new ApiError(msg, res.status, d);
  }
  return data;
}

export const api = {
  get: (u, o) => req('GET', u, undefined, o),
  post: (u, b, o) => req('POST', u, b, o),
  put: (u, b, o) => req('PUT', u, b, o),
  del: (u, o) => req('DELETE', u, undefined, o),
};

export const fileUrl = (path) => '/api/file?path=' + encodeURIComponent(path);
