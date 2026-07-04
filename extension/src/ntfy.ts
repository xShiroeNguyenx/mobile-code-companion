import type { CompanionConfig } from './config';

export type NtfyPusher = (title: string, body: string) => void;

/**
 * Optional push channel that works even when the web app is closed:
 * plain POST to an ntfy topic URL (https://ntfy.sh/<topic> or self-hosted).
 * Title goes into the body — HTTP header values must stay Latin-1 and our
 * titles are Vietnamese.
 */
export function makeNtfyPusher(getConfig: () => CompanionConfig, log: (m: string) => void): NtfyPusher {
  return (title: string, body: string): void => {
    const url = getConfig().ntfyUrl.trim();
    if (!url) return;
    void fetch(url, {
      method: 'POST',
      body: `${title}\n${body}`.slice(0, 2000),
      headers: { Priority: 'high', Tags: 'robot' },
    }).catch((err) => log(`ntfy push failed: ${err}`));
  };
}
