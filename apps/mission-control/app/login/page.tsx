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
    <div className="min-h-dvh bg-cyber-bg flex items-center justify-center px-4">
      {/* Corner decorations */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-4 left-4 w-8 h-8 border-l-2 border-t-2 border-cyber-cyan/30" />
        <div className="absolute top-4 right-4 w-8 h-8 border-r-2 border-t-2 border-cyber-cyan/30" />
        <div className="absolute bottom-4 left-4 w-8 h-8 border-l-2 border-b-2 border-cyber-cyan/30" />
        <div className="absolute bottom-4 right-4 w-8 h-8 border-r-2 border-b-2 border-cyber-cyan/30" />
      </div>

      <div className="w-full max-w-sm">
        {/* Title above card */}
        <div className="text-center mb-8">
          <h1
            className="text-2xl font-black tracking-[0.2em] text-cyber-cyan neon-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            MISSION CONTROL
          </h1>
          <p className="text-[0.6rem] text-slate-500 mt-1 uppercase tracking-[0.3em]">
            Secure Access Terminal
          </p>
        </div>

        {/* Glass card */}
        <div className="relative overflow-hidden rounded-lg glass-panel p-8">
          {/* Corner accent */}
          <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-cyber-cyan/8 to-transparent pointer-events-none" />

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label
                className="text-[0.65rem] font-semibold text-cyber-cyan/60 uppercase tracking-[0.15em]"
                htmlFor="email"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="cyber-input px-3 py-2.5 text-sm w-full"
                placeholder="operator@example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                className="text-[0.65rem] font-semibold text-cyber-cyan/60 uppercase tracking-[0.15em]"
                htmlFor="password"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="cyber-input px-3 py-2.5 text-sm w-full"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-xs text-cyber-crimson bg-cyber-crimson/8 border border-cyber-crimson/25 rounded px-3 py-2.5 neon-crimson">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="cyber-btn-primary mt-1 text-sm font-bold tracking-widest rounded px-4 py-3 uppercase"
            >
              {loading ? 'Authenticating…' : 'Access System'}
            </button>
          </form>
        </div>

        <p className="text-center text-[0.6rem] text-slate-700 mt-6 uppercase tracking-widest">
          Authorized Personnel Only
        </p>
      </div>
    </div>
  )
}
