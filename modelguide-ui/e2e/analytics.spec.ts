import { expect, test } from '@playwright/test'
import { loginAsDemoViewer } from './helpers/auth'

test.describe('Analytics page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoViewer(page)
    await page.goto('/analytics')
    // Wait for summary cards to load (first metric card)
    await page.locator('text=Total Sessions').waitFor({ timeout: 15_000 })
  })

  test('displays all 7 summary metric cards', async ({ page }) => {
    const labels = [
      'Total Sessions',
      'Resolution Rate',
      'Avg Duration',
      'CSAT Score',
      'Abandonment Rate',
      'Avg Messages',
      'Feedback Coverage',
    ]

    for (const label of labels) {
      const card = page.locator(`text=${label}`).first()
      await expect(card).toBeVisible()
    }
  })

  test('summary cards display numeric values (not loading/error)', async ({ page }) => {
    // Each card has a value element — check that they contain actual data
    // The value is in a <p> with text-xl font-semibold
    const valueElements = page.locator('p.text-xl.font-semibold')
    const count = await valueElements.count()

    // Should have 7 metric cards
    expect(count).toBe(7)

    for (let i = 0; i < count; i++) {
      const text = await valueElements.nth(i).textContent()
      expect(text).toBeTruthy()
      // Value should not be empty or just whitespace
      expect(text?.trim().length).toBeGreaterThan(0)
    }
  })

  test('Status Breakdown chart section is visible', async ({ page }) => {
    await expect(page.locator('text=Status Breakdown')).toBeVisible()
  })

  test('Channel Breakdown chart section is visible', async ({ page }) => {
    await expect(page.locator('text=Channel Breakdown')).toBeVisible()
  })

  test('Agent Performance table is visible with data', async ({ page }) => {
    await expect(page.locator('text=Agent Performance')).toBeVisible()

    // Wait for agent table to load — should have at least one row
    const agentRows = page.locator('table tbody tr')
    await expect(agentRows.first()).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('Analytics date range interactions', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoViewer(page)
    await page.goto('/analytics')
    await page.locator('text=Total Sessions').waitFor({ timeout: 15_000 })
  })

  test('changing date range preset re-renders cards', async ({ page }) => {
    const totalSessionsValue = page.locator('p.text-xl.font-semibold').first()

    // Change to "Last 90 days"
    const select = page.locator('select')
    await select.selectOption('last90d')

    // Wait for re-render — the loading spinner or updated value
    // Just verify no error state appears
    await page.waitForTimeout(2000)

    // Verify Total Sessions label still visible (no error state)
    await expect(page.locator('text=Total Sessions')).toBeVisible()

    // Verify value is still a non-empty string (could be same or different)
    const newValue = await totalSessionsValue.textContent()
    expect(newValue).toBeTruthy()
    expect(newValue?.trim().length).toBeGreaterThan(0)
  })

  test('Last month preset loads without errors', async ({ page }) => {
    const select = page.locator('select')
    await select.selectOption('lastMonth')

    // Wait for data to load
    await page.waitForTimeout(2000)

    // Verify no error state
    const errorBanner = page.locator('text=Failed to load analytics')
    await expect(errorBanner).not.toBeVisible()

    // Verify summary cards still render
    await expect(page.locator('text=Total Sessions')).toBeVisible()
  })
})
