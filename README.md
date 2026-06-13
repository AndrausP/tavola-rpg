# 🐉 Távola — Mesa de RPG D&D 5e

Mesa virtual de RPG em **tempo real** para jogar **Dungeons & Dragons 5ª Edição** com a galera, direto do navegador (e do celular). O mestre cria a campanha, compartilha o código, os jogadores montam seus personagens num criador guiado e a aventura acontece — com **rolagem de dados, chat, fichas vivas e sessões que dá pra pausar e retomar**.

Feito com **Node.js + Express + Socket.IO** e **JavaScript puro** no front (sem build, sem framework). Estética **medieval** (pergaminho, ouro, lacre de cera).

---

## ✨ O que tem

**Contas e login**
- **Cadastro com e-mail e senha** + **confirmação por e-mail** (a conta só ativa após confirmar).
- **Data de nascimento** no cadastro para liberar mesas adultas; mínimo de 13 anos para criar conta.
- Senhas guardadas com **scrypt** (nunca em texto puro); sessões por **token** (guardado só como hash).
- **Mesas 18+**: o mestre marca a mesa como adulta e só maiores de 18 anos conseguem entrar.

**Mesa em tempo real**
- O mestre cria a sala e recebe um **código de 5 caracteres** + link de convite (`?mesa=XXXXX`).
- Todos veem o grupo, as fichas e as rolagens ao vivo.
- **Cena atual** que o mestre escreve e todos enxergam.

**Criação de personagem guiada** (6 etapas, com prévia ao vivo)
- Identidade (nome, **retrato/foto**, cor, tendência, antecedente)
- Raça + linhagem · Classe · Atributos · Perícias · Revisão
- 9 raças, 12 classes e 10 antecedentes do **SRD 5e**
- Geração de atributos: **Conjunto Padrão**, **Compra de Pontos (27)** ou **Manual/Rolagem (4d6)**
- Cálculo automático de modificadores, **PV, CA, iniciativa, testes de resistência, perícias, CD de magia** etc.

**Ficha viva**
- Ficha completa estilizada como pergaminho.
- **Rolar direto da ficha**: toque numa perícia, atributo ou resistência e o d20 vai pro chat de todos.
- Controle de **PV** (dano/cura) pelo dono ou pelo mestre.
- O **mestre pode editar e apagar** qualquer ficha; NPCs também viram fichas.

**Dados**
- Dados rápidos (d4 a d100) e expressões livres (`2d6+3`, `4d6kh3`, `1d20-1`…).
- **Vantagem / desvantagem** em um toque.
- Críticos (20) e falhas críticas (1) destacados na crônica.

**Perfil, histórico e sessões pausadas**
- **Conta** com nome + avatar editáveis e estatísticas (mesas mestradas/jogadas, personagens criados).
- **Sessões pausadas**: o mestre pausa e retoma depois exatamente de onde parou (personagens, cena e crônica preservados).

**Pensado para o celular** — layout mobile-first com abas (Grupo · Crônica · Dados).

---

## 🚀 Rodando localmente

Pré-requisito: **Node.js 18+**.

```bash
npm install
npm start
```

Abra **http://localhost:3000**. Para testar sozinho, use várias abas/janelas.

Modo desenvolvimento (reinicia ao salvar):
```bash
npm run dev
```

---

## 👥 Jogando com amigos

O servidor precisa estar acessível pela internet:

**Túnel rápido:**
```bash
npm start
npx localtunnel --port 3000     # ou: ngrok http 3000
```

**Deploy:** Railway, Render ou similar (respeita a variável `PORT`). Comando de start: `npm start`.

> Os dados (contas, sessões pausadas, histórico) ficam em `data/db.json` no servidor. Em deploys efêmeros, use um disco persistente para não perder as contas e sessões.

---

## ⚙️ Configuração (variáveis de ambiente)

O app funciona sem nenhuma configuração em modo de desenvolvimento — **sem SMTP, o link de confirmação aparece no console e na própria tela** (modo dev), para você testar. Em **produção**, configure o envio de e-mail real:

| Variável | Para quê | Padrão |
|---|---|---|
| `PORT` | Porta do servidor | `3000` |
| `APP_URL` | URL pública (usada nos links de confirmação do e-mail) | `http://localhost:PORT` |
| `NODE_ENV` | Em `production`, esconde o link de confirmação de dev | — |
| `SMTP_HOST` | Servidor SMTP (ativa o envio real de e-mail) | — |
| `SMTP_PORT` | Porta SMTP | `587` |
| `SMTP_SECURE` | `true` para porta 465 (TLS direto) | `false` |
| `SMTP_USER` / `SMTP_PASS` | Credenciais SMTP | — |
| `MAIL_FROM` | Remetente dos e-mails | `Távola RPG <no-reply@tavola.local>` |
| `ALLOWED_ORIGINS` | Origens permitidas no WebSocket (CORS), separadas por vírgula | reflete a origem |
| `MAX_ROOMS` | Teto de mesas simultâneas | `2000` |
| `MAX_CONN_PER_IP` | Teto de conexões por IP | `60` |

Exemplo com Gmail (use uma **senha de app**):
```bash
APP_URL=https://suamesa.com NODE_ENV=production \
SMTP_HOST=smtp.gmail.com SMTP_PORT=587 \
SMTP_USER=voce@gmail.com SMTP_PASS=sua_senha_de_app \
MAIL_FROM="Távola RPG <voce@gmail.com>" npm start
```

---

## 🎮 Fluxo de uma sessão

1. Defina seu **nome de aventureiro** e avatar.
2. **Mestre:** "Mestrar uma Mesa" → configure a campanha → compartilhe o código.
3. **Jogadores:** "Entrar numa Mesa" → digite o código → **monte o personagem** no criador.
4. Joguem: role dados, converse no chat, o mestre narra pela **cena**.
5. **Pause** quando quiser — depois é só o mestre **retomar** pela lista de sessões pausadas.

---

## 🏗️ Estrutura

```
tavola-rpg/
├── server.js              # Express + Socket.IO (eventos da mesa)
├── src/
│   ├── srd.js             # dados D&D 5e (raças, classes, perícias, antecedentes)
│   ├── dice.js            # motor de dados (notação NdM, vantagem, manter maiores)
│   ├── Character.js       # cálculo da ficha (modificadores, PV, CA, perícias…)
│   ├── Room.js            # mesa: membros, personagens, log, cena, snapshot
│   ├── GameManager.js     # gerência de mesas e códigos
│   └── store.js           # persistência (perfis, histórico, sessões pausadas)
├── public/
│   ├── index.html
│   ├── css/style.css      # tema medieval
│   └── js/
│       ├── engine.js      # consumo do SRD + cálculo leve p/ prévia
│       ├── profile.js     # perfil local
│       ├── builder.js     # criador de personagem (6 etapas)
│       └── app.js         # mesa, ficha, dados, chat, socket
└── test/
    ├── test_core.mjs        # testes do núcleo (dados, ficha, mesa)
    └── test_integration.mjs # testes end-to-end (mestre + jogador via socket)
```

---

## 🧪 Testes

```bash
npm test
```

Cobre o motor de dados, o cálculo de fichas 5e (incluindo empilhamento de bônus raça+linhagem, PV por nível, CD de magia) e o fluxo completo da mesa (criar, entrar, criar ficha, rolar, chat, cena, permissões, pausar/retomar).

---

## ⚖️ Conteúdo D&D 5e

As regras e termos de jogo usados aqui vêm do **System Reference Document (SRD 5.1)**, distribuído pela Wizards of the Coast sob licença aberta (OGL / Creative Commons). Este é um projeto de fã, sem fins comerciais, e não é afiliado nem endossado pela Wizards of the Coast.

## 📝 Licença

MIT (código). Conteúdo de regras sob SRD/OGL conforme acima.
