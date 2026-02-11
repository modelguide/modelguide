import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { api } from '~/lib/api'
import { useCanMutate } from '~/lib/permissions'
import type { User } from '~/schemas/auth'
import { useAuthStore } from '~/stores/auth'

export function ProfileForm() {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const setAuth = useAuthStore((s) => s.setAuth)
  const canMutate = useCanMutate()
  const [name, setName] = useState(user?.name ?? '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !token) return

    setIsSaving(true)
    try {
      const updatedUser = await api.patch(`users/${user.id}`, { json: { name } }).json<User>()
      setAuth(updatedUser, token)
      toast.success('Profile updated successfully')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            disabled={!canMutate}
          />

          <Input label="Email" value={user?.email ?? ''} disabled hint="Email cannot be changed" />

          <Input
            label="Role"
            value={user?.role ?? ''}
            disabled
            hint="Contact an administrator to change your role"
          />

          {canMutate ? (
            <div className="pt-2">
              <Button type="submit" loading={isSaving}>
                Save Changes
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
