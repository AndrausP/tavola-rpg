# 🛡️ Segurança — Távola RPG

Este documento descreve as proteções implementadas e, com honestidade, os limites do modelo de segurança. **Nenhum sistema é 100% seguro** — o objetivo aqui é defesa em camadas e redução real da superfície de ataque.

## Proteções implementadas

### Validação e sanitização de entrada (`src/validate.js`)
Tudo que vem do cliente é tratado como não confiável e passa por **allowlist explícita**:
- Chaves de jogo (raça, classe, antecedente, perícias, atributos) são validadas contra o SRD; valores desconhecidos viram `null` ou são descartados.
- Números são limitados a faixas seguras (nível 1–20, atributos 1–30, PV, CA…).
- Textos têm caracteres de controle removidos e tamanho máximo (nome, bio, chat, cena…).
- Atualizações de ficha são **parciais por allowlist**: só os campos enviados mudam (evita sobrescrever a ficha inteira).
- O **cliente nunca define `ownerProfileId` nem `id`** — isso é sempre derivado no servidor.

### Proteção contra XSS
- Todo conteúdo dinâmico é escapado no cliente (`esc()`) antes de ir para o HTML.
- **Fotos/retratos** são validados estritamente (somente `data:image/...;base64` ou emoji curto) no servidor **e** no cliente, bloqueando quebra de CSS/HTML e esquemas `javascript:`/`data:text/html`.
- **CSP** (Content-Security-Policy) restritiva: scripts apenas da própria origem (`script-src 'self'`), sem `unsafe-inline` para scripts.

### Proteção contra prototype pollution
- Objetos vindos do cliente nunca são mesclados cegamente: lê-se apenas chaves conhecidas.
- Chaves perigosas (`__proto__`, `constructor`, `prototype`) são removidas.

### Rate limiting e anti-DoS (`src/rateLimiter.js`)
- Limite de ações por conexão e por categoria (chat, rolagens, salvar ficha, criar mesa…).
- Limite de **conexões por IP**.
- Limite de **mesas no servidor** e de **personagens por sala** (40).
- Tamanho máximo de mensagem WebSocket (1 MB).
- Log de sessão e chat com tamanho limitado.
- O servidor não derruba o processo por exceção inesperada.

### Autorização
- Ações de mestre (configurar mesa, cena, pausar) exigem ser o mestre.
- Jogadores só editam/leem a própria ficha; o mestre pode editar todas (se permitido na config).
- Códigos de sala são validados quanto ao formato antes de qualquer busca.

### Headers HTTP de segurança
`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (anti-clickjacking), `Referrer-Policy: no-referrer`, `Permissions-Policy` (bloqueia câmera/mic/geo), `Cross-Origin-Opener-Policy`, `Strict-Transport-Security` (sob HTTPS), e `X-Powered-By` removido.

### Dados de jogo
- O motor de dados **não usa `eval`**: a expressão é validada por regex e parseada manualmente, com limites de quantidade.

### Autenticação e contas (`src/auth.js`)
- **Senhas** com hash **scrypt** (KDF nativo do Node, sem dependências) + salt único por usuário; verificação em tempo constante (`timingSafeEqual`).
- **Sessões** por token aleatório (32 bytes); no banco guarda-se **apenas o hash SHA-256** do token (um vazamento do arquivo não dá sessões usáveis).
- **Confirmação de e-mail** obrigatória: a conta só entra após confirmar; tokens de confirmação são de **uso único**, expiram em 24h e também são guardados só como hash.
- **Trava de idade**: a idade é calculada da data de nascimento; mesas marcadas como adultas (18+) bloqueiam quem não tem 18 anos. Mínimo de 13 anos para criar conta.
- **Anti-enumeração**: login com e-mail inexistente ainda executa um hash "fantasma" para igualar o tempo de resposta; mensagens de erro não revelam se o e-mail existe.
- **Rate limiting** nas rotas de auth (registro/login/reenvio) por IP, contra força bruta.
- O socket é autenticado por token no handshake; **a identidade vem do login (servidor), nunca mais do cliente**.

## Limites conhecidos (sinceros)
- **Token de sessão fica no `localStorage`.** É prático para esta SPA e o risco de XSS está bastante reduzido pela CSP estrita e pelo escape de saída — mas um cookie `httpOnly` seria ainda mais resistente a XSS. Evolução possível.
- **Persistência em arquivo JSON.** Adequado para uso pessoal/pequeno. Para produção séria, use um banco de dados real com backups.
- **Sirva sempre atrás de HTTPS** (Railway/Render/Cloudflare já fazem isso). Em HTTP puro, e-mail/senha trafegam sem criptografia.
- Rate limiting é **por processo/memória**. Atrás de múltiplas instâncias, use um limitador compartilhado (ex.: Redis).
- **E-mail real exige SMTP configurado.** Sem `SMTP_HOST`, o app fica em modo dev (link no console) — ótimo para testar, mas não envia e-mail de verdade.

## Configuração recomendada em produção
Variáveis de ambiente:
- `ALLOWED_ORIGINS` — lista separada por vírgula de origens permitidas no WebSocket (CORS).
- `MAX_ROOMS` — teto de mesas simultâneas.
- `MAX_CONN_PER_IP` — teto de conexões por IP.

## Reportar vulnerabilidades
Encontrou algo? Abra uma *issue* (sem detalhes sensíveis publicamente) ou contate o mantenedor diretamente.
