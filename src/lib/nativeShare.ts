/**
 * Present the platform's real share surface when the iOS shell provides it,
 * falling back to Web Share everywhere else. Callers stay platform-neutral and
 * retain their existing clipboard fallback when neither surface is available.
 */
export type ShareContent = {
  title?: string;
  text?: string;
  url?: string;
};

type NativeShareHandler = { postMessage: (content: ShareContent) => void };

function nativeShareHandler(): NativeShareHandler | undefined {
  const nativeWindow = window as typeof window & {
    webkit?: { messageHandlers?: { dormcheckNativeShare?: NativeShareHandler } };
  };
  return nativeWindow.webkit?.messageHandlers?.dormcheckNativeShare;
}

export function canShareContent(): boolean {
  return Boolean(nativeShareHandler() || navigator.share);
}

/** Returns false only when neither native nor Web Share is available. */
export async function shareContent(content: ShareContent): Promise<boolean> {
  const handler = nativeShareHandler();
  if (handler) {
    handler.postMessage(content);
    return true;
  }
  if (!navigator.share) return false;
  await navigator.share(content);
  return true;
}
