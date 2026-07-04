import { useCallback, useEffect, useReducer, useRef, useState, type ReactElement } from 'react';
import type { ClientMessage } from '@shared/protocol';
import { alertForMessage } from './notify';
import Chat from './screens/Chat';
import Pair from './screens/Pair';
import Sessions from './screens/Sessions';
import Settings from './screens/Settings';
import { initialState, loadPairing, reducer, type AppState } from './store';
import { WsClient } from './ws';

// ---------------------------------------------------------------------------
// Tiny hash router: #/pair, #/sessions, #/chat, #/settings
// ---------------------------------------------------------------------------

function parseHash(): { route: string; params: URLSearchParams } {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = h.split('?');
  return { route: pathPart || '', params: new URLSearchParams(queryPart ?? '') };
}

export type SendFn = (m: ClientMessage) => void;

export interface Ctx {
  state: AppState;
  send: SendFn;
  navigate: (to: string) => void;
  reconnect: () => void;
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [hash, setHash] = useState(parseHash());
  const wsRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const onHash = () => setHash(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((to: string) => {
    window.location.hash = to.startsWith('#') ? to : `#/${to.replace(/^\//, '')}`;
  }, []);

  const reconnect = useCallback(() => {
    const pairing = loadPairing();
    wsRef.current?.dispose();
    wsRef.current = null;
    if (!pairing) return;
    const client = new WsClient(pairing.server, pairing.token);
    client.onStatus = (status) => dispatch({ type: 'conn', status });
    client.onMessage = (msg) => {
      alertForMessage(msg);
      dispatch({ type: 'server', msg });
    };
    client.connect();
    wsRef.current = client;
  }, []);

  useEffect(() => {
    reconnect();
    const onVisible = () => {
      if (!document.hidden) wsRef.current?.wake();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      wsRef.current?.dispose();
    };
  }, [reconnect]);

  const send = useCallback<SendFn>((m) => {
    wsRef.current?.send(m);
  }, []);

  const setViewSession = useCallback((sessionId: string | null) => {
    dispatch({ type: 'view.session', sessionId });
  }, []);

  const dismissToast = useCallback((id: number) => dispatch({ type: 'toast.dismiss', id }), []);

  const ctx: Ctx = { state, send, navigate, reconnect };
  const paired = !!loadPairing();

  let screen: ReactElement;
  if (!paired || hash.route === 'pair') {
    screen = <Pair ctx={ctx} params={hash.params} />;
  } else if (hash.route === 'sessions') {
    screen = <Sessions ctx={ctx} setViewSession={setViewSession} />;
  } else if (hash.route === 'settings') {
    screen = <Settings ctx={ctx} />;
  } else {
    screen = <Chat ctx={ctx} setViewSession={setViewSession} />;
  }

  return (
    <div className="app">
      {screen}
      {state.toasts.length > 0 && (
        <div className="toasts">
          {state.toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
              <div className="t">{t.title}</div>
              {t.body && <div className="b">{t.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
