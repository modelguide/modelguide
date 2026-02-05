import { agentHandlers } from './agents'
import { analyticsHandlers } from './analytics'
import { authHandlers } from './auth'
import { connectorHandlers } from './connectors'
import { secretHandlers } from './secrets'
import { sessionHandlers } from './sessions'
import { userHandlers } from './users'

export const handlers = [
  ...authHandlers,
  ...analyticsHandlers,
  ...sessionHandlers,
  ...agentHandlers,
  ...connectorHandlers,
  ...secretHandlers,
  ...userHandlers,
]
