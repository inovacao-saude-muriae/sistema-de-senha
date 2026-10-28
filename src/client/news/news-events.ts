/**
 * Aviso de mudança na lista de notícias.
 *
 * O admin e o monitor costumam estar em abas/janelas diferentes: um evento
 * em `window` não cruza essa fronteira. O `BroadcastChannel` faz o aviso
 * entre abas e o evento local mantém o mesmo documento sincronizado.
 */
const CHANNEL_NAME = 'saude-news-changed';
const LOCAL_EVENT = 'news-changed';

let channel: BroadcastChannel | null = null;

/** Publica "as notícias mudaram" para esta aba e para as demais. */
export function notifyNewsChanged(): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new Event(LOCAL_EVENT));

  try {
    getChannel()?.postMessage('changed');
  } catch {
    // BroadcastChannel indisponível/fechado: o evento local já resolve.
  }
}

/**
 * Assina o aviso. Devolve a função de cancelamento.
 *
 * O callback deve buscar a lista de novo — o aviso carrega só o sinal, não
 * o payload, para o servidor continuar sendo a fonte da verdade.
 */
export function subscribeNewsChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onLocal = () => callback();
  window.addEventListener(LOCAL_EVENT, onLocal);

  const bc = getChannel();
  const onMessage = () => callback();
  bc?.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener(LOCAL_EVENT, onLocal);
    bc?.removeEventListener('message', onMessage);
  };
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}
