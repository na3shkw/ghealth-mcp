import { OAuth2Client } from 'google-auth-library';
import fs from 'node:fs';

process.on('unhandledRejection', (e) => {
  console.error(e.status, e.message);
  process.exit(1);
});

const { installed } = JSON.parse(fs.readFileSync('./client_secret.json'));
const auth = new OAuth2Client(installed.client_id, installed.client_secret);
auth.setCredentials(JSON.parse(fs.readFileSync('./token.json')));

const path = process.argv[2] ?? 'profile';
const res = await auth.request({ url: `https://health.googleapis.com/v4/users/me/${path}` });
console.log(JSON.stringify(res.data, null, 2));
