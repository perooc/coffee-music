import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { Table, QueueItem, Order, Product, PlaybackState } from "@coffee-bar/shared";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AppStore {
  // Tables
  currentTable: Table | null;
  allTables: Table[];
  setCurrentTable: (table: Table) => void;
  updateTable: (table: Table) => void;
  setAllTables: (tables: Table[]) => void;

  // Queue
  queue: QueueItem[];
  currentPlayback: PlaybackState | null;
  setQueue: (queue: QueueItem[]) => void;
  updateFromSocket: (queue: QueueItem[]) => void;
  setCurrentPlayback: (playback: PlaybackState | null) => void;

  // Orders
  orders: Order[];
  setOrders: (orders: Order[]) => void;
  upsertOrder: (order: Order) => void;

  // Products
  products: Product[];
  setProducts: (products: Product[]) => void;

  // UI
  isSearchOpen: boolean;
  activeTab: "cola" | "pedidos";
  setSearchOpen: (open: boolean) => void;
  setActiveTab: (tab: "cola" | "pedidos") => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────
export const useAppStore = create<AppStore>()(
  devtools(
    (set) => ({
      // Tables
      currentTable: null,
      allTables: [],
      setCurrentTable: (table) =>
        set({ currentTable: table }, false, "setCurrentTable"),
      updateTable: (table) =>
        set(
          (state) => ({
            currentTable:
              state.currentTable?.id === table.id ? table : state.currentTable,
            allTables: state.allTables.map((t) =>
              t.id === table.id ? table : t,
            ),
          }),
          false,
          "updateTable",
        ),
      setAllTables: (tables) =>
        set({ allTables: tables }, false, "setAllTables"),

      // Queue
      queue: [],
      currentPlayback: null,
      setQueue: (queue) => set({ queue }, false, "setQueue"),
      updateFromSocket: (queue) =>
        set({ queue }, false, "socket:queueUpdated"),
      setCurrentPlayback: (playback) =>
        set({ currentPlayback: playback }, false, "setCurrentPlayback"),

      // Orders
      orders: [],
      setOrders: (orders) => set({ orders }, false, "setOrders"),
      upsertOrder: (order) =>
        set(
          (state) => {
            const exists = state.orders.find((o) => o.id === order.id);
            return {
              orders: exists
                ? state.orders.map((o) => (o.id === order.id ? order : o))
                : [order, ...state.orders],
            };
          },
          false,
          "upsertOrder",
        ),

      // Products
      products: [],
      setProducts: (products) => set({ products }, false, "setProducts"),

      // UI
      isSearchOpen: false,
      activeTab: "cola",
      setSearchOpen: (open) =>
        set({ isSearchOpen: open }, false, "setSearchOpen"),
      setActiveTab: (tab) => set({ activeTab: tab }, false, "setActiveTab"),
    }),
    { name: "CoffeeBarStore" },
  ),
);

// ─── Selectores ───────────────────────────────────────────────────────────────
export const selectCurrentPlayback = (s: AppStore) => s.currentPlayback;
export const selectPendingQueue = (s: AppStore) =>
  s.queue.filter((q) => q.status === "pending");
export const selectMyQueueCount = (tableId: number) => (s: AppStore) =>
  s.queue.filter(
    (q) =>
      q.table_id === tableId &&
      (q.status === "pending" || q.status === "playing"),
  ).length;
export const selectTableOrders = (tableId: number) => (s: AppStore) =>
  s.orders.filter((o) => o.table_id === tableId);
