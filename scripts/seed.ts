// Seeds fake positive messages into Supabase so pan/zoom/animation
// performance can be checked at target scale before real event data arrives
// (Section 7, step 10). Run with `npm run seed`.
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const COUNT = 450

const OPENERS = [
  'Grateful for',
  'Loved',
  'So happy about',
  'Feeling thankful for',
  'A highlight this week was',
  'Really appreciated',
  'Filled with joy after',
  'Still smiling about',
]

const SUBJECTS = [
  'the morning meditation session',
  'connecting with old friends',
  'the kindness of a stranger',
  'a long walk in the sun',
  'the group satsang',
  'laughing with my family',
  'finishing a project I was proud of',
  'a quiet cup of tea at sunrise',
  'the breathing workshop',
  'reconnecting with nature',
  'a surprise call from a friend',
  'volunteering this weekend',
  'the seva project',
  'learning something new today',
  'a peaceful night of sleep',
  'the community potluck',
  'watching the sunset with loved ones',
  'a small act of kindness I witnessed',
  'the yoga session this morning',
  'time spent with my kids',
]

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function fakeMessage(): string {
  return `${randomItem(OPENERS)} ${randomItem(SUBJECTS)}.`
}

async function main() {
  const rows = Array.from({ length: COUNT }, () => ({
    text: fakeMessage(),
    hue_offset: Math.random() * 30 - 15,
  }))

  const batchSize = 50
  let inserted = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from('messages').insert(batch)
    if (error) {
      console.error(`Failed to insert batch starting at ${i}:`, error.message)
      process.exit(1)
    }
    inserted += batch.length
    console.log(`Inserted ${inserted}/${rows.length}`)
  }

  console.log('Done seeding.')
}

main()
