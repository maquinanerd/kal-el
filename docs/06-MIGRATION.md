# Migration Strategy

WordPress -> Kal El: migrate data, not WP database structure. Snapshot source, normalize users/taxonomies/media/articles/slugs/dates/redirects/SEO, deterministically transform classic/Gutenberg bodies, validate, import idempotently, reconcile counts/hashes/key fields, preview/crawl staging, preserve canonical URLs or explicit redirects, then cut over only after verification.

Payload -> Kal El: another import adapter, never a runtime dependency after migration.

Existing Next frontends should gain a content-provider boundary so current Payload and future Kal El providers can be swapped without rewriting domain pages.
