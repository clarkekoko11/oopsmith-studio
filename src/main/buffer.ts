// Buffer's GraphQL API (https://api.buffer.com, personal API key): find the YouTube channel,
// schedule a Short at an exact time (or save it as a draft), and check later whether it went out.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = () => process.env.OOPSMITH_BUFFER_API ?? 'https://api.buffer.com';

export interface BufferChannel { id: string; name: string; service: string }

async function gql<T>(key: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch(ENDPOINT(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 401 || r.status === 403) throw new Error('Buffer rejected the API key.');
  if (r.status === 429) throw new Error(`Buffer rate limit reached; try again in ${r.headers.get('retry-after') ?? 'a few'} seconds.`);
  const j = (await r.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
  if (j.errors?.length) throw new Error(`Buffer: ${j.errors.map((e) => e.message).join('; ')}`);
  if (!r.ok || !j.data) throw new Error(`Buffer: HTTP ${r.status}`);
  return j.data;
}

/** All channels in every organization of this Buffer account (YouTube ones first). */
export async function listChannels(key: string): Promise<BufferChannel[]> {
  const a = await gql<{ account: { organizations: { id: string }[] } }>(key, 'query { account { organizations { id } } }');
  const out: BufferChannel[] = [];
  for (const org of a.account.organizations) {
    const c = await gql<{ channels: { id: string; name?: string; displayName?: string; service: string }[] }>(
      key,
      `query { channels(input: { organizationId: ${JSON.stringify(org.id)} }) { id name displayName service } }`,
    );
    for (const ch of c.channels) out.push({ id: ch.id, name: ch.displayName || ch.name || ch.id, service: ch.service });
  }
  return out.sort((x, y) => Number(/youtube/i.test(y.service)) - Number(/youtube/i.test(x.service)));
}

export interface ShortPost {
  channelId: string;
  videoUrl: string;
  title: string;
  description: string;
  /** ISO time to publish; null = save as a draft in Buffer */
  dueAt: string | null;
  categoryId?: string;
}

/** Create the YouTube Short post in Buffer. Returns Buffer's post id. */
export async function createShortPost(key: string, p: ShortPost): Promise<string> {
  const input: Record<string, unknown> = {
    channelId: p.channelId,
    text: p.description,
    schedulingType: 'automatic',
    mode: p.dueAt ? 'customScheduled' : 'addToQueue',
    assets: [{ video: { url: p.videoUrl } }],
    metadata: {
      youtube: {
        title: p.title.slice(0, 100),
        categoryId: p.categoryId ?? '24',
        privacy: 'public',
        madeForKids: false,
        notifySubscribers: true,
        type: 'short',
      },
    },
  };
  if (p.dueAt) input.dueAt = p.dueAt;
  else input.saveToDraft = true;
  const d = await gql<{ createPost: { post?: { id: string }; message?: string } }>(
    key,
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }`,
    { input },
  );
  if (!d.createPost.post) throw new Error(`Buffer: ${d.createPost.message ?? 'post was not created'}`);
  return d.createPost.post.id;
}

export interface PostState { status: string; sentAt?: string; error?: string }

export async function postStatus(key: string, id: string): Promise<PostState> {
  const d = await gql<{ post: { status: string; sentAt?: string; error?: { message?: string } | null } }>(
    key,
    `query { post(input: { id: ${JSON.stringify(id)} }) { status sentAt error { message } } }`,
  );
  return { status: d.post.status, sentAt: d.post.sentAt, error: d.post.error?.message };
}

/** Posts now go out through review + Buffer, so the render worker must not upload to YouTube by itself. */
export function disableWorkerUpload(toolkit: string): boolean {
  const f = join(toolkit, 'worker.json');
  try {
    const cfg = JSON.parse(readFileSync(f, 'utf8'));
    if (!cfg.youtube?.enabled) return false;
    cfg.youtube.enabled = false;
    writeFileSync(f, JSON.stringify(cfg, null, 2));
    return true;
  } catch {
    return false;
  }
}
