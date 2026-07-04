export interface SecureWebPreferences {
  preload: string;
  nodeIntegration: false;
  contextIsolation: true;
  sandbox: true;
  webSecurity: true;
  allowRunningInsecureContent: false;
}

export function createSecureWebPreferences(preloadPath: string): SecureWebPreferences {
  return {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false
  };
}
