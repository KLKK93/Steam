// Vercel Serverless Function - fetch Steam store page HTML + parse highlight strip.
// Lay thu tu media Y CHANG Steam 1:1 (video/anh lan nhau theo admin set).
// API appdetails chi tra 2 mang movies/screenshots tach roi (khong giu thu tu tron),
// nen phai parse HTML store page that de lay dung thu tu highlight strip.

const cheerio = require('cheerio');

const fetchWithTimeout = async (url, ms) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        // Bypass age gate: Steam doc age check khi co cookie nay
        'Cookie': 'birthtime=315532800; mature_content=1',
      },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

// Parse highlight strip tu HTML store page - giu dung thu tu Steam.
// Steam render highlight strip nhu danh sach <div class="highlight_strip_item">,
// moi item co data-type (screenshot/movie) hoac nhan biet qua data-* attr.
const parseHighlightOrder = (html) => {
  const $ = cheerio.load(html);
  const items = [];

  // Cach 1: highlight_strip_item (store page cu - pho bien)
  $('.highlight_strip_item, .highlight_player_item').each((_, el) => {
    const $el = $(el);
    // Movie: co data-movie-id hoac data-webm-source/data-mp4-source
    const movieId = $el.attr('data-movie-id') || $el.attr('data-movie-id');
    const webm = $el.attr('data-webm-source') || $el.attr('data-mp4-source') || $el.attr('data-hls-source');
    if (movieId || webm) {
      const thumb = $el.find('img').attr('src') || $el.attr('data-thumb') || '';
      items.push({ type: 'movie', src: webm || '', thumb });
      return;
    }
    // Screenshot: data-screenshotid hoac .highlight_screenshot
    const ssId = $el.attr('data-screenshotid') || $el.attr('data-screenshot-id');
    const ssUrl = $el.attr('data-screenshot-url') || $el.find('img').attr('src') || '';
    if (ssId !== undefined || ssUrl) {
      // thumb co the la 600x338, chuyen sang 1920x1080
      const full = ssUrl.replace('.600x338.', '.1920x1080.');
      items.push({ type: 'screenshot', src: full });
    }
  });

  return items;
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

  try {
    const html = await fetchWithTimeout(`https://store.steampowered.com/app/${appId}/?l=vietnamese`, 8000);
    let items = parseHighlightOrder(html);

    // Fallback: neu parse HTML khong duoc (Steam doi UI / age gate chan),
    // dung appdetails API + logic Steam mac dinh (movies highlight truoc, roi screenshots).
    if (items.length === 0) {
      const json = await fetchWithTimeout(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=vietnamese`, 8000).then(r => JSON.parse(r));
      const entry = json && json[appId];
      if (entry && entry.success && entry.data) {
        const d = entry.data;
        (d.movies || []).forEach(m => items.push({ type: 'movie', src: m.hls_h264 || m.webm || m.mp4 || '', thumb: m.thumbnail || '' }));
        (d.screenshots || []).forEach(s => items.push({ type: 'screenshot', src: s.path_full || '' }));
      }
    }

    if (items.length === 0) {
      res.status(404).json({ error: 'Steam khong co media' });
      return;
    }
    res.status(200).json({ items });
  } catch (err) {
    res.status(502).json({ error: 'Steam API that bai', detail: err.message || 'timeout' });
  }
};
