const https = require('https');

const MODEL   = 'gpt-image-1';
const SIZE    = '1024x1024';
const QUALITY = 'medium';

const ARCH_DESC = {
  transparent: 'airy transparent grass swaying gently',
  upright:     'strong upright vertical accent',
  leafy_mound: 'rounded dense leafy mound',
  emergent:    'tall emergent spike rising above surroundings'
};
const ROLE_DESC = {
  matrix:  'ground-covering matrix base (≥50% coverage)',
  primary: 'primary focal thriller plant (~30%)',
  scatter: 'scattered accent spiller (~10%)',
  filler:  'low filler ground layer'
};
const STYLE_DESC = {
  airy:   'light airy transparent grasses moving in breeze, open and spacious',
  floral: 'abundant colorful blooms in waves, lush and vibrant',
  zen:    'calm serene foliage, minimal color, structural and meditative',
  wild:   'wild naturalistic meadow, ecological richness, self-seeding character'
};
const SEASON_MOOD = {
  spring: { en:'Spring', light:'soft morning light, misty gentle atmosphere, pale sky', palette:'fresh tender greens, pale pinks and whites, delicate pastel tones' },
  summer: { en:'Summer', light:'warm golden afternoon sunlight, strong shadows, deep blue sky', palette:'deep lush greens, vibrant bloom colors, full saturation' },
  autumn: { en:'Autumn', light:'low warm amber light, long shadows, hazy atmosphere', palette:'golden seed heads, russet amber copper tones, dried grasses' },
  winter: { en:'Winter', light:'grey diffuse overcast light, frost on stems, quiet stillness', palette:'pale beige and grey, dark structural stems, minimal color' }
};

// bloom months → season
function bloomsInSeason(p, season) {
  if (!p.bloom_months || !p.bloom_months.length) return false;
  const map = { spring:[3,4,5], summer:[6,7,8], autumn:[9,10,11], winter:[12,1,2] };
  return p.bloom_months.some(m => (map[season]||[]).includes(m));
}

function buildPrompt(palette, styles, location, lights, areaKey, season) {
  const mood = SEASON_MOOD[season] || SEASON_MOOD.summer;

  // Describe each plant's seasonal state
  const plantDescs = palette.map(p => {
    const h     = p.height_cm ? `${p.height_cm[0]}–${p.height_cm[1]}cm` : '';
    const arch  = ARCH_DESC[p.architecture] || '';
    const role  = ROLE_DESC[p.role] || p.role || '';
    const sDesc = p.seasons && p.seasons[season] ? p.seasons[season] : '';
    const blooming = bloomsInSeason(p, season);
    const col   = blooming && p.flower_color ? `, ${p.flower_color} flowers in bloom` : '';
    return `${p.name_zh} (${h}, ${arch}, ${role}${col}${sDesc ? ' — ' + sDesc : ''})`;
  }).join('\n  ');

  const styleText = styles.length
    ? styles.map(s => STYLE_DESC[s] || s).join('; ')
    : 'naturalistic Piet Oudolf prairie planting';

  const lightKey = lights && lights[0] ? lights[0] : 'full';

  return `Photorealistic professional landscape garden photograph.

SEASON: ${mood.en} — ${mood.light}
COLOR PALETTE: ${mood.palette}

DESIGN: Piet Oudolf naturalistic matrix planting. ${styleText}.
LOCATION: ${location}, Taiwan. ${areaKey} garden.

PLANTS (Oudolf layered composition):
  ${plantDescs}

COMPOSITION: Eye-level perspective, natural depth, layered foreground-middle-background. No people. Garden only. No text.`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let palette=[], styles=[], location='台灣', lights=[], areaKey='', season='summer';
  try {
    const b = JSON.parse(event.body || '{}');
    palette  = b.palette  || [];
    styles   = b.styles   || [];
    location = b.location || '台灣';
    lights   = b.lights   || [];
    areaKey  = b.areaKey  || '';
    season   = b.season   || 'summer';
  } catch(e) {
    return { statusCode:400, body: JSON.stringify({ error:'Invalid JSON' }) };
  }

  const prompt   = buildPrompt(palette, styles, location, lights, areaKey, season);
  const reqBody  = JSON.stringify({ model:MODEL, prompt, n:1, size:SIZE, quality:QUALITY });

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
              headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' },
              body: JSON.stringify({ url: img.url||null, b64: img.b64_json||null })
            });
          } else {
            resolve({ statusCode:500, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({ error: json.error?.message||'No image' }) });
          }
        } catch(e) {
          resolve({ statusCode:500, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({ error:e.message }) });
        }
      });
    });
    req.on('error', e => resolve({ statusCode:500, headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify({ error:e.message }) }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode:504, headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify({ error:'Timeout' }) }); });
    req.write(reqBody);
    req.end();
  });
};
