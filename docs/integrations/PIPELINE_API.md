# PIPELINE API — Contrato editorial externo

Este documento descreve o contrato para um pipeline editorial externo (ex.: Python/MN26/MNScr)
publicar no Kal El via REST. O pipeline não conhece Drizzle, PostgreSQL, Next.js, TipTap nem
IDs internos desnecessários — apenas HTTP + JSON.

## Autenticação

- Service token escopado por site: header `Authorization: Bearer ke_st.<token>`.
- O token tem escopos (ex.: `articles.create`, `articles.read`, `articles.publish`,
  `articles.schedule`, `media.manage`, taxonomias).
- Base URL: `http://<api>/v1`.

## Idempotência e retry

- Toda escrita envia `Idempotency-Key` (string curta e determinística). Reenvio com a mesma
  chave + mesmo corpo NÃO cria duplicatas.
- `externalKey` (único por site) identifica o artigo no sistema de origem. Re-import com o
  mesmo `externalKey` devolve o artigo existente (`created: false` no create) sem duplicar.
- Retry seguro: reenvie a mesma requisição com a mesma `Idempotency-Key`.

## Fluxo típico (texto + mídia)

```text
resolve categoria  →  upload mídia  →  create article (draft)  →  submit  →  publish (ou schedule)
```

## Exemplos (Python, requests)

```python
import requests, hashlib, json

BASE = "http://localhost:3001/v1"
SITE = "<site-id>"
TOKEN = "ke_st.<token>"
H = {"Authorization": f"Bearer {TOKEN}"}

def idem(method, path, body):
    tag = f"{method}\n{path}\n{json.dumps(body, sort_keys=True)}"
    return "sdk." + hashlib.sha256(tag.encode()).hexdigest()[:24]

# 1. resolver categoria (cria se não existir)
cats = requests.get(f"{BASE}/sites/{SITE}/categories", headers=H).json()["data"]
slug_to_id = {c["slug"]: c["id"] for c in cats}
if "cinema" not in slug_to_id:
    body = {"name": "Cinema", "slug": "cinema"}
    r = requests.post(f"{BASE}/sites/{SITE}/categories", headers={**H, "Idempotency-Key": idem("POST", f"/sites/{SITE}/categories", body)}, json=body)
    slug_to_id["cinema"] = r.json()["data"]["id"]

# 2. upload de mídia (multipart)
with open("capa.jpg", "rb") as f:
    r = requests.post(f"{BASE}/sites/{SITE}/media", headers=H, files={"file": ("capa.jpg", f, "image/jpeg")})
media_id = r.json()["data"]["id"]

# 3. criar artigo (draft)
doc = {
  "version": 2,
  "nodes": [
    {"type": "paragraph", "content": [
      {"type": "text", "text": "texto com ", "marks": []},
      {"type": "text", "text": "negrito", "marks": [{"type": "bold"}]},
    ]},
    {"type": "image", "attrs": {"mediaId": media_id, "altText": "capa"}},
  ],
}
body = {
  "title": "Título da matéria",
  "slug": "titulo-da-materia",
  "document": doc,
  "categories": [slug_to_id["cinema"]],
  "externalKey": "mn26:12345",
  "featuredMediaId": media_id,
  "provenance": {"system": "mn26", "sources": [{"provider": "mn26", "externalId": "12345"}]},
}
r = requests.post(f"{BASE}/sites/{SITE}/articles", headers={**H, "Idempotency-Key": idem("POST", f"/sites/{SITE}/articles", body)}, json=body)
article = r.json()["data"]

# 4. publicar
r = requests.post(f"{BASE}/sites/{SITE}/articles/{article['id']}/publish", headers=H, json={})
```

## Endpoints relevantes

| operação | método/path |
|---|---|
| criar artigo | `POST /sites/:site/articles` |
| atualizar artigo | `PATCH /sites/:site/articles/:id` (com `If-Match: <version>`) |
| buscar artigo | `GET /sites/:site/articles/:id` |
| submeter | `POST /sites/:site/articles/:id/submit` |
| aprovar | `POST /sites/:site/articles/:id/approve` |
| rejeitar | `POST /sites/:site/articles/:id/reject` |
| agendar | `POST /sites/:site/articles/:id/schedule` |
| publicar | `POST /sites/:site/articles/:id/publish` |
| despublicar | `POST /sites/:site/articles/:id/unpublish` |
| upload mídia | `POST /sites/:site/media` (multipart, campo `file`) |
| listar mídia | `GET /sites/:site/media` |
| categorias/tags/entidades/autores/fontes | `GET/POST /sites/:site/<type>` |

> O Kal El cuida do editorial (conteúdo, SEO editorial, workflow, mídia). SEO técnico
> (sitemap, JSON-LD, robots.txt, renderização) é responsabilidade do frontend consumidor.
