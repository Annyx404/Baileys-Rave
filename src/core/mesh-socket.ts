import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';

import { MeshSocketConfig } from '../schemas/private';
import {
  DEFAULT_LANGUAGE,
  SOCKET_DEAD_TIMEOUT,
  SOCKET_PING_DELAY,
} from '../constants';
import { LOGGER } from '../utils/logger';
import { SocksProxyAgent } from 'socks-proxy-agent';

export interface SocketResponse {
  ok: boolean;
  data?: unknown;
  errorCode?: number | string;
  errorReason?: string;
  timedOut?: boolean;
}

export interface ChatOptions {
  text?: string;
  lang?: string;
  replyTo?: string | null;
  mentions?: { id: number | string; handle: string }[];
  media?: { mime: string; url: string; isExplicit?: boolean }[];
  id?: string;
}

export interface ChatResult extends SocketResponse {
  messageId: string;
  echoId?: string;
}

interface EchoWaiter {
  text: string;
  done: (echoId: string | null) => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ECHO_TIMEOUT = 8000;

export class MeshSocket {
  private __config: MeshSocketConfig;
  private __url: string;
  private __peerId: string;
  private __websocket: WebSocket;
  private __heartbeat?: NodeJS.Timeout;
  private __lastActivity = Date.now();
  private __pending = new Map<number, (r: SocketResponse) => void>();
  private __echoes = new Map<string, EchoWaiter>();
  private __meshState: Record<string, any> | undefined;
  private __videoInstanceId: string | undefined;

  constructor(config: MeshSocketConfig) {
    this.__config = config;
    this.__peerId = `${this.__config.userId}_${this.__config.credentials.deviceId}`;
    this.__url = `wss://${this.__config.server}/?roomId=${this.__config.meshId}&peerId=${this.__peerId}`;
    this.__websocket = new WebSocket(this.__url, 'protoo', {
      rejectUnauthorized: false,
      perMessageDeflate: false,
      headers: {
        authorization: `Bearer ${this.__config.credentials.token}`,
        'API-Version': '4',
        'User-Agent': 'okhttp/5.1.0',
        'Accept-Encoding': 'gzip',
      },
      agent: this.__config.proxy
        ? new SocksProxyAgent(this.__config.proxy)
        : undefined,
    });

    this.__websocket.on('error', (error: Error) => {
      LOGGER.error({ url: this.__url, error: error?.message }, 'Erro no WebSocket');
    });

    this.__websocket.on('open', () => {
      LOGGER.info({ url: this.__url }, 'WebSocket aberto');
      this.__touch();
      this.__sendFullyJoined();
      this.__startHeartbeat();
    });

    this.__websocket.on('message', this.__touch);
    this.__websocket.on('message', this.__onResponse);
    this.__websocket.on('message', this.__onChatEcho);
    this.__websocket.on('message', this.__onStateMessage);
    this.__websocket.on('pong', this.__touch);

    this.__websocket.on('close', () => {
      LOGGER.info({ url: this.__url }, 'WebSocket fechado');
      this.__stopHeartbeat();
      this.__flushPending('closed');
      this.__flushEchoes();
    });
  }

  private __touch = () => {
    this.__lastActivity = Date.now();
  };

  private __startHeartbeat = () => {
    this.__stopHeartbeat();
    this.__heartbeat = setInterval(() => {
      if (this.__websocket.readyState !== WebSocket.OPEN) {
        this.__stopHeartbeat();
        return;
      }

      if (Date.now() - this.__lastActivity > SOCKET_DEAD_TIMEOUT) {
        LOGGER.warn({ url: this.__url }, 'WebSocket sem resposta, derrubando');
        this.terminate();
        return;
      }

      try {
        this.__pingServer();
        this.__websocket.ping();
      } catch {}
    }, SOCKET_PING_DELAY);
    this.__heartbeat.unref?.();
  };

  private __stopHeartbeat = () => {
    if (this.__heartbeat) clearInterval(this.__heartbeat);
    this.__heartbeat = undefined;
  };

  private __send = (data: string) => {
    LOGGER.info({ url: this.__url, data }, 'Enviando dados');
    this.__websocket.send(data);
  };

  private __sendFullyJoined = () => {
    this.__send(
      JSON.stringify({
        data: {},
        id: 1207144,
        method: 'fullyJoined',
        request: true,
      }),
    );
  };

  private __pingServer = () => {
    this.__send(
      JSON.stringify({
        data: {},
        id: 8841449,
        method: 'clientPing',
        request: true,
      }),
    );
  };

  private __onResponse = (raw: unknown) => {
    if (this.__pending.size === 0) return;

    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    const isResponse =
      msg.response === true ||
      (msg.method === undefined && msg.id !== undefined && 'ok' in msg);
    if (!isResponse) return;

    const done = this.__pending.get(msg.id);
    if (!done) return;
    this.__pending.delete(msg.id);
    done({
      ok: msg.ok !== false,
      data: msg.data,
      errorCode: msg.errorCode,
      errorReason: msg.errorReason,
    });
  };

  private __onChatEcho = (raw: unknown) => {
    if (this.__echoes.size === 0) return;

    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || msg.method !== 'chatMessage') return;

    const data = msg.data;
    if (!data || typeof data !== 'object') return;

    const from = typeof data.from === 'string' ? data.from : null;
    if (from && from !== this.__peerId) return;

    const echoId = typeof data.id === 'string' ? data.id : null;
    if (echoId) {
      const exact = this.__echoes.get(echoId);
      if (exact) {
        this.__echoes.delete(echoId);
        exact.done(echoId);
        return;
      }
    }

    const chat = typeof data.chat === 'string' ? data.chat : '';
    if (!chat) return;

    for (const [key, waiter] of this.__echoes) {
      if (!waiter.text || waiter.text !== chat) continue;
      this.__echoes.delete(key);
      waiter.done(echoId || key);
      return;
    }
  };

  private __findInstanceId = (node: unknown, depth = 0): string | undefined => {
    if (!node || typeof node !== 'object' || depth > 6) return undefined;

    const entries = Object.entries(node as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (!/instance/i.test(key)) continue;
      if (typeof value === 'string' && UUID_RE.test(value)) return value;
      if (value && typeof value === 'object') {
        for (const inner of Object.values(value as Record<string, unknown>)) {
          if (typeof inner === 'string' && UUID_RE.test(inner)) return inner;
        }
      }
    }
    for (const [, value] of entries) {
      if (value && typeof value === 'object') {
        const found = this.__findInstanceId(value, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };

  private __onStateMessage = (raw: unknown) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || msg.method !== 'stateMessage') return;

    let inner: any = msg.data?.message;
    if (typeof inner === 'string') {
      try {
        inner = JSON.parse(inner);
      } catch {
        return;
      }
    }
    if (!inner || typeof inner !== 'object') return;

    const state = inner.mesh_state ?? inner.meshState ?? inner;
    if (!state || typeof state !== 'object') return;

    this.__meshState = state;
    const instanceId = this.__findInstanceId(state);
    if (instanceId) this.__videoInstanceId = instanceId;
  };

  private __flushPending = (errorCode: string) => {
    const waiting = Array.from(this.__pending.values());
    this.__pending.clear();
    for (const done of waiting) {
      done({ ok: false, errorCode, errorReason: 'socket closed' });
    }
  };

  private __flushEchoes = () => {
    const waiting = Array.from(this.__echoes.values());
    this.__echoes.clear();
    for (const waiter of waiting) waiter.done(null);
  };

  private __newId = (): number => {
    let id: number;
    do {
      id = Math.floor(Math.random() * 9999999) + 1;
    } while (this.__pending.has(id));
    return id;
  };

  private __requestRaw = (
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<SocketResponse> =>
    new Promise((resolve) => {
      if (!this.isOpen) {
        resolve({ ok: false, errorCode: 'not_open', errorReason: 'socket not open' });
        return;
      }

      const id = this.__newId();
      const timer = setTimeout(() => {
        this.__pending.delete(id);
        resolve({ ok: false, timedOut: true, errorCode: 'timeout' });
      }, timeoutMs);
      this.__pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });

      if (!this.send({ ...payload, id })) {
        clearTimeout(timer);
        this.__pending.delete(id);
        resolve({ ok: false, errorCode: 'send_failed' });
      }
    });

  public send = (payload: object): boolean => {
    if (!this.isOpen) return false;
    try {
      this.__send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  public notify = (method: string, data: object = {}): boolean =>
    this.send({ data, method, notification: true });

  public request = (
    method: string,
    data: object = {},
    timeoutMs = 10000,
  ): Promise<SocketResponse> =>
    this.__requestRaw({ data, method, request: true }, timeoutMs);

  private __chatData = (options: ChatOptions) => {
    const text = options.text ?? '';
    const lang = options.lang ?? DEFAULT_LANGUAGE;
    const messageId = options.id ?? randomUUID();

    const data: Record<string, unknown> = {
      chat: text,
      detected_lang: lang,
      id: messageId,
      translations: { [lang]: text },
    };

    if (options.replyTo) data.reply = options.replyTo;

    const media = (options.media ?? []).map((m, index) => ({
      index,
      mime: m.mime,
      url: m.url,
      isExplicit: !!m.isExplicit,
    }));
    if (media.length > 0) data.media = media;

    const mentions = (options.mentions ?? [])
      .filter((m) => m && m.id != null && m.handle)
      .map((m) => ({ handle: String(m.handle), id: Number(m.id) }));
    if (mentions.length > 0) data.user_metas = mentions;

    return { messageId, data };
  };

  public waitForEcho = (
    messageId: string,
    text = '',
    timeoutMs = ECHO_TIMEOUT,
  ): Promise<string | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.__echoes.delete(messageId);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();

      this.__echoes.set(messageId, {
        text,
        done: (echoId) => {
          clearTimeout(timer);
          resolve(echoId);
        },
      });
    });

  public sendChat = (options: ChatOptions): string | null => {
    const { messageId, data } = this.__chatData(options);
    const ok = this.send({
      data,
      method: 'chatMessage',
      notification: true,
    });
    return ok ? messageId : null;
  };

  public sendChatAndWait = async (
    options: ChatOptions,
    timeoutMs = ECHO_TIMEOUT,
  ): Promise<ChatResult> => {
    const { messageId, data } = this.__chatData(options);
    const espera = this.waitForEcho(
      messageId,
      String(options.text ?? ''),
      timeoutMs,
    );

    if (!this.send({ data, method: 'chatMessage', notification: true })) {
      return { ok: false, errorCode: 'send_failed', messageId };
    }

    const echoId = await espera;
    if (!echoId) {
      return {
        ok: false,
        timedOut: true,
        errorCode: 'no_echo',
        errorReason: 'a sala não devolveu a mensagem',
        messageId,
      };
    }

    return { ok: true, messageId, echoId };
  };

  public sendReaction = (messageId: string, emoji: string | null): string | null => {
    const id = randomUUID();
    const ok = this.send({
      data: {
        chat: '',
        detected_lang: null,
        id,
        translations: null,
        reply: null,
        emoji,
        reaction: messageId,
        media: [],
        links: [],
      },
      method: 'chatMessage',
      notification: true,
    });
    return ok ? id : null;
  };

  public sendTyping = (isTyping: boolean): boolean =>
    this.notify(isTyping ? 'typing' : 'typing_stop');

  get isOpen(): boolean {
    return this.__websocket.readyState === WebSocket.OPEN;
  }

  get peerId(): string {
    return this.__peerId;
  }

  get lastActivityAt(): number {
    return this.__lastActivity;
  }

  get videoInstanceId(): string | undefined {
    return this.__videoInstanceId;
  }

  get meshState(): Record<string, any> | undefined {
    return this.__meshState;
  }

  public onopen = (handler: () => void) => {
    this.__websocket.onopen = handler;
  };

  public onclose = (handler: () => Promise<void>) => {
    this.__websocket.on('close', handler);
  };

  public onerror = (handler: () => Promise<void>) => {
    this.__websocket.on('error', handler);
  };

  public onmessage = (handler: (data: string) => Promise<void>) => {
    this.__websocket.on('message', handler);
  };

  public sendMessage = (content: string, lang = DEFAULT_LANGUAGE): void => {
    const { data } = this.__chatData({ text: content, lang });
    this.__send(
      JSON.stringify({
        data,
        method: 'chatMessage',
        notification: true,
      }),
    );
  };

  public terminate = (): void => {
    this.__stopHeartbeat();
    this.__websocket.terminate();
  };

  public leave = (): void => {
    this.__stopHeartbeat();
    this.__websocket.close();
  };
}
