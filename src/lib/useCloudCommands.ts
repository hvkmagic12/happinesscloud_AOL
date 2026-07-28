import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { DEFAULT_PORTRAIT, PORTRAITS } from '../cloud/portrait'
import type { PortraitId } from '../cloud/portrait'

// Supabase Realtime broadcast: the admin presses "Assemble" and every open
// cloud — projector, phones, laptops — receives the command and starts the
// same animation within a few tens of milliseconds of each other. Broadcast
// needs no table and no RLS policy of its own, unlike the postgres_changes
// subscription used for messages.
const COMMAND_CHANNEL = 'cloud-commands'
const ASSEMBLE_EVENT = 'assemble'

interface AssemblePayload {
  assembled?: boolean
  portrait?: PortraitId
}

function isPortraitId(value: unknown): value is PortraitId {
  return typeof value === 'string' && value in PORTRAITS
}

export function useCloudCommands() {
  const [assembled, setAssembled] = useState(false)
  const [portrait, setPortrait] = useState<PortraitId>(DEFAULT_PORTRAIT)
  const channelRef = useRef<RealtimeChannel | null>(null)
  // Latest value, so a picture change can be re-broadcast with the assemble
  // state it belongs to without the callback closing over a stale one.
  const assembledRef = useRef(assembled)
  assembledRef.current = assembled
  const portraitRef = useRef(portrait)
  portraitRef.current = portrait

  useEffect(() => {
    const channel = supabase.channel(COMMAND_CHANNEL)
    channel
      .on('broadcast', { event: ASSEMBLE_EVENT }, ({ payload }) => {
        const next = (payload ?? {}) as AssemblePayload
        // Which picture travels with the command rather than in an event of
        // its own: a screen must never learn that the cloud is assembling
        // without also learning what it is assembling into.
        if (isPortraitId(next.portrait)) setPortrait(next.portrait)
        setAssembled(Boolean(next.assembled))
      })
      .subscribe()
    channelRef.current = channel

    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [])

  const send = useCallback(async (nextAssembled: boolean, nextPortrait: PortraitId) => {
    // Broadcast does not echo back to the sender, so the sender's own view is
    // updated directly here.
    setPortrait(nextPortrait)
    setAssembled(nextAssembled)
    await channelRef.current?.send({
      type: 'broadcast',
      event: ASSEMBLE_EVENT,
      payload: { assembled: nextAssembled, portrait: nextPortrait },
    })
  }, [])

  const broadcastAssembled = useCallback(
    (next: boolean) => send(next, portraitRef.current),
    [send],
  )

  const broadcastPortrait = useCallback(
    (next: PortraitId) => send(assembledRef.current, next),
    [send],
  )

  return { assembled, portrait, broadcastAssembled, broadcastPortrait }
}
