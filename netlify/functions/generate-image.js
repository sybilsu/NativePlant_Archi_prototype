const MODEL   = 'gpt-image-1';
const SIZE    = '1024x1024';
const QUALITY = 'low';   // 最省費用

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

function buildEditPrompt(palette, styles, location, season) {
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

function buildGeneratePrompt(palette, styles, location, season) {
  const mood      = SEASON_MOOD[season] || SEASON_MOOD.summer;
  const styleText = styles.length ? styles.map(s => STYLE_DESC[s]||s).join('; ') : 'naturalistic Piet Oudolf planting';
  const plants    = buildPlantLines(palette, season);
  return `Photorealistic landscape garden photo. Piet Oudolf naturalistic planting.
SEASON: ${mood.en} — ${mood.light}. PALETTE: ${mood.palette}.
STYLE: ${styleText}. LOCATION: ${location}.
PLANTS:
  ${plants}
Eye-level view, natural depth, professional photography. No people. No text.`;
}

/* ── API calls using native fetch (Node 18+) ─── */
async function callGenerations(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size: SIZE,
        quality: QUALITY,
        response_format: 'b64_json'
      })
    });
    const json = await res.json();
    if (json.data && json.data[0]) {
      return { ok: true, b64: json.data[0].b64_json || null };
    }
    return { ok: false, error: json.error?.message || JSON.stringify(json) };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timeout (>55s)' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function callEdits(prompt, imageB64) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const imgBuffer = Buffer.from(imageB64, 'base64');
    const imgBlob   = new Blob([imgBuffer], { type: 'image/jpeg' });

    const form = new FormData();
    form.append('model',   MODEL);
    form.append('prompt',  prompt);
    form.append('size',    SIZE);
    form.append('quality', QUALITY);
    form.append('n',       '1');
    form.append('image',   imgBlob, 'site.jpg');  // 'image' not 'image[]'

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      // Do NOT set Content-Type — fetch sets it with boundary automatically
      body: form
    });
    const json = await res.json();
    if (json.data && json.data[0]) {
      return { ok: true, b64: json.data[0].b64_json || null };
    }
    return { ok: false, error: json.error?.message || JSON.stringify(json) };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Timeout (>55s)' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };

  let palette=[], styles=[], location='台灣', lights=[], areaKey='', season='summer', sitePhotoB64=null;
  try {
    const b    = JSON.parse(event.body || '{}');
    palette    = b.palette      || [];
    styles     = b.styles       || [];
    location   = b.location     || '台灣';
    lights     = b.lights       || [];
    areaKey    = b.areaKey      || '';
    season     = b.season       || 'summer';
    sitePhotoB64 = b.sitePhotoB64 || null;
  } catch(e) { return { statusCode:400, body: JSON.stringify({ error:'Invalid JSON' }) }; }

  const CORS = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' };

  let result;
  if (sitePhotoB64) {
    const prompt = buildEditPrompt(palette, styles, location, season);
    result = await callEdits(prompt, sitePhotoB64);
  } else {
    const prompt = buildGeneratePrompt(palette, styles, location, season);
    result = await callGenerations(prompt);
  }

  if (result.ok) {
    return { statusCode:200, headers:CORS, body: JSON.stringify({ b64: result.b64 }) };
  } else {
    return { statusCode:500, headers:CORS, body: JSON.stringify({ error: result.error }) };
  }
};
