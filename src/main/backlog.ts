// The story backlog: true stories Scripty researched ahead of time, pinned on the corkboard by his desk.
// Lives in the team's toolkit at shorts/backlog.json (so it's on GitHub with everything else). The daily run takes the
// top card; you can reorder or veto cards. Researching several stories in one go costs less than one search per Short.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BacklogCard } from '../shared/types';

export const BACKLOG_FILE = 'shorts/backlog.json';
/** keep this many stories ready */
export const BACKLOG_TARGET = 5;
/** research more when fewer than this are left */
export const BACKLOG_LOW = 3;

export function readBacklog(toolkit: string): BacklogCard[] {
  try {
    const j = JSON.parse(readFileSync(join(toolkit, BACKLOG_FILE), 'utf8')) as { cards?: BacklogCard[] } | BacklogCard[];
    const cards = Array.isArray(j) ? j : j.cards ?? [];
    return cards.filter((c) => c && c.id && c.title).map((c) => ({ ...c, status: c.status ?? 'ready' }));
  } catch {
    return [];
  }
}

export function writeBacklog(toolkit: string, cards: BacklogCard[]) {
  mkdirSync(join(toolkit, 'shorts'), { recursive: true });
  writeFileSync(join(toolkit, BACKLOG_FILE), JSON.stringify({ cards }, null, 1) + '\n');
}

export const readyCards = (toolkit: string) => readBacklog(toolkit).filter((c) => c.status === 'ready');
export const hasBacklog = (toolkit: string) => existsSync(join(toolkit, BACKLOG_FILE));
