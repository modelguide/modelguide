import { useAuthStore } from '~/stores/auth'

export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.user?.role) === 'admin'
}

export function useIsViewer(): boolean {
  return useAuthStore((s) => s.user?.role) === 'viewer'
}

export function useCanMutate(): boolean {
  const role = useAuthStore((s) => s.user?.role)
  return role != null && role !== 'viewer'
}
