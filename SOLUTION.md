# SOLUTION.md — Stage 4B: System Optimization & Data Ingestion

## Overview

This document covers the three optimization areas implemented in Stage 4B:
query performance, query normalization, and CSV data ingestion.

---

## 1. Query Performance

### What was the problem

Without optimization, every query performed a full sequential scan of the
profiles table. At millions of rows, a query like
`WHERE gender = 'male' AND country_id = 'NG'` could take several seconds
because PostgreSQL had to read every row to check the condition.

Additionally, every API request opened a new TCP connection to the remote
Neon PostgreSQL database, adding connection overhead to each query.

### What I did

**Database indexes:** Added B-tree indexes on the columns users filter and
sort by most: `gender`, `country_id`, `age_group`, `age`, `created_at`,
and a composite index on `(gender, country_id)` for the most common
combined filter pattern.

Indexes allow PostgreSQL to skip directly to matching rows instead of
scanning the entire table. The composite index on `(gender, country_id)`
specifically handles the very common "males from Nigeria" type query with
a single index lookup.

**Redis caching (Upstash):** Implemented a `CacheService` that wraps all
`findAll()` and `search()` calls. Before querying the database, we check
Redis for a cached result. On a hit, the result is returned in ~10–30ms
with no DB call. On a miss, we query the DB and store the result for 90
seconds.

**Connection pooling:** Switched to Neon's built-in PgBouncer pooled
connection string. This eliminates the overhead of opening a new TCP
connection per request and prevents connection exhaustion under load.

### Before / After (estimated on 1M+ row dataset)

| Query type                        | Before  | After (cache miss) | After (cache hit) |
|-----------------------------------|---------|--------------------|------------------ |
| Filter by gender + country        | ~2–4s   | ~150–300ms         | ~10–30ms          |
| Filter by age group               | ~1–3s   | ~100–250ms         | ~10–30ms          |
| Paginated list (no filters)       | ~800ms  | ~80–150ms          | ~10–30ms          |
| Natural language search           | ~1–2s   | ~120–200ms         | ~10–30ms          |

Measurements are estimates based on typical PostgreSQL index scan behavior
vs full sequential scan at scale. Actual results depend on Neon instance
size and network latency.

### Trade-offs

- Cache results are up to 90 seconds stale. Acceptable for demographic
  data that changes via batch ingestion, not real-time updates.
- Indexes slightly slow down writes (CREATE, ingest). At our write volume
  (batch/periodic), this cost is negligible.
- Cache invalidation on `POST /api/profiles` and CSV ingestion wipes all
  `profiles:*` and `search:*` cache keys. This is a broad invalidation.
  A more targeted approach would track which filter combinations a new
  profile affects, but that complexity is not warranted at this scale.

---

## 2. Query Normalization

### What was the problem

Without normalization, semantically identical queries produced different
cache keys and missed the cache:

- `?gender=Male&country_id=ng` → key: `profiles:gender=Male:country_id=ng:...`
- `?country_id=NG&gender=male` → key: `profiles:country_id=NG:gender=male:...`

These are the same query but would produce two separate DB calls and two
separate cache entries.

### What I did

Before building a cache key, we run every filter object through a
`normalize()` function in `CacheService`:

1. **Remove empty fields** — null, undefined, and empty strings are
   stripped (they don't affect query results)
2. **Lowercase string values** — `"Male"`, `"male"`, `"MALE"` all become
   `"male"`
3. **Sort keys alphabetically** — `{ gender, country_id }` and
   `{ country_id, gender }` both become `{ country_id, gender }` after
   sorting

The normalized object is then serialized into a colon-separated key:
`profiles:country_id=ng:gender=male:limit=10:page=1`

This is deterministic. The same intent always produces the same key,
regardless of how the query was expressed.

### Constraints respected

- No AI or LLMs: pure deterministic string manipulation
- No incorrect reinterpretations: normalization only affects presentation
  (casing, ordering), never semantic meaning
- Negligible performance cost: normalization takes microseconds

---

## 3. CSV Data Ingestion

### What was the problem

Inserting up to 500,000 rows required a strategy that:

- Does not load the entire file into memory
- Does not insert row by row (500,000 SQL statements)
- Does not block concurrent read queries
- Handles bad rows gracefully without failing the entire upload

### What I did

**Streaming:** The uploaded file is received as a Buffer (via Multer) and
converted to a Node.js Readable stream, then piped through `csv-parser`.
This processes the file one row at a time in constant memory, regardless
of file size.

**Chunked batch inserts:** Valid rows are accumulated in a chunk array.
When the chunk reaches 1,000 rows, it pause the stream, batch-insert the
chunk using `prisma.profile.createMany()`, then resume the stream.

Why 1,000: small enough that event loop pauses are short (reads are not
blocked), large enough that we only need ~500 DB round-trips for a
500,000-row file instead of 500,000.

**Row validation:** Each row is validated before being added to a chunk:

- Required field: `name` (non-empty)
- `age`: must be a non-negative number ≤ 150
- `gender`: must be `male` or `female` if present
- `age_group`: must be a known group if present

A single bad row increments a reason counter and is skipped. The stream
continues. One bad row never stops the upload.

**Duplicate handling:** `createMany({ skipDuplicates: true })` handles
name uniqueness at the DB level. We calculate duplicates by comparing
rows-sent vs rows-inserted per chunk.

**Partial failure:** We do not use a transaction across the entire file.
If the server crashes mid-upload, rows already inserted remain. This is
the explicitly required behavior per the task spec.

### How ingestion avoids blocking reads

Node.js is single-threaded but asynchronous. When we `await flushChunk()`,
the event loop is free to handle incoming read requests while the DB
insert is in-flight. The `stream.pause()` / `stream.resume()` pattern
ensures we don't accumulate unlimited rows in memory between flushes.

Read queries are never queued behind ingestion — they run concurrently on
separate DB connections from the connection pool.

### Edge cases handled

| Case | Handling |
| --- | --- |
| Missing `name` | Skipped, counted as `missing_fields` |
| Negative or non-numeric age | Skipped, counted as `invalid_age` |
| Unknown gender value | Skipped, counted as `invalid_gender` |
| Name already exists in DB | Skipped by `skipDuplicates`, counted as `duplicate_name` |
| Malformed row (wrong columns) | Caught in try/catch, counted as `malformed_row` |
| Empty file | Returns `{ total_rows: 0, inserted: 0, skipped: 0 }` |
| Server crash mid-upload | Already-inserted rows remain (no rollback) |
