export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { seedAdminIfNeeded } = await import('./src/seed-admin')
    seedAdminIfNeeded().catch(() => {})
  }
}
