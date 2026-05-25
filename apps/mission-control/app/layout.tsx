import './globals.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'

export const metadata = { title: 'Mission Control' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        className="min-h-screen bg-cyber-bg"
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        {children}
      </body>
    </html>
  )
}
