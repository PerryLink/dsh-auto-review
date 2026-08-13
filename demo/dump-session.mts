// Decode the demo session zstd log and dump auto-review related events.
import { readFileSync } from 'node:fs'
import { scanZstdFrames, createZstdFrameDecoder } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'

const file = process.argv[2]
const buffer = readFileSync(file)
const { frames } = scanZstdFrames(buffer)
let count = 0
for (const line of createZstdFrameDecoder().decode(buffer, frames)) {
  const event = JSON.parse(line)
  count += 1
  const interesting = event.type.startsWith('approval') || event.type.startsWith('autoReview')
    || event.type === 'tool/call' || event.type === 'tool/result'
  if (interesting) {
    console.log(JSON.stringify({ seq: event.seq, type: event.type, data: event.data }))
  }
}
console.log(`total events: ${count}`)
