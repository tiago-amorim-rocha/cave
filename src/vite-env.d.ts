/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Type declarations for vite-plugin-pwa virtual module
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
  }

  export type RegisterSWReturn = (reloadPage?: boolean) => Promise<void>;

  export function registerSW(options?: RegisterSWOptions): RegisterSWReturn;
}
