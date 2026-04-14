import type { Order, QueueItem, Table } from "../types";
import type { PlaybackState } from "../types";

export interface SongRequestPayload {
  youtube_id: string;
  title: string;
  duration: number;
  table_id: number;
}

export type SocketEvents = {
  "queue:updated": QueueItem[];
  "table:updated": Table;
  "order:updated": Order;
  "playback:updated": PlaybackState;
  "song:request": SongRequestPayload;
  "table:join": number;
};
