# Pipeline API — contrato de integração

Contrato para pipelines externos (MN26, MNScr, automações) que escrevem no Kal El pela
API REST. Nunca acessar PostgreSQL diretamente.

> Este documento foi reconciliado mecanicamente contra a implementação: rotas
> (`apps/api/src/routes/`), schemas (`packages/contracts/src/`), OpenAPI
> (`packages/contracts/src/openapi.ts`) e SDK (`packages/sdk/src/client.ts`).
> Onde houver divergência, o código é a verdade — abra um bug.

---

## 1. Autenticação

Duas credenciais, e a diferença importa:

| credencial | header | uso | CSRF |
|---|---|---|---|
| Service token | `Authorization: Bearer ke_st.<token>` | pipelines e automações | não se aplica |
| Sessão | cookie `ke_session` | o CMS no navegador | **obrigatório** `x-kal-el-csrf` em todo método não-GET |

Um service token é **preso a um site**. Ele não alcança outro site, nem pelas rotas
`/v1/sites/:siteId/*` nem pelas `/v1/admin/*`.

Tokens são criados em `POST /v1/admin/sites/{siteId}/service-tokens` (requer
`tokens.manage` **naquele site**). O valor em texto claro é devolvido **uma única vez**.

**Base URL:** `http://<api>` — as rotas abaixo já incluem o prefixo `/v1`.

---

## 2. Escopos

O escopo exigido é o do `guard(...)` na rota. A lista abaixo é exaustiva para as
operações documentadas.

| operação | escopo |
|---|---|
| criar artigo | `articles.create` |
| criar já como `published` ou com `publishedAt` | **+** `articles.publish` |
| criar já como `scheduled` ou com `scheduledAt` | **+** `articles.schedule` |
| ler bytes brutos / substituir documento ilegível | `articles.recover` |
| ler estado operacional (`/ops-status`) | `audit.read` |
| ler / listar artigos, revisões, preview, stats | `articles.read` |
| atualizar artigo | `articles.update` |
| submeter | `articles.submit` |
| aprovar **e rejeitar** | `articles.approve` |
| agendar | `articles.schedule` |
| publicar, despublicar, arquivar | `articles.publish` |
| enviar / editar / apagar mídia | `media.manage` |
| **listar / ler mídia** | `media.read` |
| categorias (ler e escrever) | `taxonomy.categories.manage` |
| tags | `taxonomy.tags.manage` |
| entidades | `taxonomy.entities.manage` |
| autores | `taxonomy.authors.manage` |
| fontes | `taxonomy.sources.manage` |
| redirects (ler e escrever) | `seo.manage` |
| audit log | `audit.read` |

Duas armadilhas reais:

- **Ler taxonomia exige o escopo `*.manage`.** Não existe `taxonomy.*.read`. Um pipeline
  que só resolve categorias precisa, hoje, do escopo de escrita.
- **`articles.reject` não existe.** Rejeitar usa `articles.approve`.

Um token de importação/sincronização típico precisa de:

```
articles.create  articles.read  articles.update  articles.publish  articles.schedule
media.manage  media.read
taxonomy.categories.manage  taxonomy.tags.manage  taxonomy.authors.manage
seo.manage
```

`articles.update` é o que diferencia um importador que **sincroniza** de um que só insere.

---

## 3. Identidade e retry

### `externalKey`

Identifica o artigo no sistema de origem. Único por site (índice único
`articles_site_external_key_unique`), então duas criações com a mesma chave **não** podem
gerar dois artigos.

- **Aceito apenas na criação.** `PATCH` rejeita `externalKey` com 400 — o schema é
  `.strict()` e o campo é imutável depois de criado.
- Criar com um `externalKey` já existente devolve o artigo existente com **HTTP 200**;
  uma criação nova devolve **201**.

> **Não existe campo `created` no corpo da resposta.** O envelope é sempre `{"data": {...}}`.
> Created-versus-existing é sinalizado **só pelo status HTTP**. O SDK hoje descarta o
> status (`request()` devolve `json.data`), então quem precisa dessa distinção deve usar
> HTTP direto.

Para mídia, o equivalente é o query param `?externalKey=` em `POST /media` — sem ele, cada
reenvio do mesmo arquivo grava uma cópia nova.

O valor é opaco para a API: qualquer string única por site serve. Os importadores do
próprio Kal El usam `{prefixo}:{tipo}:{id-de-origem}` (ex.: `imp:article:wp:post:42`,
`imp:media:wp:media:7`) — o tipo entra na chave porque o modelo neutro nunca exigiu que os
ids de origem fossem prefixados, e sem ele artigo 123 e mídia 123 produziam a mesma string.
Um pipeline próprio pode usar o formato que quiser; só precisa ser estável entre execuções.

### `Idempotency-Key`

Opcional. Quando enviada, a mesma chave + mesmo corpo replica a resposta armazenada sem
reexecutar efeitos. Chave com corpo diferente → **409 `IDEMPOTENCY_REPLAY`**.

Formato: 8–128 caracteres, `[A-Za-z0-9._-]`.

Escopo da chave: **ator + site**. A mesma chave em dois sites são duas escritas
independentes. TTL de 24h; passado isso a chave volta a executar.

**Rotas que honram a chave:**

```
POST /articles                POST /articles/:id/publish     POST /articles/:id/schedule
POST /articles/:id/submit     POST /articles/:id/approve     POST /articles/:id/reject
POST /articles/:id/unpublish  POST /articles/:id/archive
POST /categories  POST /tags  POST /entities  POST /authors  POST /sources
POST /media
```

**Rotas que NÃO honram a chave** — enviá-la ali é ignorado silenciosamente:
`PATCH /articles/:id`, todos os `PATCH`/`DELETE` de taxonomia, `POST`/`DELETE /redirects`,
`PATCH`/`DELETE /media/:id`, e todas as rotas `/v1/admin/*`.

Para `PATCH /articles/:id` o mecanismo de segurança é o `If-Match`, não a chave.

### Retry de transições de workflow

Quatro transições têm **estado-alvo inequívoco** e são no-op ao serem reaplicadas:
`submit`, `reject`, `publish` e `archive`. Reenviar devolve **200** com o artigo atual,
então um retry após resposta perdida é seguro mesmo sem `Idempotency-Key`.

`approve` e `unpublish` **não** são: ambas visam `draft`, então o servidor não consegue
distinguir um retry de uma chamada que nunca foi legal. Tratar igualdade de estado como
retry transformava um `approve` num artigo nunca submetido em 200 silencioso, sem
entrada de auditoria — o portão editorial virando no-op enquanto o chamador recebia
sucesso. Para essas duas, **envie `Idempotency-Key`**: é o que torna o retry seguro.

Transição genuinamente ilegal → **409 `INVALID_TRANSITION`** com `details.from` e
`details.to`.

**Concorrência.** As transições são `UPDATE` guardados por versão: se o artigo mudar entre
a leitura e a escrita, a transição não é aplicada e a resposta é **409 `VERSION_CONFLICT`**
com `details.expectedVersion` (a versão contra a qual a transição foi emitida),
`details.currentVersion` e `details.currentStatus`. Isso é uma corrida perdida, não um
retry: releia o artigo e decida se a ação ainda faz sentido. O no-op de reaplicação
descrito acima continua valendo — ele acontece antes do `UPDATE` e não chega a disputar
versão.

### `If-Match`

**Opcional.** Sem ele o update é last-write-wins. Com ele, versão divergente →
**409 `VERSION_CONFLICT`** com `details.currentVersion` e `details.expectedVersion`.

O valor é um **inteiro puro** (`4`), não um ETag entre aspas (`"4"` → 400).

---

## 4. Máquina de estados

```
draft      → in_review, scheduled, published, archived
in_review  → draft, blocked, scheduled, published, archived
scheduled  → published, scheduled, draft, archived
published  → draft
blocked    → in_review, draft, archived
archived   → (nenhuma)
```

Dois pontos que surpreendem:

- **`scheduled` exige `scheduledAt`, e a data importa.** Criar um artigo `scheduled` sem
  `scheduledAt` devolve **400**: a consulta do worker é `status = 'scheduled' AND
  scheduled_at <= now()`, e `<=` contra NULL é NULL, então o artigo ficaria invisível para
  o worker para sempre. E uma data **no passado** faz o worker publicar no tick seguinte —
  os importadores mapeiam esse caso para `blocked` em vez de publicar; um pipeline que
  envia `scheduled` com data passada está pedindo publicação imediata e vai recebê-la.
- **`submit` não é obrigatório antes de publicar.** `draft → published` é legal.
- **`approve` leva o artigo para `draft`**, não para um estado "aprovado", e limpa
  `publishedAt`/`scheduledAt`. Não existe status `approved`. O sinal durável da aprovação
  é a entrada `articles.approve` no audit log.
- **`approve` só é legal a partir de `in_review` ou `blocked`.** Fora disso devolve **409
  `INVALID_TRANSITION`** com `details.expected`. A restrição existe porque `approve` e
  `unpublish` visam o mesmo `draft` e `published → draft` é transição legal — sem ela,
  `/approve` (escopo `articles.approve`) funcionava como despublicação para quem
  deliberadamente não tem `articles.publish`, e o clear de datas destruía o
  `publishedAt` original de forma irrecuperável.

---

## 5. Endpoints

### Artigos — `/v1/sites/{siteId}/articles`

| método | caminho | escopo |
|---|---|---|
| GET | `/v1/sites/{siteId}/articles` | `articles.read` |
| POST | `/v1/sites/{siteId}/articles` | `articles.create` |
| GET | `/v1/sites/{siteId}/articles/{id}` | `articles.read` |
| PATCH | `/v1/sites/{siteId}/articles/{id}` | `articles.update` |
| GET | `/v1/sites/{siteId}/articles/{id}/revisions` | `articles.read` |
| POST | `/v1/sites/{siteId}/articles/{id}/preview` | `articles.read` |
| POST | `/v1/sites/{siteId}/articles/{id}/submit` | `articles.submit` |
| POST | `/v1/sites/{siteId}/articles/{id}/approve` | `articles.approve` |
| POST | `/v1/sites/{siteId}/articles/{id}/reject` | `articles.approve` |
| POST | `/v1/sites/{siteId}/articles/{id}/schedule` | `articles.schedule` |
| POST | `/v1/sites/{siteId}/articles/{id}/publish` | `articles.publish` |
| POST | `/v1/sites/{siteId}/articles/{id}/unpublish` | `articles.publish` |
| POST | `/v1/sites/{siteId}/articles/{id}/archive` | `articles.publish` |

`GET /articles` aceita `?limit=`, `?cursor=`, `?status=`, `?externalKey=` e devolve
`{"data": {"items": [...], "nextCursor": string|null, "total": number}}`.

### Mídia

| método | caminho | escopo |
|---|---|---|
| GET | `/v1/sites/{siteId}/media` | `media.read` |
| POST | `/v1/sites/{siteId}/media` | `media.manage` |
| GET | `/v1/sites/{siteId}/media/{id}` | `media.read` |
| GET | `/v1/sites/{siteId}/media/{id}/file` | `media.read` |
| PATCH | `/v1/sites/{siteId}/media/{id}` | `media.manage` |
| DELETE | `/v1/sites/{siteId}/media/{id}` | `media.manage` |

`POST /media` é `multipart/form-data`, campo `file`, com `?externalKey=` opcional.
`GET /media` pagina por **offset** (`?q=`, `?limit=` default 60 máx 200, `?offset=`) e
devolve `{"data": {"items": [...], "total": number}}` — formato diferente de `/articles`.

O tipo é detectado pelos **bytes**, não pelo `Content-Type` declarado. Formatos aceitos:
JPEG, PNG, WEBP, GIF, AVIF. SVG é recusado. Conteúdo que não bate com o tipo declarado →
400.

Apagar mídia referenciada por um artigo → **409**.

### Taxonomias

Para cada `<type>` em `categories`, `tags`, `entities`, `authors`, `sources`:

| método | caminho |
|---|---|
| GET | `/v1/sites/{siteId}/<type>` |
| POST | `/v1/sites/{siteId}/<type>` |
| PATCH | `/v1/sites/{siteId}/<type>/{id}` |
| DELETE | `/v1/sites/{siteId}/<type>/{id}` |

Relações de artigo (`authors`, `categories`, `tags`, `entities`) **precisam pertencer ao
mesmo site** do artigo. Um id de outro site é recusado com 400, com a mesma mensagem de um
id inexistente — de propósito, para não virar oráculo de existência entre inquilinos.

### SEO

| método | caminho | escopo |
|---|---|---|
| GET / POST | `/v1/sites/{siteId}/redirects` | `seo.manage` |
| DELETE | `/v1/sites/{siteId}/redirects/{id}` | `seo.manage` |

Trocar o slug de um artigo cria o redirect 301 automaticamente.

### Administração — `/v1/admin`

| método | caminho | permissão |
|---|---|---|
| GET / POST | `/v1/admin/sites` | `sites.read` / `sites.create` |
| PATCH | `/v1/admin/sites/{siteId}` | `sites.create` **naquele site** |
| GET / POST | `/v1/admin/users` | `users.read` / `users.create` |
| POST | `/v1/admin/users/{userId}/roles` | `roles.manage` **no site do corpo** |
| GET / POST | `/v1/admin/roles` | `roles.manage` |
| GET / POST | `/v1/admin/sites/{siteId}/service-tokens` | `tokens.manage` **naquele site** |
| POST | `/v1/admin/sites/{siteId}/service-tokens/{id}/revoke` | `tokens.manage` **naquele site** |
| GET / POST | `/v1/admin/sites/{siteId}/webhooks` | `tokens.manage` **naquele site** |
| PATCH | `/v1/admin/sites/{siteId}/webhooks/{id}` | `tokens.manage` **naquele site** |
| DELETE | `/v1/admin/sites/{siteId}/webhooks/{id}` | `tokens.manage` **naquele site** |

Rotas com `:siteId` exigem participação naquele site — a permissão não se propaga entre
sites.

O `secret` de assinatura sai **apenas na resposta de criação**, como um service token. Ele
não aparece em `GET` nem em `PATCH`, e não é atualizável: trocá-lo silenciosamente quebra a
verificação do assinante sem que ele tenha como saber com qual chave uma entrega foi
assinada. `PATCH` aceita `url`, `events`, `description` e `enabled`; um webhook com
`enabled: false` é ignorado pelo dispatcher em vez de ser tentado e falhado, para não
gastar o orçamento de retry enquanto está sendo consertado.

`GET` devolve, por webhook, o resultado da **última entrega** (`lastDelivery`: status,
tentativa, código HTTP, erro, evento e quando) — sem isso um endpoint em dead-letter é
indistinguível de um saudável que ainda não recebeu nada.

### Recuperação de documento — `/v1/sites/{siteId}/articles/{articleId}`

| método | caminho | permissão |
|---|---|---|
| GET | `.../document/raw` | `articles.recover` |
| GET | `.../revisions/{revisionId}/raw` | `articles.recover` |
| POST | `.../document/replace` | `articles.recover` |

Existem porque a coluna `document` é `jsonb` e aceita valores que não são um
`ArticleDocument` válido (um restore antigo, um statement rodado à mão, uma migration
parcial). Todo leitor degrada esse valor para um documento vazio para que a linha continue
alcançável — o que é correto para exibição e significa que os bytes originais não eram
legíveis por nenhuma rota.

`document/raw` devolve exatamente o que está na coluna, o motivo de não parsear, e quais
revisões também estão ilegíveis. `document/replace` preserva os bytes atuais como revisão
**antes** de sobrescrever, grava a substituição, arquiva-a como revisão própria e registra
tudo no audit log — numa transação, honrando `If-Match` e `Idempotency-Key`. Uma
substituição que também não seja um documento válido é recusada com **400**.

Artigos nesse estado trazem `document_unreadable` em `qualityFlags`.

### Operação — `/v1/sites/{siteId}/ops-status`

`audit.read`. Backlog do outbox (pendente/vencido/falho e idade do mais antigo), backlog de
agendados e quantos estão vencidos, saúde dos webhooks, artigos bloqueados e se o worker
está vivo (heartbeat por tick). Todo número vem de uma tabela que o produto de fato
consulta.

### Saúde — sem autenticação, sem rate limit

| caminho | significado |
|---|---|
| `/health`, `/v1/health` | o processo está de pé (**não** toca no banco) |
| `/ready`, `/v1/ready` | o banco está alcançável — use para readiness/load balancer |

---

## 6. Corpo de criação e atualização

`createArticleBodySchema` é `.strict()`: qualquer campo fora desta lista → 400.

**Criação** — obrigatório apenas `title`:

`type` · `title` · `slug` · `dek` · `excerpt` · `document` · `seo` · `authors` ·
`categories` · `tags` · `entities` · `externalKey` · `provenance` · `featuredMediaId` ·
`status` · `publishedAt` · `scheduledAt`

**Atualização** — pelo menos um campo, e os quatro últimos acima **não** são aceitos:

`type` · `title` · `slug` · `dek` · `excerpt` · `document` · `seo` · `authors` ·
`categories` · `tags` · `entities` · `provenance` · `featuredMediaId`

Mudança de status passa pelos endpoints de workflow, nunca por `PATCH`.

---

## 7. Erros

Envelope: `{"error": {"code", "message", "details"?, "requestId"?}}`.

| código | HTTP | quando |
|---|---|---|
| `VALIDATION_ERROR` | 400 | corpo inválido, campo desconhecido, header malformado, tipo de arquivo recusado |
| `UNAUTHENTICATED` | 401 | sem credencial, token inválido ou expirado |
| `FORBIDDEN` | 403 | escopo/permissão ausente, CSRF ausente, ownership |
| `SITE_SCOPE_MISMATCH` | 403 | token ou sessão não alcança este site |
| `NOT_FOUND` | 404 | recurso inexistente neste site |
| `CONFLICT` | 409 | slug duplicado, mídia em uso |
| `VERSION_CONFLICT` | 409 | `If-Match` divergente, ou transição que perdeu a corrida de versão |
| `IDEMPOTENCY_REPLAY` | 409 | mesma chave, corpo diferente |
| `INVALID_TRANSITION` | 409 | transição ilegal |
| `PAYLOAD_TOO_LARGE` | 413 | arquivo acima do limite |
| `INTERNAL_ERROR` | 500 | falha inesperada |

`403` é alcançável com um token que tem `articles.create` sempre que o corpo definir
`status`, `publishedAt` ou `scheduledAt` sem o escopo correspondente.

---

## 8. Exemplo Python

Testado contra o ambiente local. Note o tratamento de erro — sem ele toda falha vira um
`KeyError: 'data'` opaco.

```python
import os, uuid, requests

BASE  = os.environ["KALEL_API"]          # ex.: http://localhost:3001
SITE  = os.environ["KALEL_SITE_ID"]
TOKEN = os.environ["KALEL_TOKEN"]        # ke_st.xxxxx
H     = {"Authorization": f"Bearer {TOKEN}"}

def idem() -> str:
    return "pipe." + uuid.uuid4().hex[:24]

def ok(r: requests.Response) -> dict:
    if not r.ok:
        raise RuntimeError(f"{r.request.method} {r.request.path_url} -> {r.status_code} {r.text}")
    return r.json()["data"]

# 1. resolver categoria (exige taxonomy.categories.manage, inclusive para ler)
cats = ok(requests.get(f"{BASE}/v1/sites/{SITE}/categories", headers=H))
by_slug = {c["slug"]: c["id"] for c in cats}

if "cinema" not in by_slug:
    created = ok(requests.post(
        f"{BASE}/v1/sites/{SITE}/categories",
        headers={**H, "Idempotency-Key": idem()},
        json={"name": "Cinema", "slug": "cinema"},
    ))
    by_slug["cinema"] = created["id"]

# 2. enviar a imagem, com externalKey para que um reenvio reaproveite o arquivo
with open("capa.jpg", "rb") as fh:
    media = ok(requests.post(
        f"{BASE}/v1/sites/{SITE}/media",
        headers={**H, "Idempotency-Key": idem()},
        params={"externalKey": "mn26:media:12345"},
        files={"file": ("capa.jpg", fh, "image/jpeg")},   # os bytes precisam ser JPEG de verdade
    ))

# 3. criar o artigo
document = {
    "version": 2,
    "nodes": [
        {"type": "paragraph", "content": [
            {"type": "text", "text": "Texto de abertura ", "marks": []},
            {"type": "text", "text": "em destaque", "marks": [{"type": "bold"}]},
        ]},
        {"type": "image", "attrs": {"mediaId": media["id"], "altText": "Cartaz do filme"}},
    ],
}

res = requests.post(
    f"{BASE}/v1/sites/{SITE}/articles",
    headers={**H, "Idempotency-Key": idem()},
    json={
        "title": "Gladiador II chega aos cinemas",
        "slug": "gladiador-ii-cinemas",
        "document": document,
        "categories": [by_slug["cinema"]],
        "featuredMediaId": media["id"],
        "externalKey": "mn26:12345",
        "provenance": {"system": "mn26", "sources": [{"provider": "mn26", "externalId": "12345"}]},
    },
)
article = ok(res)

# 201 = criado agora · 200 = já existia com este externalKey. Não há campo "created".
was_created = res.status_code == 201

# 4. publicar (idempotente: reenviar devolve 200 com o mesmo estado)
ok(requests.post(
    f"{BASE}/v1/sites/{SITE}/articles/{article['id']}/publish",
    headers={**H, "Idempotency-Key": idem()},
    json={},
))
```

O token que roda este script precisa de:
`taxonomy.categories.manage`, `media.manage`, `articles.create`, `articles.publish`.

---

## 9. Limites operacionais

- Rate limit global de **600 req/min**, contado **por service token** quando a chamada usa
  `Authorization: Bearer ke_st....`, e por IP para as demais. Isso mudou: antes era sempre
  por IP, então duas integrações atrás do mesmo NAT dividiam um balde e uma esgotava o
  orçamento da outra. Um backfill grande ainda bate no limite — espace as requisições ou
  faça o backfill em lotes.
- `POST /v1/auth/login` tem limite próprio de 10/min e `POST /v1/bootstrap/init` de 5/min.
  São controles de força bruta e não herdam o limite global.
- Atrás de um reverse proxy o servidor precisa de `TRUST_PROXY` configurado para enxergar o
  IP real; sem isso todos os chamadores compartilham o balde do proxy. Ver
  [08-DEPLOYMENT](../08-DEPLOYMENT.md#trust_proxy).
- `MEDIA_MAX_BYTES` limita o upload (413 acima disso).
- O SDK (`@kal-el/sdk`) tenta novamente em erro de rede, 408, 429 e 5xx — duas vezes, com
  backoff de 200ms/400ms.

---

## 10. Divergências conhecidas

Registradas em vez de escondidas:

- **OpenAPI incompleto.** `packages/contracts/src/openapi.ts` descreve 16 das 59 rotas.
  Gerar um cliente a partir dele não cobre workflow, mídia, taxonomia PATCH/DELETE nem
  administração. Use este documento como referência.
- **SDK sem acesso ao status.** `KalElClient.request()` devolve `json.data` e descarta o
  status, então created-versus-existing não é observável pelo SDK.
- **SDK sem cobertura de admin.** Nenhuma rota `/v1/admin/*` tem método no SDK.
- **`articles.delete` existe como permissão e não é usada por nenhuma rota.** Remoção de
  artigo é feita por `archive`.
- **`UNSUPPORTED_MEDIA_TYPE`** está declarado em `API_ERROR_CODES` mas não é emitido; tipo
  de mídia recusado sai como `VALIDATION_ERROR`/400. (`RATE_LIMITED` **é** emitido — o
  handler de erros passou a mapear o 429 do limitador para ele.)
- **Rotas novas fora do OpenAPI.** Recuperação de documento, `/ops-status`, `PATCH` de
  webhook e `/health`/`/ready` estão documentadas aqui e não no OpenAPI, que continua
  cobrindo um subconjunto. Um teste garante que toda rota declarada no OpenAPI existe; o
  inverso não é garantido.
