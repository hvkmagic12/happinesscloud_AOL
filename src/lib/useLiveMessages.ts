import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Message } from '../types'

export type LoadState = 'loading' | 'error' | 'ready'

// Supabase's PostgREST layer caps a single request at 1000 rows by default
// (db-max-rows), regardless of project size. Paginate with .range() so the
// cloud isn't silently truncated once message count passes that cap. The
// secondary `id` sort makes pagination deterministic even when many rows
// share a created_at (e.g. a batch-seeded load test).
const PAGE_SIZE = 1000

export function useLiveMessages() {
  const [messages, setMessages] = useState<Message[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const knownIdsRef = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    setState('loading')

    const all: Message[] = []
    let offset = 0

    while (true) {
      const { data, error } = await supabase
        .from('messages')
        .select('id, text, name, state, created_at, hue_offset, approved')
        .eq('approved', true)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (error || !data) {
        setState('error')
        return
      }

      all.push(...data)
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    knownIdsRef.current = new Set(all.map((m) => m.id))
    setMessages(all)
    setState('ready')
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('messages-inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as Message
          if (!row.approved) return
          if (knownIdsRef.current.has(row.id)) return
          knownIdsRef.current.add(row.id)
          setMessages((prev) => [...prev, row])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return { messages, state, reload: load }
}
