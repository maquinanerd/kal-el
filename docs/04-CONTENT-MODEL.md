# Content Model

A Site represents a portal/publication and owns content visibility boundaries.

Article conceptual fields: UUID, site_id, type, status, title, subtitle/dek, slug, excerpt, versioned editor document, featured media, authors, created/updated/published/scheduled timestamps, workflow/version number, provenance, external automation identifiers, SEO metadata, taxonomies and entity relationships.

Categories are hierarchical. Tags are non-hierarchical. Entities represent real subjects/concepts.

Example: Category `Filmes`; Entity `Gladiador`; external entity reference includes provider/type/external ID. External IDs must come from source systems and are never guessed.

Rich domain data can remain in specialized external databases/services.
