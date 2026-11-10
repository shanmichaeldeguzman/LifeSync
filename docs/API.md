# LifeSync REST API

Base URL: `https://<api-host>/api` (local: `http://localhost:3000/api`).

## Conventions

- **Auth:** every endpoint except `GET /health` requires `Authorization: Bearer <Supabase access token>`. The API verifies the token and forwards it to Postgres, so Row Level Security restricts every query to the caller's own data.
- **Content type:** JSON (`Content-Type: application/json`), max body 1 MB.
- **IDs:** UUIDs. Clients may supply `id` on create (used by offline sync; replays are idempotent).
- **Timestamps:** ISO 8601 with offset (`2026-11-10T09:00:00.000Z`); dates are `YYYY-MM-DD`.
- **Errors:** consistent envelope

  ```json
  { "error": { "code": "validation_failed", "message": "Please check the highlighted fields.",
               "details": [{ "field": "title", "message": "This field is required" }] } }
  ```

  | Status | `code` | Meaning |
  | --- | --- | --- |
  | 400 | `bad_request`, `bad_json` | Malformed request or invalid reference |
  | 401 | `unauthorized` | Missing / invalid / expired token |
  | 403 | `forbidden`, `invalid_password` | Not allowed |
  | 404 | `not_found` | Record doesn't exist **or belongs to someone else** |
  | 405 | `method_not_allowed` | Operation not supported for this resource |
  | 409 | `conflict` | Duplicate, or record changed since `base_updated_at` (`details.current` holds the server copy) |
  | 413 | `payload_too_large` | Body over 1 MB |
  | 422 | `validation_failed` | Field-level validation errors |
  | 429 | `rate_limited` | Too many requests |
  | 500 | `internal_error` | Unexpected error (details are logged, never returned) |

- **Rate limits:** 1000 requests / 15 min per IP; `DELETE /account` 5 / hour per user.

## Generic resources

All user-owned collections share one contract:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/{resource}` | List with pagination, search, filters and sorting |
| `POST` | `/{resource}` | Create (201), or return the existing record (200) when `id` already exists |
| `GET` | `/{resource}/{id}` | Fetch one |
| `PATCH` | `/{resource}/{id}` | Partial update with optional optimistic concurrency |
| `DELETE` | `/{resource}/{id}` | Delete (204) |
| `GET` | `/{resource}/{id}/file-url` | *(documents, note-attachments)* 60-second signed URL; `?download=true` forces download |

### List query parameters

| Param | Example | Notes |
| --- | --- | --- |
| `page`, `limit` | `page=2&limit=25` | `limit` ≤ 200 (default 50) |
| `search` | `search=milk` | Case-insensitive match on the resource's text columns |
| `sort`, `order` | `sort=due_at&order=asc` | Only whitelisted columns |
| filters | `status=pending,in_progress` · `category_id=none` | Comma = OR; `none` = no category |
| ranges | `due_from=2026-11-01&due_to=2026-11-30` | Prefix per resource (below) |
| `updated_since` | `updated_since=2026-11-10T00:00:00Z` | Incremental fetch |

Response:

```json
{ "data": [ { "id": "…", "title": "…" } ],
  "meta": { "page": 1, "limit": 50, "total": 123, "totalPages": 3 } }
```

### Optimistic concurrency

```http
PATCH /api/tasks/3f0c…
{ "title": "New title", "base_updated_at": "2026-11-10T09:00:00.123456+00:00" }
```

If the record changed after `base_updated_at`, the API returns `409` with `details.current`. Add `?force=true` to overwrite deliberately.

### Resources

| Resource | Writable fields | Filters | Range prefix | Sortable |
| --- | --- | --- | --- | --- |
| `task-categories`, `event-categories`, `note-categories` | `name`, `color`, `icon` | – | – | `name`, `created_at` |
| `transaction-categories` | `name`, `type`, `color`, `icon` | `type` | – | `name` |
| `tasks` | `title`, `description`, `priority` (low/medium/high/urgent), `status` (pending/in_progress/completed), `category_id`, `due_at`, `reminder_at`, `recurrence` (none/daily/weekly/monthly/yearly), `recurrence_interval`, `recurrence_until` | `status`, `priority`, `category_id`, `recurrence` | `due` | `due_at`, `priority`, `created_at`, `title`, `status` |
| `events` | `title`, `description`, `location`, `category_id`, `start_at`, `end_at`, `all_day`, `color`, `reminder_minutes`, `recurrence`, `recurrence_interval`, `recurrence_until` | `category_id`, `all_day` | `start` | `start_at`, `title` |
| `notes` | `title`, `content` (Markdown), `category_id`, `is_pinned`, `is_favorite`, `is_archived` | `category_id`, `is_pinned`, `is_favorite`, `is_archived` | – | `updated_at`, `title` |
| `note-attachments` | create only: `note_id`, `storage_path`, `file_name`, `mime_type`, `size_bytes` | `note_id` | – | `created_at` |
| `habits` | `name`, `description`, `icon`, `color`, `frequency` (daily/weekly/custom), `days_of_week`, `target_per_week`, `reminder_time` (HH:MM), `start_date`, `is_archived` | `frequency`, `is_archived` | – | `name`, `created_at` |
| `habit-logs` | `habit_id`, `log_date`, `note` | `habit_id` | `date` | `log_date` |
| `transactions` | `type` (income/expense), `amount`, `category_id`, `description`, `transaction_date`, `payment_method` | `type`, `category_id`, `payment_method`, `entry_source` | `date` | `transaction_date`, `amount` |
| `recurring-transactions` | `type`, `amount`, `category_id`, `description`, `payment_method`, `frequency`, `interval_count`, `next_run_date`, `end_date`, `is_active` | `type`, `is_active` | – | `next_run_date`, `amount` |
| `budgets` | `month` (YYYY-MM-01), `category_id` (null = overall), `limit_amount` (update: limit only) | `month`, `category_id` | – | `month` |
| `savings-goals` | `name`, `target_amount`, `current_amount`, `target_date`, `color` | – | – | `target_date`, `name` |
| `documents` | create: `title`, `description`, `category`, `storage_path`, `file_name`, `mime_type` (pdf/jpeg/png/webp), `size_bytes` (≤ 10 MB), `expires_at`, `remind_days_before`; update: metadata only | `category`, `mime_type` | `expires` | `created_at`, `title`, `expires_at` |
| `goals` | `title`, `description`, `category`, `target_date`, `status` (active/completed/abandoned), `progress_mode` (manual/milestones), `progress`, `reminder_at` | `status`, `category` | – | `target_date`, `created_at` |
| `goal-milestones` | `goal_id`, `title`, `due_date`, `is_completed`, `position` | `goal_id`, `is_completed` | – | `position`, `due_date` |
| `notifications` | update only: `read_at` | `type` | – | `created_at` |

Server-managed fields (`user_id`, `created_at`, `updated_at`, `completed_at`, `entry_source`, …) are ignored if sent.

**File uploads** go directly from the client to Supabase Storage (`documents`, `attachments` or `avatars` bucket) under `<user_id>/<uuid>-<filename>`. The `POST` then registers the file; the API rejects paths outside the caller's folder, path traversal, unsupported types, oversized files and objects that don't exist.

## Other endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness check (no auth) |
| `GET` | `/sync/pull?since=<ISO>` | Rows changed since the cursor across all modules, plus tombstones, profile and preferences. Loop while `hasMore`. |
| `GET` | `/dashboard/summary?today=YYYY-MM-DD&tz_offset=-480` | Aggregated dashboard snapshot |
| `GET` | `/finance/summary?month=YYYY-MM` | Totals, category breakdown, budget usage, 6-month trend |
| `GET` | `/finance/export.csv?from=&to=&type=` | CSV export (UTF-8 BOM, formula-safe) |
| `POST` | `/finance/recurring/run` | Materialise due recurring transactions → `{ created }` |
| `POST` | `/notifications/refresh` | Generate due reminders → `{ created }` |
| `POST` | `/notifications/read-all` | Mark all notifications read |
| `GET` | `/profile` | Profile, preferences and email |
| `PATCH` | `/profile` | `full_name`, `avatar_path`, `timezone` (IANA), `currency` (ISO 4217) |
| `PATCH` | `/preferences` | Theme, notification toggles, reminder defaults, `hide_amounts`, `dashboard_widgets`, `week_starts_on` |
| `GET` | `/account/export` | Full JSON export of the caller's data |
| `DELETE` | `/account` | Body `{ "password": "…", "confirm": "DELETE" }`. Re-verifies the password, deletes stored files, then the account (cascades to all data) |

### Example: incremental sync

```http
GET /api/sync/pull?since=2026-11-10T08:00:00.000Z
Authorization: Bearer eyJ…
```

```json
{
  "cursor": "2026-11-10T08:59:30.000Z",
  "hasMore": false,
  "serverTime": "2026-11-10T09:00:00.000Z",
  "profile": { "full_name": "Alex Morgan", "currency": "USD", "…": "…" },
  "preferences": { "theme": "system", "…": "…" },
  "changes": { "tasks": [ { "id": "…", "updated_at": "…" } ], "notes": [], "…": [] },
  "deleted": [ { "table": "tasks", "id": "…" } ]
}
```
