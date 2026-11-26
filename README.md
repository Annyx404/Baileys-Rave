<div align="center">
    <h1>Baileys-Rave</h1>
    <a href="https://github.com/Annyx404/Baileys-Rave"><img src="https://img.shields.io/badge/GitHub-Annyx404%2FBaileys--Rave-181717?style=for-the-badge&logo=github" alt="GitHub"></a>
    <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
    <img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-green?style=for-the-badge" alt="Licença MIT">
    <h3>Biblioteca em TypeScript para a API do Rave (Watch Party).</h3>
</div>

Wrapper tipado e modular para o Rave: autenticação, salas (meshes), WebSocket do chat, DMs, perfis, amizades e vídeos (YouTube e Disney+). Suporte a proxy SOCKS.

## Instalação

```bash
npm i github:Annyx404/Baileys-Rave
```

Requer Node 18+ (usa `fetch` e `undici`).

## Uso

```typescript
import { Rave } from 'baileys-rave';

const rave = new Rave();
await rave.auth.authenticate('token', 'deviceId');

const socket = await rave.mesh.join('meshId');
socket.onmessage(async (raw) => {
  const msg = JSON.parse(raw);
  if (msg.method === 'chatMessage') socket.sendChat({ text: 'oi', lang: 'pt' });
});
```

## Estrutura

Tudo parte da classe `Rave`, dividida em factories:

| Acesso | Para quê |
|--------|----------|
| `rave.auth` | Login (magic link / mojo), JWT, conta |
| `rave.mesh` | Salas: entrar, listar, kick, mute, coroa, privacidade (privada, amigos, pública), estado do player, votar, curtir/pular, upload de mídia |
| `rave.user` | Perfis (um ou em lote), amizades e pedidos pendentes, nome, bio, avatar, galeria e visibilidade do online |
| `rave.thread` | DMs: listar, criar, enviar mensagem |
| `rave.video` | Buscar/registrar vídeos do YouTube e Disney+ |
| `rave.disney` | Buscar títulos, temporadas e episódios no Disney+ |

Propriedades úteis: `rave.token`, `rave.JWT`, `rave.account`, `rave.proxy` (setter aceita SOCKS).

### `MeshSocket`

Retornado por `rave.mesh.join(meshId)`. Cuida sozinho do `fullyJoined` e do heartbeat.

- `sendChat({ text, lang?, replyTo?, mentions?, media?, id? })` — envia e retorna o id da mensagem
- `sendChatAndWait(options, timeoutMs?)` — envia e espera a sala devolver a mensagem (o chat do Rave é `notification`, então não existe resposta do servidor: a confirmação é o próprio eco)
- `waitForEcho(messageId, texto?, timeoutMs?)` — espera o eco de uma mensagem já enviada
- `sendReaction(messageId, emoji)` — reage a uma mensagem
- `sendTyping(isTyping)` — avisa que está digitando
- `send(payload)` / `notify(method, data?)` / `request(method, data?, timeoutMs?)` — payloads crus pelo WebSocket
- `onopen / onclose / onerror / onmessage` — callbacks da conexão
- `leave()` / `terminate()` — sai da sala
- `isOpen`, `peerId`, `videoInstanceId`, `meshState` — estado atual

Os tipos de cada método e resposta estão exportados em `src/` (via `zod`), então o autocomplete do TypeScript cobre o resto da API.

## Licença

MIT. Veja [LICENSE](LICENSE).

Criado e mantido por **Annyx 🐾**.
