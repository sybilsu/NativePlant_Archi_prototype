const https = require('https');

const MODEL   = 'gpt-image-1';
const SIZE    = '1024x1024';
const QUALITY = 'low';   // 最省費用：每張約 $0.01–0.02 (edit) / $0.02 (generate)

const ARCH_DESC = {
  transparent: 'airy transparent grass swaying gently',
  upright:     'strong upright vertical accent',
  leafy_mound: 'rounded dense leafy mound',
  emergent:    'tall emergent spike rising above'
};
const ROLE_DESC = {
  matrix:  'ground-covering matrix base (≥50% coverage)',
  primary: 'primary focal thriller plant (~30%)',
  scatter: 'scattered accent spiller (~10%)',
  filler:  'low filler ground layer'
};
const STYLE_DESC = {
  airy:   'light airy transparent grasses moving in breeze',
  floral: 'abundant colorful blooms in waves',
  zen:    'calm serene foliage, minimal color, structural',
  wild:   'wild naturalistic meadow, ecological richness'
};
const SEASON_MOOD = {
  spring: { en:'Spring', light:'soft morning light, pale sky', palette:'fresh tender greens, pale pinks and whites' },
  summer: { en:'Summer', light:'warm golden afternoon sun, deep blue sky', palette:'deep lush greens, vibrant bloom colors' },
  autumn: { en:'Autumn', light:'low amber light, long shadows', palette:'golden seed heads, russet amber copper tones' },
  winter: { en:'Winter', light:'grey diffuse overcast, frost on stems', palette:'pale beige and grey, dark structural stems' }
};

function bloomsInSeason(p, season) {
  if (!p.bloom_months || !p.bloom_months.length) return false;
  const map = { spring:[3,4,5], summer:[6,7,8], autumn:[9,10,11], winter:[12,1,2] };
  return p.bloom_months.some(m => (map[season]||[]).includes(m));
}

function buildPlantLines(palette, season) {
  return palette.map(p => {
    const h    = p.height_cm ? `${p.height_cm[0]}–${p.height_cm[1]}cm` : '';
    const arch = ARCH_DESC[p.architecture] || '';
    const role = ROLE_DESC[p.role] || p.role || '';
    const sDesc = p.seasons && p.seasons[season] ? p.seasons[season] : '';
    const col  = bloomsInSeason(p, season) && p.flower_color ? `, ${p.flower_color} flowers in bloom` : '';
    return `${p.name_zh} (${h}, ${arch}, ${role}${col}${sDesc ? ' — ' + sDesc : ''})`;
  }).join('\n  ');
}

function buildEditPrompt(palette, styles, location, lights, areaKey, season) {
  const mood      = SEASON_MOOD[season] || SEASON_MOOD.summer;
  const styleText = styles.length ? styles.map(s => STYLE_DESC[s]||s).join('; ') : 'naturalistic Piet Oudolf planting';
  const plants    = buildPlantLines(palette, season);

  return `Add Taiwan native plants to this balcony/garden space in Piet Oudolf naturalistic matrix planting style.

SEASON: ${mood.en} — ${mood.light}. COLOR PALETTE: ${mood.palette}.
STYLE: ${styleText}.
LOCATION: ${location}, Taiwan.

PLANTS to add (keep original space structure, walls, floor — only add plants):
  ${plants}

Blend naturally into the existing space. Photorealistic. No text or labels.`;
}

function buildGeneratePrompt(palette, styles, location, lights, areaKey, season) {
  const mood      = SEASON_MOOD[season] || SEASON_MOOD.summer;
  const styleText = styles.length ? styles.map(s => STYLE_DESC[s]||s).join('; ') : 'naturalistic Piet Oudolf planting';
  const plants    = buildPlantLines(palette, season);

  return `Photorealistic landscape garden photo. Piet Oudolf naturalistic planting.
SEASON: ${mood.en} — ${mood.light}. PALETTE: ${mood.palette}.
STYLE: ${styleText}. LOCATION: ${location}.
PLANTS:\n  ${plants}
Eye-level view, natural depth, professional photography. No people. No text.`;
}

/* ── Multipart form builder ─────────────────────────── */
function buildMultipart(boundary, fields, imageB64) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}`
    );
  }
  // image field
  const imgBuf = Buffer.from(imageB64, 'base64');
  const imgHeader = `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="site.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
  const footer = `\r\n--${boundary}--`;
  return Buffer.concat([
    Buffer.from(parts.join('\r\n') + '\r\n', 'utf8'),
    Buffer.from(imgHeader, 'utf8'),
    imgBuf,
    Buffer.from(footer, 'utf8')
  ]);
}

function callOpenAI(path, body, contentType) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.openai.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': body.length
      },
      timeout: 90000
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.data && json.data[0]) {
            const img = json.data[0];
            resolve({ ok:true, url: img.url||null, b64: img.b64_json||null });
          } else {
            resolve({ ok:false, error: json.error?.message || JSON.stringify(json) });
          }
        } catch(e) { resolve({ ok:false, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ ok:false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok:false, error:'Timeout' }); });
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };

  let palette=[], styles=[], location='台灣', lights=[], areaKey='', season='summer', sitePhotoB64=null;
  try {
    const b = JSON.parse(event.body || '{}');
    palette      = b.palette      || [];
    styles       = b.styles       || [];
    location     = b.location     || '台灣';
    lights       = b.lights       || [];
    areaKey      = b.areaKey      || '';
    season       = b.season       || 'summer';
    sitePhotoB64 = b.sitePhotoB64 || null;
  } catch(e) { return { statusCode:400, body: JSON.stringify({ error:'Invalid JSON' }) }; }

  const CORS = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' };
  let result;

  if (sitePhotoB64) {
    // Edit mode: overlay plants on uploaded site photo
    const prompt   = buildEditPrompt(palette, styles, location, lights, areaKey, season);
    const boundary = 'boundary' + Date.now();
    const body     = buildMultipart(boundary, { model:MODEL, prompt, size:SIZE, quality:QUALITY, n:'1' }, sitePhotoB64);
    result = await callOpenAI('/v1/images/edits', body, `multipart/form-data; boundary=${boundary}`);
  } else {
    // Generate mode: no site photo
    const prompt  = buildGeneratePrompt(palette, styles, location, lights, areaKey, season);
    const reqBody = Buffer.from(JSON.stringify({ model:MODEL, prompt, n:1, size:SIZE, quality:QUALITY }));
    result = await callOpenAI('/v1/images/generations', reqBody, 'application/json');
  }

  if (result.ok) {
    return { statusCode:200, headers:CORS, body: JSON.stringify({ url:result.url, b64:result.b64 }) };
  } else {
    return { statusCode:500, headers:CORS, body: JSON.stringify({ error: result.error }) };
  }
};
