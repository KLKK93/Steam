// Vercel Serverless Function - fetch Steam appdetails API (JSON, reliable).
// KHONG parse HTML (age gate/cheerio issue) -> dung appdetails API truc tie.
// Tra { movies, screenshots, header_image } - client buildGameMedia xu ly.

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
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=vietnamese`;
    const steamRes = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
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
    res.status(200).json({
      movies,
      screenshots,
      header_image: data.header_image || '',
    });
  } catch (err) {
    clearTimeout(timer);
    res.status(502).json({ error: 'Steam API that bai', detail: err.message || 'timeout' });
  }
};
