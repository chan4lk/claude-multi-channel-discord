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

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="w-2 h-2 rounded-sm bg-cyber-cyan/60 shrink-0" />
      <h2 className="section-label">{label}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-cyber-cyan/20 to-transparent" />
    </div>
  )
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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  async function handleDelete(id: string) {
    if (!confirm('Delete this user? This cannot be undone.')) return
    setDeletingId(id)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
      if (res.status === 401) { router.push('/login'); return }
      const body = await res.json()
      if (!res.ok) {
        setDeleteError(body.error ?? 'Failed to delete user')
      } else {
        await fetchUsers()
      }
    } catch {
      setDeleteError('Failed to delete user')
    } finally {
      setDeletingId(null)
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
    <div className="min-h-dvh bg-cyber-bg px-4 sm:px-6 py-6">
      <header className="mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/')}
            className="text-xs text-slate-500 hover:text-cyber-cyan transition-colors cursor-pointer flex items-center gap-1"
          >
            <span className="text-cyber-cyan/40">←</span> Dashboard
          </button>
          <div className="h-3 w-px bg-cyber-cyan/20" />
          <h1
            className="text-lg font-black tracking-[0.18em] text-cyber-cyan neon-cyan"
            style={{ fontFamily: 'Orbitron, JetBrains Mono, monospace' }}
          >
            USER MANAGEMENT
          </h1>
        </div>
      </header>

      <div className="grid gap-6 max-w-3xl">
        <GlassCard className="p-5">
          <SectionLabel label="Users" />
          {deleteError && (
            <p className="text-xs text-cyber-crimson bg-cyber-crimson/8 border border-cyber-crimson/25 rounded px-3 py-2 mb-3">
              {deleteError}
            </p>
          )}
          {loading ? (
            <div className="text-slate-500 text-sm py-8 text-center font-mono">Loading…</div>
          ) : users.length === 0 ? (
            <div className="text-slate-500 text-sm py-8 text-center">No users yet.</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b border-cyber-cyan/15">
                  <th className="pb-2.5 pr-4 text-[0.65rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest">Name</th>
                  <th className="pb-2.5 pr-4 text-[0.65rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest">Email</th>
                  <th className="pb-2.5 pr-4 text-[0.65rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest">Created</th>
                  <th className="pb-2.5 text-[0.65rem] font-semibold text-cyber-cyan/50 uppercase tracking-widest" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-cyber-cyan/6 hover:bg-cyber-cyan/3 transition-colors">
                    <td className="py-2.5 pr-4 text-slate-200">{u.name}</td>
                    <td className="py-2.5 pr-4 text-slate-400 font-mono text-xs">{u.email}</td>
                    <td className="py-2.5 pr-4 text-slate-500 text-xs font-mono">{formatDate(u.createdAt)}</td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => handleDelete(u.id)}
                        disabled={deletingId === u.id}
                        className="text-[0.65rem] text-cyber-crimson/60 hover:text-cyber-crimson border border-cyber-crimson/20 hover:border-cyber-crimson/50 rounded px-2 py-0.5 transition-colors font-mono uppercase tracking-wider disabled:opacity-40 cursor-pointer"
                      >
                        {deletingId === u.id ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <SectionLabel label="Add User" />
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <input
              type="text"
              required
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="cyber-input px-3 py-2.5 text-sm w-full"
            />
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="cyber-input px-3 py-2.5 text-sm w-full"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="cyber-input px-3 py-2.5 text-sm w-full"
            />
            {addError && (
              <p className="text-xs text-cyber-crimson bg-cyber-crimson/8 border border-cyber-crimson/25 rounded px-3 py-2">
                {addError}
              </p>
            )}
            <button
              type="submit"
              disabled={addLoading}
              className="cyber-btn-primary text-sm font-bold tracking-widest rounded px-4 py-2.5 uppercase"
            >
              {addLoading ? 'Adding…' : 'Create User'}
            </button>
          </form>
        </GlassCard>
      </div>
    </div>
  )
}
