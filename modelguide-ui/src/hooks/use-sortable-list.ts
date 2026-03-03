import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder'
import { useCallback, useEffect, useRef, useState } from 'react'

interface SortableItem {
  id: string
}

export type DropEdge = 'top' | 'bottom'

export interface DropIndicator {
  id: string
  edge: DropEdge
}

interface UseSortableListOptions<T extends SortableItem> {
  items: T[]
  onReorder: (items: T[]) => void
}

export function useSortableList<T extends SortableItem>({
  items,
  onReorder,
}: UseSortableListOptions<T>) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const elementRefs = useRef<Map<string, HTMLElement>>(new Map())
  const handleRefs = useRef<Map<string, HTMLElement>>(new Map())

  const setElementRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) elementRefs.current.set(id, el)
    else elementRefs.current.delete(id)
  }, [])

  const setHandleRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) handleRefs.current.set(id, el)
    else handleRefs.current.delete(id)
  }, [])

  useEffect(() => {
    const cleanups: (() => void)[] = []

    for (const item of items) {
      const el = elementRefs.current.get(item.id)
      const handle = handleRefs.current.get(item.id)
      if (!el) continue

      cleanups.push(
        draggable({
          element: el,
          dragHandle: handle ?? undefined,
          getInitialData: () => ({ itemId: item.id }),
          onDragStart: () => setDraggedId(item.id),
          onDrop: () => {
            setDraggedId(null)
            setDropIndicator(null)
          },
        }),
      )

      cleanups.push(
        dropTargetForElements({
          element: el,
          getData: () => ({ itemId: item.id }),
          canDrop: ({ source }) => source.data.itemId !== item.id,
          onDragEnter: ({ source }) => {
            const srcIdx = items.findIndex((i) => i.id === source.data.itemId)
            const dstIdx = items.findIndex((i) => i.id === item.id)
            const edge: DropEdge = srcIdx < dstIdx ? 'bottom' : 'top'
            setDropIndicator({ id: item.id, edge })
          },
          onDrag: ({ source, self }) => {
            const srcIdx = items.findIndex((i) => i.id === source.data.itemId)
            const dstIdx = items.findIndex((i) => i.id === item.id)
            const edge: DropEdge = srcIdx < dstIdx ? 'bottom' : 'top'
            setDropIndicator({ id: item.id, edge })
          },
          onDragLeave: () => {
            setDropIndicator((prev) => (prev?.id === item.id ? null : prev))
          },
          onDrop: ({ source }) => {
            setDropIndicator(null)
            const srcId = source.data.itemId as string
            const srcIdx = items.findIndex((i) => i.id === srcId)
            const dstIdx = items.findIndex((i) => i.id === item.id)
            if (srcIdx === -1 || dstIdx === -1) return
            onReorder(reorder({ list: items, startIndex: srcIdx, finishIndex: dstIdx }))
          },
        }),
      )
    }

    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }, [items, onReorder])

  return { draggedId, dropIndicator, setElementRef, setHandleRef }
}
