import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'

export interface VoiceModel {
  sentences: string[]
  avgLength: number
  vocabulary: Set<string>
  channelSentences: Record<string, string[]>
}

function encodeProjectCwd(cwd: string): string {
  let real = cwd
  try {
    real = fs.realpathSync(cwd)
  } catch {
    // fall through
  }
  return real.replace(/[^a-zA-Z0-9]/g, '-')
}

const STOP_WORDS = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','is','it','i','you','we'])

function isOperatorMessage(line: string): { text: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const obj = parsed as Record<string, unknown>
  const msg = obj.message as Record<string, unknown> | undefined
  if (!msg) return null
  if (msg.role !== 'user') return null
  const content = msg.content
  if (!Array.isArray(content) || content.length === 0) return null
  if (content.every((c: unknown) => (c as Record<string, unknown>)?.type === 'tool_result')) return null
  const texts: string[] = []
  for (const item of content as unknown[]) {
    const c = item as Record<string, unknown>
    if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
      texts.push(c.text.trim())
    }
  }
  if (texts.length === 0) return null
  return { text: texts.join(' ') }
}

function tokenize(text: string): string[] {
  return text
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 1)
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function readOperatorMessagesFromFile(filePath: string, limit: number): Promise<string[]> {
  return new Promise((resolve) => {
    const msgs: string[] = []
    let stream: fs.ReadStream
    try {
      stream = fs.createReadStream(filePath, { encoding: 'utf8' })
    } catch {
      resolve(msgs)
      return
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (msgs.length >= limit) {
        rl.close()
        stream.destroy()
        return
      }
      const result = isOperatorMessage(line)
      if (result) msgs.push(result.text)
    })
    rl.on('close', () => resolve(msgs))
    rl.on('error', () => resolve(msgs))
    stream.on('error', () => {
      rl.close()
      resolve(msgs)
    })
  })
}

export async function extractOperatorVoice(mcdDir: string): Promise<VoiceModel> {
  const empty: VoiceModel = { sentences: [], avgLength: 0, vocabulary: new Set(), channelSentences: {} }

  let config: { projects?: Record<string, { slug: string }> } = {}
  try {
    const raw = fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf8')
    config = JSON.parse(raw)
  } catch {
    return empty
  }

  const projects = config.projects ?? {}
  const slugs = Object.values(projects).map((p) => p.slug)
  if (slugs.length === 0) return empty

  const allSentences: string[] = []
  const channelSentences: Record<string, string[]> = {}
  const freqMap = new Map<string, number>()
  let totalMsgsCollected = 0
  const MAX_TOTAL = 200

  for (const slug of slugs) {
    if (totalMsgsCollected >= MAX_TOTAL) break
    const projDir = path.join(mcdDir, 'projects', slug)
    const encoded = encodeProjectCwd(projDir)
    const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

    let files: string[] = []
    try {
      files = fs
        .readdirSync(transcriptDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(transcriptDir, f))
        .sort((a, b) => {
          try {
            return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
          } catch {
            return 0
          }
        })
    } catch {
      continue
    }

    const slugMsgs: string[] = []
    for (const file of files) {
      if (totalMsgsCollected >= MAX_TOTAL) break
      const remaining = MAX_TOTAL - totalMsgsCollected
      const msgs = await readOperatorMessagesFromFile(file, remaining)
      for (const msg of msgs) {
        const sents = splitSentences(msg)
        allSentences.push(...sents)
        slugMsgs.push(...sents)
        for (const word of tokenize(msg)) {
          if (!STOP_WORDS.has(word) && word.length >= 4) {
            freqMap.set(word, (freqMap.get(word) ?? 0) + 1)
          }
        }
        totalMsgsCollected++
        if (totalMsgsCollected >= MAX_TOTAL) break
      }
    }
    if (slugMsgs.length > 0) channelSentences[slug] = slugMsgs
  }

  if (allSentences.length === 0) return empty

  const wordCounts = allSentences.map((s) => tokenize(s).length)
  const avgLength = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length

  const topWords = [...freqMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([w]) => w)

  return {
    sentences: allSentences.slice(0, 100),
    avgLength,
    vocabulary: new Set(topWords),
    channelSentences,
  }
}

export function buildInjectionMessage(
  slug: string,
  last10Messages: string[],
  voiceModel: VoiceModel,
  channelMsgs?: string[],
): string {
  if (voiceModel.sentences.length === 0) return ''

  const fleetWords = [...voiceModel.vocabulary]
  const channelWords: string[] = []
  if (channelMsgs && channelMsgs.length > 0) {
    for (const msg of channelMsgs) {
      for (const word of tokenize(msg)) {
        if (!STOP_WORDS.has(word) && word.length >= 4) {
          channelWords.push(word, word, word)
        }
      }
    }
  }
  const biasedPool = [...fleetWords, ...channelWords]

  const contextMsg = last10Messages.slice().reverse().find((m) => m.trim().length > 0) ?? ''
  const contextSummary = contextMsg.length > 80 ? contextMsg.slice(0, 77) + '...' : contextMsg

  const pickWord = (): string => {
    if (biasedPool.length === 0) return ''
    return biasedPool[Math.floor(Math.random() * biasedPool.length)]
  }

  const w1 = pickWord()
  const w2 = pickWord()
  const encouragement = [w1, w2].filter(Boolean).join(', ')

  let msg: string
  if (contextSummary) {
    msg = `Keep going with: ${contextSummary}.`
    if (encouragement && contextSummary.length >= 20) msg += ` Stay ${encouragement}.`
  } else {
    msg = `Keep making progress.`
  }

  if (msg.length > 500) msg = msg.slice(0, 497) + '...'
  return msg
}
