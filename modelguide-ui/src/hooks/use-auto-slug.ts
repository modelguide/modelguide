import { useState } from 'react'
import { slugify } from '~/lib/utils'

interface UseAutoSlugOptions {
  initialName?: string
  initialSlug?: string
  /** When true, slug won't auto-derive from name changes (e.g. edit mode) */
  locked?: boolean
}

export function useAutoSlug({
  initialName = '',
  initialSlug = '',
  locked = false,
}: UseAutoSlugOptions = {}) {
  const [name, setName] = useState(initialName)
  const [slug, setSlug] = useState(initialSlug)
  const [slugEdited, setSlugEdited] = useState(locked)

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(slugify(value))
    }
  }

  const handleSlugChange = (value: string) => {
    setSlug(value)
    setSlugEdited(true)
  }

  return { name, slug, handleNameChange, handleSlugChange }
}
