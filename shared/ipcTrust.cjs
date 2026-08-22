const path = require('path');
const { pathToFileURL } = require('url');

function normalizeRendererUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function isAllowedRendererUrl(value, options = {}) {
  const parsed = normalizeRendererUrl(value);
  if (!parsed || parsed.username || parsed.password) return false;
  const packagedEntry = options.packagedEntry ? pathToFileURL(path.resolve(options.packagedEntry)) : null;
  if (packagedEntry && parsed.protocol === 'file:') {
    return parsed.search === '' && decodeURIComponent(parsed.pathname) === decodeURIComponent(packagedEntry.pathname);
  }
  if (options.allowDevServer === true && parsed.protocol === 'http:' && parsed.hostname === 'localhost' && parsed.port === String(options.devPort || 5173)) {
    return parsed.pathname === '/' && parsed.search === '';
  }
  return false;
}

function isTrustedIpcEvent(event, options = {}) {
  if (!event?.sender || !event?.senderFrame || !event.sender.mainFrame) return false;
  const mainFrame=event.sender.mainFrame,sameMainFrame=event.senderFrame===mainFrame||(
    Number.isInteger(event.senderFrame.routingId)&&event.senderFrame.routingId===mainFrame.routingId&&event.senderFrame.processId===mainFrame.processId
  );
  if(!sameMainFrame)return false;
  if (typeof event.sender.isDestroyed === 'function' && event.sender.isDestroyed()) return false;
  if (!Array.isArray(options.browserWindows) || !options.browserWindows.some(window => window?.webContents === event.sender)) return false;
  return isAllowedRendererUrl(event.senderFrame.url, options);
}

module.exports = { normalizeRendererUrl, isAllowedRendererUrl, isTrustedIpcEvent };
