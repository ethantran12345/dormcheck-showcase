import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grip, Trophy } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useDorms } from '@/hooks/useDorms';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Dorm } from '@/types';

interface PickItem {
  dormId: number;
  dorm: Dorm | null;
}

function SortablePickRow({ item, index, label }: { item: PickItem; index: number; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.dormId,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-lg bg-card py-1',
        isDragging && 'relative z-10 shadow-raised',
      )}
    >
      <span className="w-5 text-sm font-bold text-foreground">{index + 1}</span>
      {item.dorm?.image ? (
        <img src={item.dorm.image} alt="" className="h-9 w-9 rounded-lg object-cover" />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={label}
        className="flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground active:cursor-grabbing"
      >
        <Grip className="h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}

/**
 * Our dorm picks - the roommate group's ranked dorms, editable in place.
 * Order = group_dorm_rankings overrides first, then any dorm a member has
 * personally ranked (consensus by average position) that the group hasn't
 * ordered yet. Drag-to-rank writes group_dorm_rankings (any member; same
 * write path as the retired Rankings tab in the housing explore overlay).
 */
export function OurDormPicksCard({
  groupId,
  memberIds,
}: {
  groupId: string;
  memberIds: string[];
}) {
  const { t } = useTranslation();
  const { dorms } = useDorms();
  const queryClient = useQueryClient();
  const [orderedIds, setOrderedIds] = useState<number[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: pickIds = [] } = useQuery({
    queryKey: ['roommate-hub-group-picks', groupId],
    enabled: !!groupId && memberIds.length > 0,
    queryFn: async (): Promise<number[]> => {
      const [{ data: groupRows }, { data: memberRows }] = await Promise.all([
        supabase
          .from('group_dorm_rankings')
          .select('dorm_id, rank_order')
          .eq('group_id', groupId)
          .order('rank_order', { ascending: true }),
        supabase
          .from('user_dorm_rankings')
          .select('dorm_id, rank_order')
          .in('user_id', memberIds),
      ]);

      const groupOrder = (groupRows ?? []).map((r) => Number(r.dorm_id));
      const inGroup = new Set(groupOrder);

      // Consensus for dorms the group hasn't manually ordered: average of the
      // members' personal rank positions (lower = better).
      const sums = new Map<number, { total: number; count: number }>();
      (memberRows ?? []).forEach((r) => {
        const id = Number(r.dorm_id);
        if (inGroup.has(id)) return;
        const cur = sums.get(id) ?? { total: 0, count: 0 };
        sums.set(id, { total: cur.total + Number(r.rank_order), count: cur.count + 1 });
      });
      const consensusTail = [...sums.entries()]
        .sort((a, b) => a[1].total / a[1].count - b[1].total / b[1].count)
        .map(([id]) => id);

      return [...groupOrder, ...consensusTail];
    },
  });

  useEffect(() => {
    setOrderedIds(pickIds);
  }, [pickIds]);

  const items: PickItem[] = useMemo(
    () =>
      orderedIds.map((dormId) => ({
        dormId,
        dorm: dorms.find((d) => String(d.id) === String(dormId)) ?? null,
      })),
    [orderedIds, dorms],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderedIds((ids) => {
      const oldIndex = ids.indexOf(Number(active.id));
      const newIndex = ids.indexOf(Number(over.id));
      const newOrder = arrayMove(ids, oldIndex, newIndex);
      void (async () => {
        const payload = newOrder.map((dorm_id, index) => ({
          group_id: groupId,
          dorm_id,
          rank_order: index + 1,
        }));
        const { error } = await supabase
          .from('group_dorm_rankings')
          .upsert(payload, { onConflict: 'group_id,dorm_id' });
        if (error) {
          toast.error(t('roommates:hub.picksSaveFailed'));
        }
        queryClient.invalidateQueries({ queryKey: ['roommate-hub-group-picks', groupId] });
      })();
      return newOrder;
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
          <Trophy className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        </div>
        <h2 className="text-sm font-semibold text-foreground">{t('roommates:hub.picksCardTitle')}</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('roommates:hub.picksEmpty')}</p>
        ) : (
          <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                <ol className="space-y-1">
                  {items.map((item, idx) => (
                    <SortablePickRow
                      key={item.dormId}
                      item={item}
                      index={idx}
                      label={item.dorm?.name ?? t('roommates:hub.unknownDorm')}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
            <p className="text-xs text-muted-foreground">{t('roommates:hub.picksDragHint')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
