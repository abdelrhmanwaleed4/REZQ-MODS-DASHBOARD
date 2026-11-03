/** No server configuration or third-party secrets should be serialized to the browser. */
export function publicPlatformConfig() { return {}; }
export function publicPlatformScript() { return "window.__MANUS_CONFIG__={};"; }
