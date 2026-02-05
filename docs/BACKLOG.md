# Backlog

Ideas and improvements for future PRs.

---

## Accessibility (a11y)

### Keyboard Navigation for Clickable Table Rows
- ✅ Sessions table has keyboard navigation with `tabIndex`, `onKeyDown`, focus styles, and `aria-label`
- Apply same pattern to other tables:
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

## Code Quality

### Query Key Constants
- Extract query keys to constants to prevent typos and enable easy refactoring
- Example: `QUERY_KEYS.sessions`, `QUERY_KEYS.agents`
- Files affected:
  - Create `modelguide-ui/src/lib/query-keys.ts`
  - Update all `useQuery` and `useMutation` calls

### Form Validation
- ✅ Login form now uses `loginRequestSchema.safeParse()` before submission
- Apply same pattern to other form components:
  - `modelguide-ui/src/features/agents/components/agent-form.tsx`
  - `modelguide-ui/src/features/secrets/components/secret-form.tsx`

### Comment Auth Guard Logic
- ✅ Done - `_authenticated.tsx` has comments explaining dual guard approach

---

## Security

### Auth Token Storage Risk
- Replace localStorage-based auth token persistence with httpOnly cookies or another XSS-resistant approach
- Consider short-lived tokens + refresh flow
- Files affected:
  - `modelguide-ui/src/stores/auth.ts`

### Auth Revalidation on App Load
- Validate persisted auth state by calling `/api/auth/me` on boot and clearing stale tokens
- Ensure redirects on failure
- Files affected:
  - `modelguide-ui/src/stores/auth.ts`
  - `modelguide-ui/src/routes/_authenticated.tsx`

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

### Completed From Review
- ✅ Login honors `redirect` query param after successful auth
- ✅ 401 responses force logout and redirect to `/login`
- ✅ Session list row keyboard handling does not navigate when focus is on action buttons
