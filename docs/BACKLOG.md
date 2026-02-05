# Backlog

Ideas and improvements for future PRs.

---

## Accessibility (a11y)

### Keyboard Navigation for Clickable Table Rows
- Add `onKeyDown` handlers for Enter/Space to navigate
- Add `tabIndex={0}` and `role` attributes
- Add focus styles (`focus:ring`, `focus:outline`)
- Files affected:
  - `modelguide-ui/src/features/sessions/components/sessions-table.tsx`
  - `modelguide-ui/src/features/dashboard/components/recent-sessions.tsx`
  - `modelguide-ui/src/features/agents/components/agents-table.tsx`
  - `modelguide-ui/src/features/secrets/components/secrets-table.tsx`

### Label Associations
- Some labels use `<label>` without `htmlFor` - wrap inputs inside labels or add proper IDs
- Use biome's `lint/a11y/noLabelWithoutControl` rule as guide

### Focus Management
- Trap focus in modals/dialogs
- Return focus to trigger element on dialog close
- Skip links for main content

---

## UI Enhancements

### Loading States
- Add skeleton loaders to all data tables
- Optimistic updates for mutations

### Error Handling
- Add error boundaries at route level
- Toast notifications for mutation errors
- Retry buttons for failed queries

### Mobile Responsive
- Collapsible sidebar drawer on mobile
- Responsive table layouts (card view on small screens)

---

## Testing

### E2E Tests
- Playwright tests for critical user flows:
  - Login/logout
  - Session list → detail navigation
  - Agent CRUD operations
  - Connector configuration
  - Secret management

### Unit Tests
- Component tests with Testing Library
- Schema validation tests
- Utility function tests
