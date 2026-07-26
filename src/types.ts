export interface Message {
  id: string
  text: string
  name: string | null
  state: string | null
  created_at: string
  hue_offset: number
  approved: boolean
}

export interface PuffLayout {
  id: string
  x: number
  y: number
  radius: number
}
