'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/src/auth-client'
import GlassCard from '@/components/ui/GlassCard'

interface UserRow {
  id: string
  name: string
  email: string
  createdAt: number
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString()
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addLoading, setAddLoading] = useState(false)

  useEffect(() => {
    fetchUsers()
  }, [])

  async function fetchUsers() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/users')
      if (res.status === 401) { router.push('/login'); return }
      if (res.ok) setUsers(await res.json())
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    setAddLoading(true)
    try {
      const result = await authClient.signUp.email({ name, email, password })
      if (result.error) {
        setAddError(result.error.message ?? 'Failed to create user')
      } else {
        setName(''); setEmail(''); setPassword('')
        await fetchUsers()
      }
    } catch {
      setAddError('Failed to create user')
    } finally {
      setAddLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cyber-bg px-6 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="text-xs text-slate-500 hover:text-cyber-cyan transition-colors"
          >
            ← Dashboard
          </button>
          <h1
            className="text-xl font-bold tracking-tight text-cyber-cyan"
            style={{ fontFamily: 'JetBrains Mono, monospace' }}
          >
            USER MANAGEMENT
          </h1>
        </div>
      </header>

      <div className="grid gap-6 max-w-3xl">
        {/* User list */}
        <GlassCard className="p-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Users</h2>
          {loading ? (
            <div className="text-slate-500 text-sm py-4 text-center">Loading…</div>
          ) : users.length === 0 ? (
            <div className="text-slate-500 text-sm py-4 text-center">No users yet.</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-cyber-cyan/10">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Email</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-cyber-cyan/5">
                    <td className="py-2 pr-4 text-slate-200">{u.name}</td>
                    <td className="py-2 pr-4 text-slate-400 font-mono text-xs">{u.email}</td>
                    <td className="py-2 text-slate-500 text-xs">{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>

        {/* Add user form */}
        <GlassCard className="p-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Add User</h2>
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <input
              type="text"
              required
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-cyber-panel border border-cyber-cyan/20 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/50"
            />
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-cyber-panel border border-cyber-cyan/20 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/50"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-cyber-panel border border-cyber-cyan/20 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-cyber-cyan/50"
            />
            {addError && (
              <p className="text-xs text-cyber-crimson bg-cyber-crimson/10 border border-cyber-crimson/20 rounded px-3 py-2">
                {addError}
              </p>
            )}
            <button
              type="submit"
              disabled={addLoading}
              className="bg-cyber-cyan/10 border border-cyber-cyan/40 text-cyber-cyan text-sm font-semibold rounded px-4 py-2 hover:bg-cyber-cyan/20 transition-colors disabled:opacity-50"
            >
              {addLoading ? 'Adding…' : 'Add User'}
            </button>
          </form>
        </GlassCard>
      </div>
    </div>
  )
}
