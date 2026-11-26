// The only bridge between the office window and the main process.
import { contextBridge, ipcRenderer } from 'electron';
import type { AccountState, AgentEvent, StudioApi, UsageState } from '../shared/types';

const on = <T>(channel: string, cb: (v: T) => void) => {
  const fn = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

const api: StudioApi = {
  getAgents: () => ipcRenderer.invoke('agents:list'),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  getReview: (id) => ipcRenderer.invoke('review:get', id),
  decideReview: (id, approve, notes) => ipcRenderer.invoke('review:decide', id, approve, notes),
  sendOn: (id) => ipcRenderer.invoke('review:send-on', id),
  uploadNow: (id) => ipcRenderer.invoke('review:upload', id),
  publishingStatus: () => ipcRenderer.invoke('publish:status'),
  setSecret: (name, value) => ipcRenderer.invoke('publish:secret', name, value),
  bufferChannels: () => ipcRenderer.invoke('publish:channels'),
  onPipelineBlocked: (cb) => on('pipeline:blocked', cb),
  appVersion: () => ipcRenderer.invoke('app:version'),
  runDaily: () => ipcRenderer.invoke('agents:daily'),
  getHistory: (a) => ipcRenderer.invoke('agents:history', a),
  send: (a, t) => ipcRenderer.invoke('agents:send', a, t),
  stop: (a) => ipcRenderer.invoke('agents:stop', a),
  newChat: (a) => ipcRenderer.invoke('agents:new', a),
  answerPermission: (a, id, allow) => ipcRenderer.invoke('agents:permission', a, id, allow),
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
  pickToolkitFolder: () => ipcRenderer.invoke('settings:pick-toolkit'),
  cloneToolkit: () => ipcRenderer.invoke('toolkit:clone'),
  syncToolkit: () => ipcRenderer.invoke('toolkit:sync'),
  onToolkit: (cb) => on('toolkit', cb),

  listShorts: () => ipcRenderer.invoke('shorts:list'),
  fileUrl: (p, src) => ipcRenderer.invoke('file:url', p, src),
  setupRendering: () => ipcRenderer.invoke('render:setup'),
  onSetup: (cb) => on('render:setup', cb),
  openOutputFolder: () => ipcRenderer.invoke('render:open-output'),
  openSetupLog: () => ipcRenderer.invoke('render:open-log'),
  onBoardChanged: (cb) => on('board:changed', () => cb()),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  onUpdate: (cb) => on('update', cb),
};

contextBridge.exposeInMainWorld('studio', api);
