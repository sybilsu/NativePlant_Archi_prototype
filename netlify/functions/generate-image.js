const https = require('https');

/* 成本控制：每次呼叫用 1024x1024 medium，約 $0.04/張 */
const MODEL  = 'gpt-image-1';
const SIZE   = '1024x1024';
const QUALITY = 'medium';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let palette = [], styles = [], location = '台灣';
  try {
    const body = JSON.parse(event.body || '{}');
    palette  = body.palette  || [];
    styles   = body.styles   || [];
    location = body.location || '台灣';
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const plantNames = palette.map(p => p.name_zh).join(', ');
  const styleMap   = { airy:'light airy grasses', floral:'abundant colorful blooms', zen:'calm foliage mounds', wild:'wild naturalistic meadow' };
  const styleText  = styles.map(s => styleMap[s] || s).join(', ') || 'naturalistic planting';

  const prompt = `Professional landscape garden photo. Taiwan native plants in Piet Oudolf naturalistic planting style. ${styleText} composition. Plants: ${plantNames}. Layered perennial meadow, soft diffused daylight, ${location}. Photorealistic, high quality.`;

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
