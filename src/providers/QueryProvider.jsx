import React, { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { queryClient } from "../lib/queryClient";
import { idbPersister } from "../lib/persist-idb";

/**
 * Wrap your app at the top level:
 *   import QueryProvider from "./providers/QueryProvider";
 *   root.render(<QueryProvider><App/></QueryProvider>);
 */
export default function QueryProvider({ children }) {
  useEffect(() => {
    persistQueryClient({
      queryClient,
      persister: idbPersister,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => q.state.status === "success",
      },
    });
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
