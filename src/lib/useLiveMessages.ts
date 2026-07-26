import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import type { Message } from '../types'

export type LoadState = 'loading' | 'error' | 'ready'

export function useLiveMessages() {
  const [messages, setMessages] = useState<Message[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const knownIdsRef = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    setState('loading')
    const { data, error } = await supabase
      .from('messages')
      .select('id, text, name, state, created_at, hue_offset, approved')
      .eq('approved', true)
      .order('created_at', { ascending: true })

    if (error || !data) {
      setState('error')
      return
    }

    knownIdsRef.current = new Set(data.map((m) => m.id))
    setMessages(data)
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
