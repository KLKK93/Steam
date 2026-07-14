// Vercel Serverless Function — proxy Steam API cho trang Third-Party.
// 3 mode:
//   ?catalogue=true → fetch all 28 Hydra source JSONs parallel server-side → group by normalized title → return aggregated game list (FAST, ~2-3s)
//   ?title=TITLE    → Steam storesearch → first match → {appId, name, thumbnail, metascore} (for lazy thumbnail)
//   ?appId=APPID    → Steam appdetails → full game info (for detail page: header_image, screenshots, movies, about_the_game, achievements, pc_requirements, developers, publishers, genres)
// Tranh CORS: browser khong goi Steam API truc tiep duoc.

// 28 Hydra download source URLs (co dinh, khong cho sua).
const SOURCE_URLS = [
  'https://hydralinks.cloud/sources/fitgirl.json',
  'https://hydralinks.cloud/sources/steamrip.json',
  'https://hydralinks.cloud/sources/onlinefix.json',
  'https://hydralinks.cloud/sources/dodi.json',
  'https://hydralinks.cloud/sources/xatab.json',
  'https://hydralinks.cloud/sources/gog.json',
  'https://hydralinks.cloud/sources/atop-games.json',
  'https://wkeynhk.online/steamgg.json',
  'https://davidkazumisource.com/fontekazumi.json',
  'https://hydralinks.cloud/sources/empress.json',
  'https://hydralinks.cloud/sources/rexagames.json',
  'https://hydralinks.cloud/sources/psx-roms.json',
  'https://hydralinks.cloud/sources/kaoskrew.json',
  'https://hydralinks.cloud/sources/tinyrepacks.json',
  'https://raw.githubusercontent.com/KekitU/rutracker-hydra-links/main/all_categories.json',
  'https://wkeynhk.online/rt_ps.json',
  'https://wkeynhk.online/rutor.json',
  'https://raw.githubusercontent.com/s0d4lite52spb/sodalite-hydralinks/refs/heads/main/erotorrent.ru_list.json',
  'https://raw.githubusercontent.com/Shisuiicaro/source/refs/heads/main/shisuyssource.json',
  'https://wkeynhk.online/ankergames.json',
  'https://hydrasources.su/freetp_games.json',
  'https://trash-xrl.github.io/Fonte%20teste.json',
  'https://bumyy32.github.io/bumyysoftware.json',
  'https://konthe1.github.io/DenuvoPubSource.json',
  'https://hydrasources.su/nnmclub.json',
  'https://hydrasources.su/hydra.json',
  'https://git.denuvosanctuary.com/denuvosanctuary/hydra/raw/branch/main/source.json',
  'https://wkeynhk.online/rutrackerlinux.json',
];

// Normalize title repack cho Steam search: strip junk → clean title.
const normalizeTitle = (raw) => {
  if (!raw) return '';
  let t = raw;
  t = t.replace(/\bFree Download\b/gi, '').replace(/\bDownload\b/gi, '');
  t = t.replace(/\bv[\d][\w.]*/gi, '').replace(/\bBuild[- ]?[\w]+/gi, '').replace(/\bUpdate\s*\d+/gi, '');
  t = t.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
  t = t.replace(/\b(GOTY|Deluxe|Premium|Edition|Repack|Multilanguage|Multi\d+|Empress|DODI|FitGirl|SteamRip|Online-Fix|KaosKrew|TinyRepacks|Rexa|GOG|Steam|PSX|ROM)\b/gi, '');
  t = t.replace(/[#+]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t || raw.trim();
};

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
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

  // Mode 0: ?catalogue=true → fetch all 28 sources parallel, group, return aggregated list.
  if (req.query.catalogue === 'true' || req.query.catalogue === '1') {
    // Cache edge 5 phut — sau first load, subsequent loads = instant (cached).
    res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=300');

    const fetchOneSource = async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        });
        clearTimeout(timer);
        const data = await r.json();
        return data;
      } catch (e) {
        clearTimeout(timer);
        return null;
      }
    };

    // Fetch all 28 sources song song (Promise.allSettled → source fail khong break).
    const results = await Promise.allSettled(SOURCE_URLS.map(fetchOneSource));

    // Aggregate + group by normalized title.
    const groups = {};
    let sourceOk = 0;
    results.forEach((result, i) => {
      if (result.status !== 'fulfilled' || !result.value) return;
      const data = result.value;
      sourceOk++;
      const sourceName = data.name || (() => {
        try { return new URL(SOURCE_URLS[i]).hostname.replace(/^www\./, ''); } catch { return 'N/A'; }
      })();
      (data.downloads || []).forEach((d) => {
        const nt = normalizeTitle(d.title);
        if (!nt) return;
        if (!groups[nt]) {
          groups[nt] = { title: nt, normalizedTitle: nt, sources: [], latestDate: '' };
        }
        groups[nt].sources.push({
          name: sourceName,
          title: d.title || '',
          uris: d.uris || [],
          fileSize: d.fileSize || '',
          uploadDate: d.uploadDate || '',
          descriptionHtml: d.descriptionHtml || '',
        });
        if (d.uploadDate) {
          const t = new Date(d.uploadDate).getTime();
          if (!groups[nt].latestDate || t > new Date(groups[nt].latestDate).getTime()) {
            groups[nt].latestDate = d.uploadDate;
          }
        }
      });
    });

    const arr = Object.values(groups).sort((a, b) => {
      const da = a.latestDate ? new Date(a.latestDate).getTime() : 0;
      const db = b.latestDate ? new Date(b.latestDate).getTime() : 0;
      return db - da;
    });

    res.status(200).json({ games: arr, sourceOk, sourceTotal: SOURCE_URLS.length });
    return;
  }

  // Cache 1h cho title/appId lookups.
  res.setHeader('Cache-Control', 'public, max-age=3600');

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
    res.status(400).json({ error: 'Can catalogue, title hoac appId hop le' });
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
