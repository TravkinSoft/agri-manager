'use strict';
// Additional guard for trusted preparation commands; the platform enforces egress.
const net = require('node:net');
const originalConnect = net.Socket.prototype.connect;
const buildFonts = process.env.TRA11_BUILD_FONTS === '1';

function normalizeHost(host) {
  return String(host).toLowerCase().replace(/^\[|\]$/g, '');
}
function readBuildProxy() {
  if (!buildFonts || process.env.TRA11_BUILD_PROXY !== '1') return null;
  // Match Next 13.5.1 getProxyAgent precedence. Never log this URL.
  const value = process.env.https_proxy || process.env.HTTPS_PROXY
    || process.env.http_proxy || process.env.HTTP_PROXY;
  let proxy;
  try {
    proxy = new URL(value);
  } catch {
    throw new Error('TRA11_OFFLINE: valid platform build proxy required');
  }
  const port = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
  if (!['http:', 'https:'].includes(proxy.protocol) || !proxy.hostname
      || (proxy.pathname && proxy.pathname !== '/') || proxy.search || proxy.hash
      || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('TRA11_OFFLINE: unsupported platform build proxy');
  }
  return { host: normalizeHost(proxy.hostname), port };
}
const buildProxy = readBuildProxy();
function isLocal(host) {
  return host === undefined || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function allowed(host) {
  return isLocal(host) || (buildFonts && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host));
}
function allowedProxyTransport(host, port) {
  return buildProxy !== null
    && host !== undefined
    && normalizeHost(host) === buildProxy.host
    && Number(port) === buildProxy.port;
}
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  const options = first !== null && typeof first === 'object' ? first : null;
  const host = options ? options.host
    : typeof normalized[1] === 'string' ? normalized[1] : undefined;
  const port = options ? options.port : first;
  const proxyTransport = !(options && options.path) && allowedProxyTransport(host, port);
  if (!allowed(host) && !proxyTransport) {
    throw new Error('TRA11_OFFLINE: external socket denied');
  }
  return originalConnect.apply(this, args);
};
const realFetch = globalThis.fetch;
if (realFetch) globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!allowed(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('TRA11_OFFLINE: external fetch denied');
  return realFetch(input, init);
};
