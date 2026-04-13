import axios from "axios";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api",
  timeout: 10_000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── Request interceptor ──────────────────────────────────────────────────────
api.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const tableId = sessionStorage.getItem("table_id");
      if (tableId) {
        config.headers["x-table-id"] = tableId;
      } else {
        console.warn("[API] No table_id found en sessionStorage");
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ─── Response interceptor ─────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 404) {
      console.warn("[API] 404 →", error.config?.url);
    }
    if (error.response?.status >= 500) {
      console.error("[API] Server error →", error.response?.data);
    }
    return Promise.reject(error);
  },
);

export default api;
