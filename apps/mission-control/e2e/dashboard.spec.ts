import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:3002'

test('unauthenticated GET / redirects to /login', async ({ page }) => {
  await page.goto(BASE + '/')
  await expect(page).toHaveURL(/\/login/)
})

test('unauthenticated API GET /api/instances returns 401', async ({ request }) => {
  const res = await request.get(BASE + '/api/instances')
  expect(res.status()).toBe(401)
})

test('login with wrong password stays on /login with error', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.fill('input[type="email"]', 'admin@test.com')
  await page.fill('input[type="password"]', 'wrongpassword')
  await page.click('button[type="submit"]')
  // Should stay on login
  await expect(page).toHaveURL(/\/login/)
  // Error message visible
  await expect(page.locator('p.text-cyber-crimson, [class*="crimson"]')).toBeVisible({ timeout: 5000 })
})

test('login with correct credentials lands on dashboard', async ({ page }) => {
  await page.goto(BASE + '/login')
  await page.fill('input[type="email"]', 'admin@test.com')
  await page.fill('input[type="password"]', 'testpass123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(BASE + '/', { timeout: 10_000 })
  await expect(page.locator('h1')).toContainText('MISSION CONTROL')
})

test('dashboard shows historical events from seeded DB', async ({ page }) => {
  // Login first
  await page.goto(BASE + '/login')
  await page.fill('input[type="email"]', 'admin@test.com')
  await page.fill('input[type="password"]', 'testpass123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(BASE + '/', { timeout: 10_000 })

  // Event feed should have at least 1 item from historical fetch (seeded DB has 2)
  // Wait up to 5s for historical load
  await expect(page.locator('.font-mono.text-xs').first()).toBeVisible({ timeout: 5000 })
})

test('dashboard opens exactly one SSE connection', async ({ page }) => {
  let sseCount = 0

  page.on('request', (req) => {
    if (req.url().includes('/api/events/stream')) sseCount++
  })

  await page.goto(BASE + '/login')
  await page.fill('input[type="email"]', 'admin@test.com')
  await page.fill('input[type="password"]', 'testpass123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(BASE + '/', { timeout: 10_000 })

  // Wait for dashboard to fully mount
  await page.waitForTimeout(2000)

  expect(sseCount).toBe(1)
})
