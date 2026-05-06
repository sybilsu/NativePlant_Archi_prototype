const https = require('https');

/* 成本控制：1024x1024 medium，約 $0.04/張 */
const MODEL   = 'gpt-image-1';
const SIZE    = '1024x1024';
const QUALITY = 'medium';

const ARCH_DESC = {
  transparent:  'airy transparent grass form swaying gently',
  upright:      'strong upright vertical accent',
  leafy_mound:  'rounded dense leafy mound',
  emergent:     'tall emergent spike rising above surroundings'
};
const ROLE_DESC = {
  matrix:  'ground-covering matrix base (≥50% coverage, dense carpet)',
  primary: 'primary focal thriller plant (~30%, eye-catching)',
  scatter: 'scattered accent spiller (~10%, surprise element)',
  filler:  'low filler ground layer (gap-filling mound)'
};
const STYLE_DESC = {
  airy:   'light airy transparent grasses moving in breeze, open and spacious feel',
  floral: 'abundant colorful blooms layered in waves, lush and vibrant',
  zen:    'calm serene foliage mounds, minimal color, structural and meditative',
  wild:   'wild naturalistic meadow, ecological richness, self-seeding character'
};
const LIGHT_DESC = {
  full:    'bright full sun, strong shadows, golden hour warmth',
  partial: 'dappled partial shade, soft diffused light',
  shade:   'cool dappled shade under canopy, soft even light'
};

function buildPrompt(palette, styles, location, lights, areaKey) {
  const matrix   = palette.find(p => p.role === 'matrix');
  const primaries = palette.filter(p => p.role === 'primary');
  const scatter  = palette.find(p => p.role === 'scatter');
  const filler   = palette.find(p => p.role === 'filler');

  function plantLine(p) {
    if (!p) return null;
    const h    = p.height_cm ? `${p.height_cm[0]}–${p.height_cm[1]} cm` : '';
    const arch = ARCH_DESC[p.architecture] || p.architecture || '';
    const col  = p.flower_color ? `, ${p.flower_color} flowers` : '';
    const tags = (p.match_tags || []).slice(0, 2).join(', ');
    return `${p.name_zh} (${p.name_latin || ''}, ${h}, ${arch}${col}${tags ? ', ' + tags : ''})`;
  }

  const layerLines = [
    matrix   ? `MATRIX BASE: ${plantLine(matrix)} — ${ROLE_DESC.matrix}` : null,
    primaries.length ? `PRIMARY FOCAL: ${primaries.map(plantLine).join(' + ')} — ${ROLE_DESC.primary}` : null,
    scatter  ? `SCATTER ACCENT: ${plantLine(scatter)} — ${ROLE_DESC.scatter}` : null,
    filler   ? `FILLER LAYER: ${plantLine(filler)} — ${ROLE_DESC.filler}` : null
  ].filter(Boolean).join('\n');

  const styleText = styles.length
    ? styles.map(s => STYLE_DESC[s] || s).join('; ')
    : 'naturalistic prairie planting';

  const lightKey = lights && lights[0] ? lights[0] : 'full';
  const lightText = LIGHT_DESC[lightKey] || LIGHT_DESC.full;

  const seasonDesc = 'Summer: full lush growth, grasses in prime form, perennials at peak';

  return `Professional photorealistic landscape garden photograph.

DESIGN CONCEPT: Piet Oudolf naturalistic matrix planting style. ${styleText}.

PLANTING LAYERS (Oudolf method — matrix / primary / scatter / filler):
${layerLines}

SCENE: ${location}, Taiwan. ${areaKey || 'medium'} area garden. ${seasonDesc}. ${lightText}.

VISUAL QUALITY: Eye-level perspective, natural depth of field, high-resolution landscape photography. No people. Garden only. No text or labels.`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let palette = [], styles = [], location = '台灣', lights = [], areaKey = '';
  try {
    const body = JSON.parse(event.body || '{}');
    palette  = body.palette  || [];
    styles   = body.styles   || [];
    location = body.location || '台灣';
    lights   = body.lights   || [];
    areaKey  = body.areaKey  || '';
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const prompt = buildPrompt(palette, styles, location, lights, areaKey);
  const reqBody = JSON.stringify({ model: MODEL, prompt, n: 1, size: SIZE, quality: QUALITY });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(reqBody)
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && json.data[0]) {
            const img = json.data[0];
            resolve({
              statusCode: 200,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              body: JSON.stringify({ url: img.url || null, b64: img.b64_json || null })
            });
          } else {
            resolve({ statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: json.error?.message || 'No image returned' }) });
          }
        } catch (e) {
          resolve({ statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: e.message }) });
        }
      });
    });

    req.on('error', e => resolve({ statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: e.message }) }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 504, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Timeout' }) }); });
    req.write(reqBody);
    req.end();
  });
};
