import type { Page } from '@playwright/test'

const DEMO_VIEWER_EMAIL = 'delivered+viewer-glowbox@resend.dev'

/**
 * Log in as the demo viewer through the UI login form.
 * Demo viewers in demo-enabled orgs get instant auth (no magic link).
 */
export async function loginAsDemoViewer(page: Page): Promise<void> {
  await page.goto('/login')

  // Fill email and submit
  await page.getByLabel('Email').fill(DEMO_VIEWER_EMAIL)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Wait for redirect to authenticated area (dashboard)
  await page.waitForURL(/\/(analytics|$)/, { timeout: 15_000 })
}
