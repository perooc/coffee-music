# Socket Events

Server: `ws://localhost:3001` (Socket.IO, transport: websocket)

---

## Client → Server

### `table:join`
Join a table room for targeted updates.
- **Payload**: `number` (table ID)
- **Effect**: Client joins room `table:{tableId}`

### `song:request`
Request a song (alternative to REST POST /queue).
- **Payload**:
```json
{
  "youtube_id": "string",
  "title": "string",
  "duration": 213,
  "table_id": 1
}
```

---

## Server → Client

### `queue:updated`
Emitted when the queue changes (song added, skipped, played, next).
- **Payload**: `QueueItem[]` — Full global queue ordered by position
```json
[
  {
    "id": 1,
    "song_id": 1,
    "table_id": 1,
    "priority_score": 0,
    "status": "pending",
    "position": 1,
    "created_at": "ISO",
    "updated_at": "ISO",
    "song": {
      "id": 1,
      "youtube_id": "dQw4w9WgXcQ",
      "title": "Rick Astley - Never Gonna Give You Up",
      "duration": 213,
      "requested_by_table": 1,
      "created_at": "ISO"
    },
    "table": {
      "id": 1,
      "qr_code": "mesa-1",
      "status": "active",
      "total_consumption": 6000,
      "created_at": "ISO",
      "updated_at": "ISO"
    }
  }
]
```
- **Scope**: Broadcast to all connected clients

### `order:updated`
Emitted when an order is created or its status changes.
- **Payload**: `Order` — Single order with `order_items` and nested `product`
```json
{
  "id": 1,
  "table_id": 1,
  "status": "pending",
  "total": 15500,
  "created_at": "ISO",
  "updated_at": "ISO",
  "order_items": [
    {
      "id": 1,
      "order_id": 1,
      "product_id": 1,
      "quantity": 2,
      "unit_price": 6000,
      "created_at": "ISO",
      "product": {
        "id": 1,
        "name": "Espresso",
        "price": 6000,
        "stock": 48,
        "category": "coffee"
      }
    }
  ]
}
```
- **Scope**: Broadcast to all connected clients

### `table:updated`
Emitted when table data changes (consumption update after order).
- **Payload**: `Table` — Single table
```json
{
  "id": 1,
  "qr_code": "mesa-1",
  "status": "active",
  "total_consumption": 15500,
  "created_at": "ISO",
  "updated_at": "ISO"
}
```
- **Scope**: Broadcast to all connected clients

---

## Notes

- All events currently broadcast globally (not room-scoped)
- `table:join` sets up rooms but emissions don't target them yet
- Queue updates always send the full global queue, not deltas
