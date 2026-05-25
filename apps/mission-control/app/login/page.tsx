'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/src/auth-client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await authClient.signIn.email({ email, password })
      if (result.error) {
        setError(result.error.message ?? 'Invalid credentials')
      } else {
        router.push('/')
      }
    } catch {
      setError('Sign in failed. Check credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cyber-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm backdrop-blur-sm bg-cyber-surface/80 border border-cyber-cyan/20 rounded-xl p-8 shadow-inner">
        <h1
          className="text-xl font-bold tracking-tight text-cyber-cyan mb-1"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          MISSION CONTROL
        </h1>
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-8">Sign in to continue</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 uppercase tracking-wider" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-cyber-panel border border-cyber-cyan/20 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/50"
              placeholder="admin@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 uppercase tracking-wider" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-cyber-panel border border-cyber-cyan/20 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/50"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-cyber-crimson bg-cyber-crimson/10 border border-cyber-crimson/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-cyber-cyan/10 border border-cyber-cyan/40 text-cyber-cyan text-sm font-semibold rounded px-4 py-2 hover:bg-cyber-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
