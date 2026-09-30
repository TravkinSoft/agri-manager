'use strict';
// Preparation-only child process guard. No database or external-service traffic.
const net = require('node:net');
const originalConnect = net.Socket.prototype.connect;
function isLocal(host) {
  return host === undefined || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function allowed(host) {
  return isLocal(host) || (process.env.TRA11_BUILD_FONTS === '1' && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host));
}
net.Socket.prototype.connect = function (...args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  const host = typeof first === 'object' ? first.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (!allowed(host)) throw new Error('TRA11_OFFLINE: external socket denied');
  return originalConnect.apply(this, args);
};
const realFetch = globalThis.fetch;
if (realFetch) globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('TRA11_OFFLINE: external fetch denied');
  return realFetch(input, init);
};
