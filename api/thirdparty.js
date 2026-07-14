// Vercel Serverless Function — proxy Steam API cho trang Third-Party.
// 2 mode:
//   ?title=TITLE  → Steam storesearch → first match → {appId, name, thumbnail, metascore}
//   ?appId=APPID  → Steam appdetails → full game info (header_image, screenshots, movies, about_the_game, achievements, pc_requirements, developers, publishers, genres)
// Tranh CORS: browser khong goi Steam API truc tiep duoc.

const parseSysreq = (htmlStr) => {
  if (!htmlStr) return {};
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
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

  // Mode 1: ?title=TITLE → storesearch → first match
  const title = (req.query.title || '').toString().trim();
  if (title) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`;
      const steamRes = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
      });
      clearTimeout(timer);
      const json = await steamRes.json();
      const items = (json && json.items) || [];
      if (items.length === 0) {
        res.status(404).json({ error: 'Khong tim thay game' });
        return;
      }
      // First match = best match (Steam sap xep theo relevance).
      const item = items[0];
      res.status(200).json({
        appId: String(item.id),
        name: item.name || '',
        thumbnail: item.tiny_image || '',
        metascore: item.metascore || '',
      });
    } catch (err) {
      clearTimeout(timer);
      res.status(502).json({ error: 'Steam storesearch that bai', detail: err.message || 'timeout' });
    }
    return;
  }

  // Mode 2: ?appId=APPID → appdetails → full info
  const appId = (req.query.appid || '').toString().trim();
  if (!appId || !/^\d+$/.test(appId)) {
    res.status(400).json({ error: 'Can title hoac appId hop le' });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`;
    const steamRes = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
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

    const reqs = data.pc_requirements || {};
    const minimumHtml = (reqs && typeof reqs === 'object') ? (reqs.minimum || '') : '';
    const sysreq = parseSysreq(minimumHtml);

    // Achievements: appdetails co the co achievements.total + achievements.highlighted[].
    const ach = data.achievements || null;
    const achievements = ach ? {
      total: ach.total || 0,
      highlighted: (ach.highlighted || []).map(a => ({ name: a.name || '', path: a.path || '' })),
    } : null;

    res.status(200).json({
      name: data.name || '',
      header_image: data.header_image || '',
      screenshots,
      movies,
      about_the_game: data.about_the_game || '',
      short_description: data.short_description || '',
      developers: data.developers || [],
      publishers: data.publishers || [],
      genres: (data.genres || []).map(g => g.description || '').filter(Boolean),
      sysreq,
      achievements,
    });
  } catch (err) {
    clearTimeout(timer);
    res.status(502).json({ error: 'Steam appdetails that bai', detail: err.message || 'timeout' });
  }
};
