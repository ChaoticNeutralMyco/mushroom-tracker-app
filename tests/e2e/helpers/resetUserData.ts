// tests/e2e/helpers/resetUserData.ts
import { Page, expect } from "@playwright/test";
import {
  captureNodeAuthSession,
  deleteE2eUserData,
  E2E_USER_COLLECTIONS,
  listFirestoreDocuments,
} from "./firestore";

const RESET_CRITICAL_COLLECTIONS = [
  "grows",
  "tasks",
  "supplies",
  "recipes",
  "strains",
  "library",
  "settings",
  "notes",
  "materialLots",
  "processBatches",
  "inventoryMovements",
  "storageLocations",
  "storage_locations",
  "extractionBatches",
  "extractLots",
  "productionBatches",
  "finishedProducts",
  "outboundLogs",
  "activityLog",
  "calendarEvents",
  "environmentLogs",
  "photos",
  "trash",
];

async function countCollectionDocs(session: Awaited<ReturnType<typeof captureNodeAuthSession>>, collectionId: string) {
  const docs = await listFirestoreDocuments(session, `users/${session.userId}/${collectionId}`);
  return docs.length;
}

async function countCollections(session: Awaited<ReturnType<typeof captureNodeAuthSession>>, collectionIds: string[]) {
  const entries = await Promise.all(
    collectionIds.map(async (collectionId) => [collectionId, await countCollectionDocs(session, collectionId)] as const)
  );

  return {
    total: entries.reduce((sum, [, count]) => sum + count, 0),
    byCollection: Object.fromEntries(entries.filter(([, count]) => count > 0)),
  };
}

export async function resetUserDataViaSettings(page: Page) {
  const session = await captureNodeAuthSession(page);

  // Best-effort full cleanup. Some older audit collections can accumulate hundreds of legacy rows;
  // those should not block the manual label sandbox if the actual app-state collections are clean.
  await deleteE2eUserData(session);

  await expect
    .poll(
      async () => {
        const counts = await countCollections(session, RESET_CRITICAL_COLLECTIONS);
        return counts.total;
      },
      {
        timeout: 90_000,
        intervals: [500, 750, 1000, 1500, 2500, 5000],
      }
    )
    .toBe(0);

  const leftover = await countCollections(session, E2E_USER_COLLECTIONS);
  if (leftover.total > 0) {
    console.log(
      "[resetUserData] non-critical leftover rows after reset",
      JSON.stringify(leftover.byCollection, null, 2)
    );
  }
}

export const resetUserDataDirect = resetUserDataViaSettings;
