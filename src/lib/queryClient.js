import { QueryClient, onlineManager, focusManager } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24, // 24h
      staleTime: 1000 * 60 * 5, // 5 min
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 2,
    },
    mutations: { retry: 1 },
  },
});

// Wire online/offline + focus
if (typeof window !== "undefined") {
  window.addEventListener("online", () => onlineManager.setOnline(true));
  window.addEventListener("offline", () => onlineManager.setOnline(false));
  onlineManager.setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

  focusManager.setEventListener((handleFocus) => {
    const onVis = () => { if (!document.hidden) handleFocus(); };
    const onFocus = () => handleFocus();
    window.addEventListener("visibilitychange", onVis, false);
    window.addEventListener("focus", onFocus, false);
    return () => {
      window.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  });
}
