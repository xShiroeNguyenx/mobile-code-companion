import type { ServerMessage } from '@shared/protocol';

/**
 * Local attention signals: vibration + a short beep, plus a Web Notification
 * when the tab is hidden. Note: on plain http:// (LAN) the Notification API is
 * usually unavailable — vibration/beep still work while the app is open.
 */

let audioCtx: AudioContext | undefined;

function beep(freq = 880, durationMs = 160): void {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch {
    /* audio unavailable */
  }
}

function vibrate(pattern: number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

function systemNotify(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    void new Notification(title, { body, tag: 'mcc' });
  } catch {
    /* unsupported (insecure context) */
  }
}

export function requestNotifyPermission(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  } catch {
    /* unsupported */
  }
}

/** Fire side effects for attention-worthy server events (called outside the reducer). */
export function alertForMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'approval.request':
      vibrate([200, 90, 200]);
      beep(880);
      systemNotify('Cần duyệt quyền', `${msg.approval.tool}`);
      break;
    case 'question.request':
      vibrate([120, 60, 120, 60, 120]);
      beep(660);
      systemNotify('Claude đang hỏi bạn', msg.question.questions[0]?.question ?? '');
      break;
    case 'notification':
      if (msg.notification.kind === 'stop') {
        vibrate([80]);
        beep(520, 120);
      }
      if (msg.notification.kind === 'error') beep(240, 220);
      systemNotify(msg.notification.title, msg.notification.body);
      break;
    default:
      break;
  }
}
