import { Globe, MessageCircle, Phone, Send, Slack } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ChannelType } from '~/schemas/sessions'

export const channelConfig: Record<ChannelType, { icon: ReactNode; label: string }> = {
  voice: { icon: <Phone className="h-4 w-4" />, label: 'Voice' },
  web: { icon: <Globe className="h-4 w-4" />, label: 'Web' },
  api: { icon: <Send className="h-4 w-4" />, label: 'API' },
  slack: { icon: <Slack className="h-4 w-4" />, label: 'Slack' },
  widget: { icon: <MessageCircle className="h-4 w-4" />, label: 'Widget' },
  sms: { icon: <MessageCircle className="h-4 w-4" />, label: 'SMS' },
  whatsapp: { icon: <MessageCircle className="h-4 w-4" />, label: 'WhatsApp' },
}
