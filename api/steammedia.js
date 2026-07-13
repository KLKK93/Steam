// Vercel Serverless Function - fetch Steam appdetails API (JSON, reliable).
// Tra { movies, screenshots, header_image, sysreq } - client xu ly ca media + sysreq.
// Sysreq parse tu pc_requirements.minimum (HTML) -> fields (os, cpu, ram, gpu, dx, storage, audio, note).

// Parse Steam pc_requirements HTML -> object fields. Value co the o dong tiep theo (Steam dung <br>).
const parseSysreq = (htmlStr) => {
  if (!htmlStr) return {};
  // Strip tags, unescape entities
  const text = htmlStr
    .replace(/<[^>]+>/g, '\n')
    .replace(/&/g, '&').replace(/&reg;/g, '®').replace(/&trade;/g, '™')
    .replace(/&nbsp;/g, ' ').replace(/"/g, '"').replace(/&#39;/g, "'");
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const keyMap = {
    'os': 'os', 'processor': 'cpu', 'memory': 'ram',
    'graphics': 'gpu', 'directx': 'dx', 'storage': 'storage',
    'hard drive': 'storage', 'hard disk': 'storage', 'sound': 'audio',
    'network': 'connection', 'additional': 'note',
  };
  const result = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(.*?(OS|Processor|Memory|Graphics|DirectX|Storage|Hard Drive|Hard Disk|Sound|Network|Additional)):\s*(.*)$/i);
    if (m) {
      const key = m[2].toLowerCase();
      let val = m[3].trim();
      if (!val && i + 1 < lines.length) {
        val = lines[i + 1].trim();
        i++;
      }
      const k = keyMap[key];
      if (k && !result[k] && val) result[k] = val;
    }
  }
  return result;
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const appId = (req.query.appid || '').toString().trim();
  if (!appId || !/^\d+$/.test(appId)) {
    res.status(400).json({ error: 'appid khong hop le' });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`;
    const steamRes = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);
    const json = await steamRes.json();
    const entry = json && json[appId];
    if (!entry || !entry.success || !entry.data) {
      res.status(404).json({ error: 'Steam khong co du lieu app nay' });
      return;
    }
    const data = entry.data;
    const movies = (data.movies || []).map(m => ({
      src: m.hls_h264 || m.webm || m.mp4 || '',
      thumb: m.thumbnail || '',
    })).filter(m => m.src);
    const screenshots = (data.screenshots || []).map(s => s.path_full || '').filter(Boolean);

    // Parse sysreq tu pc_requirements.minimum
    const reqs = data.pc_requirements || {};
    const minimumHtml = (reqs && typeof reqs === 'object') ? (reqs.minimum || '') : '';
    const sysreq = parseSysreq(minimumHtml);

    res.status(200).json({
      movies,
      screenshots,
      header_image: data.header_image || '',
      sysreq,
    });
  } catch (err) {
    clearTimeout(timer);
    res.status(502).json({ error: 'Steam API that bai', detail: err.message || 'timeout' });
  }
};
