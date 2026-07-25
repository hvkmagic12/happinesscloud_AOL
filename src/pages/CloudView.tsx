import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Message } from '../types'
import CloudCanvas from '../cloud/CloudCanvas'
import MessagePopup from '../components/MessagePopup'
import './CloudView.css'

type LoadState = 'loading' | 'error' | 'ready'

export default function CloudView() {
  const location = useLocation()
  const justSubmittedId = (location.state as { justSubmittedId?: string } | null)
    ?.justSubmittedId

  const [messages, setMessages] = useState<Message[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [selected, setSelected] = useState<
    { message: Message; x: number; y: number } | null
  >(null)
  const knownIdsRef = useRef<Set<string>>(new Set())

  async function load() {
    setState('loading')
    const { data, error } = await supabase
      .from('messages')
      .select('id, text, created_at, hue_offset, approved')
      .eq('approved', true)
      .order('created_at', { ascending: true })

    if (error || !data) {
      setState('error')
      return
    }

    knownIdsRef.current = new Set(data.map((m) => m.id))
    setMessages(data)
    setState('ready')
  }

  useEffect(() => {
    load()
  }, [])

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

  return (
    <div className="cloud-view">
      {state === 'ready' && (
        <span className="cloud-counter">{messages.length} messages shared</span>
      )}
      <Link to="/" className="cloud-back-link">
        Share yours
      </Link>

      {state === 'loading' && (
        <div className="cloud-state">
          <p>Gathering the cloud…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="cloud-state">
          <p>Couldn't load the cloud. Please check your connection and try again.</p>
          <button type="button" className="retry-button" onClick={load}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && messages.length === 0 && (
        <div className="cloud-state">
          <p>No messages yet — be the first to share something positive.</p>
          <Link to="/" className="retry-button" style={{ textDecoration: 'none' }}>
            Share something
          </Link>
        </div>
      )}

      {state === 'ready' && messages.length > 0 && (
        <CloudCanvas
          messages={messages}
          justSubmittedId={justSubmittedId}
          onSelectPuff={(message, x, y) => setSelected({ message, x, y })}
        />
      )}

      {selected && (
        <MessagePopup
          text={selected.message.text}
          x={selected.x}
          y={selected.y}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
