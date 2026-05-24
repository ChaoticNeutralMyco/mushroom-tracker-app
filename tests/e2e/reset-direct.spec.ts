// tests/e2e/reset-direct.spec.ts
import { expect, test } from "@playwright/test";
import { captureNodeAuthSession, listFirestoreDocuments, setFirestoreDocument } from "./helpers/firestore";
import { resetUserDataViaSettings } from "./helpers/resetUserData";

test("direct Firestore reset removes E2E user data", async ({ page }) => {
  await page.goto("/");

  const session = await captureNodeAuthSession(page);
  const taskPath = `users/${session.userId}/tasks/e2e-reset-smoke-task`;

  await setFirestoreDocument(session, taskPath, {
    title: "E2E reset smoke task",
    createdAt: new Date().toISOString(),
  });

  const before = await listFirestoreDocuments(session, `users/${session.userId}/tasks`);
  expect(before.some((doc) => doc.id === "e2e-reset-smoke-task")).toBe(true);

  await resetUserDataViaSettings(page);

  const after = await listFirestoreDocuments(session, `users/${session.userId}/tasks`);
  expect(after.some((doc) => doc.id === "e2e-reset-smoke-task")).toBe(false);
});
