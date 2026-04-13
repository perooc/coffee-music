# API Contract

Base URL: `http://localhost:3001/api`

---

## Health

### `GET /health`
- **Response** `200`
```json
{ "status": "ok", "service": "backend", "timestamp": "ISO string" }
```

---

## Tables

### `GET /tables`
List all tables with counts.
- **Response** `200` — `Table[]`
```json
[
  {
    "id": 1,
    "qr_code": "mesa-1",
    "status": "available",
    "total_consumption": 0,
    "created_at": "ISO",
    "updated_at": "ISO",
    "_count": { "orders": 0, "queue_items": 0, "songs": 0 }
  }
]
```

### `GET /tables/:id`
Get single table with counts (lightweight).
- **Response** `200` — `Table`
- **Error** `404` — Table not found

### `GET /tables/:id/detail`
Get table with full relations (songs, queue_items with songs, orders with items and products).
- **Response** `200` — `TableDetail`
- **Error** `404` — Table not found

---

## Products

### `GET /products`
List all products ordered by category, then name.
- **Response** `200` — `Product[]`
```json
[
  { "id": 1, "name": "Espresso", "price": 6000, "stock": 50, "category": "coffee" }
]
```

---

## Queue

### `GET /queue/global`
Get all queue items ordered by position.
- **Response** `200` — `QueueItem[]` (includes `song` and `table`)

### `GET /queue?table_id=:id`
Get queue items for a specific table.
- **Params** `table_id` (required, int)
- **Response** `200` — `QueueItem[]`

### `GET /queue/current`
Get currently playing item.
- **Response** `200` — `QueueItem | null`

### `POST /queue`
Add song to queue.
- **Body**
```json
{
  "youtube_id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "duration": 213,
  "table_id": 1
}
```
- **Response** `201` — `QueueItem`
- **Errors**
  - `404` — Table not found
  - `400` — Table not active
  - `400` — Duration exceeds 600 seconds
  - `400` — Table has 2 songs in queue already
  - `400` — Duplicate pending song for this table

### `POST /queue/play-next`
Advance to next song (marks current as played, next pending as playing).
- **Response** `200` — `QueueItem | null`

### `PATCH /queue/:id/skip`
Skip a queue item.
- **Response** `200` — `QueueItem`
- **Error** `404` — Queue item not found

---

## Orders

### `GET /orders`
List all orders. Optionally filter by table.
- **Query** `table_id` (optional, int)
- **Response** `200` — `Order[]` (includes `order_items` with `product`)

### `POST /orders`
Create a new order.
- **Body**
```json
{
  "table_id": 1,
  "items": [
    { "product_id": 1, "quantity": 2 },
    { "product_id": 3, "quantity": 1 }
  ]
}
```
- **Response** `201` — `Order`
- **Errors**
  - `404` — Table not found
  - `404` — Product not found
  - `400` — Insufficient stock
  - `400` — Quantity must be 1-50

### `PATCH /orders/:id/status`
Update order status.
- **Body**
```json
{ "status": "preparing" }
```
- **Valid statuses**: `pending`, `preparing`, `ready`, `delivered`, `cancelled`
- **Response** `200` — `Order`
- **Side effects**:
  - Cancellation restores stock and subtracts from table consumption

---

## Music

### `GET /music/search?q=:query`
Search YouTube for songs.
- **Query** `q` (required, min 2 chars)
- **Response** `200` — `YouTubeSearchResult[]`
```json
[
  {
    "youtubeId": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "duration": 213,
    "thumbnail": "https://..."
  }
]
```
- **Errors**
  - `400` — Query required / too short
