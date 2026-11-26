// Puts a rendered Short on a public HTTPS address, because Buffer fetches videos by URL at publish time.
// Two hosts, as Buffer's docs suggest: Cloudinary (signed upload) or Cloudflare R2 (S3 API + public bucket URL).
import { createHash, createHmac } from 'node:crypto';
import { openAsBlob, readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface HostSettings {
  mediaHost: 'cloudinary' | 'r2';
  cloudinaryCloud: string;
  cloudinaryKey: string;
  r2Account: string;
  r2Bucket: string;
  r2KeyId: string;
  /** public base URL of the bucket, e.g. https://pub-xxxx.r2.dev or https://media.example.com */
  r2PublicBase: string;
}

/** Upload and return the public URL. `key` is a stable name like oopsmith/RS-0003_v2.mp4 */
export async function hostVideo(h: HostSettings, secret: string, file: string, key: string): Promise<string> {
  return h.mediaHost === 'r2' ? r2Put(h, secret, file, key) : cloudinaryUpload(h, secret, file, key);
}

async function cloudinaryUpload(h: HostSettings, apiSecret: string, file: string, key: string): Promise<string> {
  if (!h.cloudinaryCloud || !h.cloudinaryKey || !apiSecret) throw new Error('Cloudinary is not fully set up (cloud name, API key, API secret).');
  const publicId = key.replace(/\.mp4$/i, '');
  const timestamp = Math.floor(Date.now() / 1000);
  // signature = sha1 of the sorted params (except file, api_key, resource_type) + API secret
  const params: Record<string, string> = { overwrite: 'true', public_id: publicId, timestamp: String(timestamp) };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = createHash('sha1').update(toSign + apiSecret).digest('hex');
  const form = new FormData();
  form.append('file', await openAsBlob(file), basename(file));
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append('api_key', h.cloudinaryKey);
  form.append('signature', signature);
  const base = process.env.OOPSMITH_CLOUDINARY_BASE ?? 'https://api.cloudinary.com';
  const r = await fetch(`${base}/v1_1/${encodeURIComponent(h.cloudinaryCloud)}/video/upload`, { method: 'POST', body: form });
  const j = (await r.json().catch(() => ({}))) as { secure_url?: string; error?: { message?: string } };
  if (!r.ok || !j.secure_url) throw new Error(`Cloudinary upload failed: ${j.error?.message ?? `HTTP ${r.status}`}`);
  return j.secure_url;
}

const sha256 = (d: string | Buffer) => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();

async function r2Put(h: HostSettings, secret: string, file: string, key: string): Promise<string> {
  if (!h.r2Account || !h.r2Bucket || !h.r2KeyId || !secret || !h.r2PublicBase) throw new Error('Cloudflare R2 is not fully set up (account ID, bucket, access key, secret, public URL).');
  const host = process.env.OOPSMITH_R2_HOST ?? `${h.r2Account}.r2.cloudflarestorage.com`;
  const path = `/${h.r2Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const body = readFileSync(file);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const region = 'auto';
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, 'content-type': 'video/mp4' };
  const signed = Object.keys(headers).sort();
  const canonical = ['PUT', path, '', signed.map((k) => `${k}:${headers[k]}\n`).join(''), signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), 's3'), 'aws4_request');
  const sig = createHmac('sha256', kSign).update(stringToSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${h.r2KeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${sig}`;
  const proto = process.env.OOPSMITH_R2_HOST ? 'http' : 'https';
  const r = await fetch(`${proto}://${host}${path}`, {
    method: 'PUT',
    headers: { ...headers, authorization: auth, 'content-length': String(body.length) },
    body,
  });
  if (!r.ok) throw new Error(`R2 upload failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return `${h.r2PublicBase.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Buffer fetches the file later without signing in: make sure the URL really is public. */
export async function checkPublic(url: string): Promise<boolean> {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (r.status === 405) r = await fetch(url, { headers: { range: 'bytes=0-0' } });
    const type = r.headers.get('content-type') ?? '';
    return r.ok && /video|octet-stream/.test(type);
  } catch {
    return false;
  }
}
