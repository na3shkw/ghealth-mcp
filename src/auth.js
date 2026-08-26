import http from 'node:http';
import fs from 'node:fs';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
];

const { installed } = JSON.parse(fs.readFileSync('./client_secret.json'));

const server = http.createServer();
server.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

const client = new OAuth2Client({
  clientId: installed.client_id,
  clientSecret: installed.client_secret,
  redirectUri: `http://127.0.0.1:${port}`,
});

const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();

console.log(
  client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  }),
);

const code = await new Promise((resolve, reject) => {
  server.on('request', (req, res) => {
    const params = new URL(req.url, `http://127.0.0.1:${port}`).searchParams;
    if (!params.has('code') && !params.has('error')) return res.end();
    res.end('done');
    params.has('code') ? resolve(params.get('code')) : reject(new Error(params.get('error')));
  });
});
server.close();

const { tokens } = await client.getToken({ code, codeVerifier });
fs.writeFileSync('./token.json', JSON.stringify(tokens, null, 2));
console.log('refresh_token:', tokens.refresh_token ? 'あり' : 'なし');
