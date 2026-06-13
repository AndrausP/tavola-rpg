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

## Limites conhecidos (sinceros)
- **Não há autenticação real.** A identidade é um `id` local (no navegador). Dentro de uma mesa, isso é suficiente porque os `id`s de outros jogadores não são expostos, mas **não confie nisso para dados sensíveis**. Para um cenário sério, integre login (OAuth/JWT) e sessões.
- **Persistência em arquivo JSON.** Adequado para uso pessoal/pequeno. Para produção, use um banco de dados real com backups.
- **Sirva sempre atrás de HTTPS** (Railway/Render/Cloudflare já fazem isso). Em HTTP puro, dados trafegam sem criptografia.
- Rate limiting é **por processo/memória**. Atrás de múltiplas instâncias, use um limitador compartilhado (ex.: Redis).

## Configuração recomendada em produção
Variáveis de ambiente:
- `ALLOWED_ORIGINS` — lista separada por vírgula de origens permitidas no WebSocket (CORS).
- `MAX_ROOMS` — teto de mesas simultâneas.
- `MAX_CONN_PER_IP` — teto de conexões por IP.

## Reportar vulnerabilidades
Encontrou algo? Abra uma *issue* (sem detalhes sensíveis publicamente) ou contate o mantenedor diretamente.
