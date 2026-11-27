// The only bridge between the office window and the main process.
import { contextBridge, ipcRenderer } from 'electron';
import type { AccountState, AgentEvent, StudioApi, UsageState } from '../shared/types';

const on = <T>(channel: string, cb: (v: T) => void) => {
  const fn = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

const api: StudioApi = {
  getAgents: (t) => ipcRenderer.invoke('agents:list', t),
  listTeams: () => ipcRenderer.invoke('teams:list'),
  addTeam: (name, repo) => ipcRenderer.invoke('teams:add', name, repo),
  renameTeam: (t, name) => ipcRenderer.invoke('teams:rename', t, name),
  setTeamRepo: (t, repo) => ipcRenderer.invoke('teams:repo', t, repo),
  removeTeam: (t) => ipcRenderer.invoke('teams:remove', t),
  onTeams: (cb) => on('teams', cb),
  getUsage: (t) => ipcRenderer.invoke('usage:get', t),
  getReview: (t, id) => ipcRenderer.invoke('review:get', t, id),
  decideReview: (t, id, approve, notes) => ipcRenderer.invoke('review:decide', t, id, approve, notes),
  sendOn: (t, id) => ipcRenderer.invoke('review:send-on', t, id),
  uploadNow: (t, id) => ipcRenderer.invoke('review:upload', t, id),
  publishingStatus: (t) => ipcRenderer.invoke('publish:status', t),
  setSecret: (name, value) => ipcRenderer.invoke('publish:secret', name, value),
  bufferChannels: () => ipcRenderer.invoke('publish:channels'),
  youtubeStatus: (t) => ipcRenderer.invoke('youtube:status', t),
  chooseClientSecret: (t) => ipcRenderer.invoke('youtube:client-secret', t),
  signInYouTube: (t) => ipcRenderer.invoke('youtube:sign-in', t),
  onYouTubeLog: (cb) => on('youtube:log', cb),
  markPosted: (t, id, whenIso) => ipcRenderer.invoke('review:mark-posted', t, id, whenIso),
  unmarkPosted: (t, id) => ipcRenderer.invoke('review:unmark-posted', t, id),
  onPipelineBlocked: (cb) => on('pipeline:blocked', cb),
  appVersion: () => ipcRenderer.invoke('app:version'),
  runDaily: (team) => ipcRenderer.invoke('agents:daily', team),
  getHistory: (team, a) => ipcRenderer.invoke('agents:history', team, a),
  send: (team, a, t) => ipcRenderer.invoke('agents:send', team, a, t),
  stop: (team, a) => ipcRenderer.invoke('agents:stop', team, a),
  newChat: (team, a) => ipcRenderer.invoke('agents:new', team, a),
  answerPermission: (team, a, id, allow) => ipcRenderer.invoke('agents:permission', team, a, id, allow),
  onEvent: (cb) => on<AgentEvent>('agent:event', cb),

  getAccount: () => ipcRenderer.invoke('account:get'),
  recheckAccount: () => ipcRenderer.invoke('account:recheck'),
  openLogin: () => ipcRenderer.invoke('account:login'),
  onAccount: (cb) => on<AccountState>('account', cb),
  onUsage: (cb) => on<UsageState>('usage', cb),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  setGeminiKey: (k) => ipcRenderer.invoke('settings:gemini', k),
  testGeminiKey: () => ipcRenderer.invoke('settings:gemini-test'),
  pickToolkitFolder: (t) => ipcRenderer.invoke('settings:pick-toolkit', t),
  cloneToolkit: (t) => ipcRenderer.invoke('toolkit:clone', t),
  syncToolkit: (t) => ipcRenderer.invoke('toolkit:sync', t),
  onToolkit: (cb) => on('toolkit', cb),

  listShorts: (t) => ipcRenderer.invoke('shorts:list', t),
  fileUrl: (t, p, src) => ipcRenderer.invoke('file:url', t, p, src),
  setupRendering: () => ipcRenderer.invoke('render:setup'),
  onSetup: (cb) => on('render:setup', cb),
  openOutputFolder: (t) => ipcRenderer.invoke('render:open-output', t),
  openSetupLog: () => ipcRenderer.invoke('render:open-log'),
  onBoardChanged: (cb) => on('board:changed', cb),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  onUpdate: (cb) => on('update', cb),

  getPlan: () => ipcRenderer.invoke('plan:get'),
  onPlan: (cb) => on('plan', cb),
  openWeek: (w) => ipcRenderer.invoke('plan:open', w),
  setPostingDays: (d) => ipcRenderer.invoke('plan:days', d),
  pickFolder: (k) => ipcRenderer.invoke('folders:pick', k),
  resetFolder: (k) => ipcRenderer.invoke('folders:reset', k),
  folders: () => ipcRenderer.invoke('folders:get'),

  getBacklog: (t) => ipcRenderer.invoke('backlog:get', t),
  saveBacklog: (t, c) => ipcRenderer.invoke('backlog:save', t, c),
  refillBacklog: (t) => ipcRenderer.invoke('backlog:refill', t),
  makeFromCard: (t, c) => ipcRenderer.invoke('backlog:make', t, c),
  onBacklog: (cb) => on('backlog', cb),

  testNotify: () => ipcRenderer.invoke('notify:test'),

  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  addProfile: (n) => ipcRenderer.invoke('profiles:add', n),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  loginProfile: (id) => ipcRenderer.invoke('profiles:login', id),
  recheckProfile: (id) => ipcRenderer.invoke('profiles:recheck', id),
  setTeamProfile: (t, p) => ipcRenderer.invoke('teams:profile', t, p),
  onProfiles: (cb) => on('profiles', cb),

  onGuard: (cb) => on('guard', cb),
  getGuard: () => ipcRenderer.invoke('guard:get'),
  onCelebrate: (cb) => on('celebrate', cb),
  onVisible: (cb) => on('window:visible', cb),
  onSettingsChanged: (cb) => on('settings:changed', cb),
};

contextBridge.exposeInMainWorld('studio', api);
