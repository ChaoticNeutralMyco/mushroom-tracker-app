// tests/e2e/helpers/resetUserData.ts
import { Page, expect } from "@playwright/test";
import {
  captureNodeAuthSession,
  deleteE2eUserData,
  E2E_USER_COLLECTIONS,
  listFirestoreDocuments,
} from "./firestore";

export async function resetUserDataViaSettings(page: Page) {
  const session = await captureNodeAuthSession(page);
  await deleteE2eUserData(session);

  await expect
    .poll(
      async () => {
        const collectionsToCheck = E2E_USER_COLLECTIONS;

        const counts = await Promise.all(
          collectionsToCheck.map(async (collectionId) => {
            const docs = await listFirestoreDocuments(
              session,
              `users/${session.userId}/${collectionId}`
            );

            return docs.length;
          })
        );

        return counts.reduce((total, count) => total + count, 0);
      },
      {
        timeout: 30_000,
        intervals: [500, 750, 1000, 1500],
      }
    )
    .toBe(0);
}

export const resetUserDataDirect = resetUserDataViaSettings;
