import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export type SettlementMember = {
  member_id: string;
  user_id: string;
  role: string;
  full_name: string | null;
  avatar_url: string | null;
  venmo_username: string | null;
  zelle_info: string | null;
};

export type SettlementPaymentHistoryRow = {
  id: string;
  group_id: string;
  payer_id: string;
  receiver_id: string;
  amount: number | string;
  method: string | null;
  status: string;
  note: string | null;
  created_at: string;
};

export type SettlementLegacyPaymentRow = {
  id: string;
  group_id: string;
  payer_id: string;
  payee_id: string;
  amount: number | string;
  paid_at: string | null;
  created_at: string;
};

export type SettlementPaymentAckRow = {
  group_id: string;
  debtor_id: string;
  creditor_id: string;
  sent_at: string;
};

export type ChecklistSettlementContext = {
  members: SettlementMember[];
  paymentHistory: SettlementPaymentHistoryRow[];
  legacyPayments: SettlementLegacyPaymentRow[];
  paymentAcks: SettlementPaymentAckRow[];
};

export const EMPTY_CHECKLIST_SETTLEMENT_CONTEXT: ChecklistSettlementContext = {
  members: [],
  paymentHistory: [],
  legacyPayments: [],
  paymentAcks: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : null;
}

function readAmount(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value;
  return null;
}

function parseMember(raw: unknown): SettlementMember | null {
  if (!isRecord(raw)) return null;
  const member_id = readString(raw.member_id);
  const user_id = readString(raw.user_id);
  const role = readString(raw.role);
  if (!member_id || !user_id || !role) return null;
  return {
    member_id,
    user_id,
    role,
    full_name: readNullableString(raw.full_name),
    avatar_url: readNullableString(raw.avatar_url),
    venmo_username: readNullableString(raw.venmo_username),
    zelle_info: readNullableString(raw.zelle_info),
  };
}

function parsePaymentHistoryRow(raw: unknown): SettlementPaymentHistoryRow | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const group_id = readString(raw.group_id);
  const payer_id = readString(raw.payer_id);
  const receiver_id = readString(raw.receiver_id);
  const amount = readAmount(raw.amount);
  const status = readString(raw.status);
  const created_at = readString(raw.created_at);
  if (!id || !group_id || !payer_id || !receiver_id || amount === null || !status || !created_at) {
    return null;
  }
  return {
    id,
    group_id,
    payer_id,
    receiver_id,
    amount,
    method: readNullableString(raw.method),
    status,
    note: readNullableString(raw.note),
    created_at,
  };
}

function parseLegacyPaymentRow(raw: unknown): SettlementLegacyPaymentRow | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  const group_id = readString(raw.group_id);
  const payer_id = readString(raw.payer_id);
  const payee_id = readString(raw.payee_id);
  const amount = readAmount(raw.amount);
  const created_at = readString(raw.created_at);
  if (!id || !group_id || !payer_id || !payee_id || amount === null || !created_at) {
    return null;
  }
  return {
    id,
    group_id,
    payer_id,
    payee_id,
    amount,
    paid_at: readNullableString(raw.paid_at),
    created_at,
  };
}

function parsePaymentAckRow(raw: unknown): SettlementPaymentAckRow | null {
  if (!isRecord(raw)) return null;
  const group_id = readString(raw.group_id);
  const debtor_id = readString(raw.debtor_id);
  const creditor_id = readString(raw.creditor_id);
  const sent_at = readString(raw.sent_at);
  if (!group_id || !debtor_id || !creditor_id || !sent_at) return null;
  return { group_id, debtor_id, creditor_id, sent_at };
}

function parseArray<T>(raw: unknown, parseItem: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parseItem(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Strict mapper from RPC jsonb to typed settlement context. Never throws. */
export function parseChecklistSettlementContext(raw: Json | null): ChecklistSettlementContext {
  if (!isRecord(raw)) return EMPTY_CHECKLIST_SETTLEMENT_CONTEXT;

  const membersRaw = raw.members;
  const paymentHistoryRaw = raw.payment_history;
  const legacyPaymentsRaw = raw.legacy_payments;
  const paymentAcksRaw = raw.payment_acks;

  if (
    membersRaw !== undefined &&
    membersRaw !== null &&
    !Array.isArray(membersRaw)
  ) {
    return EMPTY_CHECKLIST_SETTLEMENT_CONTEXT;
  }
  if (
    paymentHistoryRaw !== undefined &&
    paymentHistoryRaw !== null &&
    !Array.isArray(paymentHistoryRaw)
  ) {
    return EMPTY_CHECKLIST_SETTLEMENT_CONTEXT;
  }
  if (
    legacyPaymentsRaw !== undefined &&
    legacyPaymentsRaw !== null &&
    !Array.isArray(legacyPaymentsRaw)
  ) {
    return EMPTY_CHECKLIST_SETTLEMENT_CONTEXT;
  }
  if (
    paymentAcksRaw !== undefined &&
    paymentAcksRaw !== null &&
    !Array.isArray(paymentAcksRaw)
  ) {
    return EMPTY_CHECKLIST_SETTLEMENT_CONTEXT;
  }

  return {
    members: parseArray(membersRaw, parseMember),
    paymentHistory: parseArray(paymentHistoryRaw, parsePaymentHistoryRow),
    legacyPayments: parseArray(legacyPaymentsRaw, parseLegacyPaymentRow),
    paymentAcks: parseArray(paymentAcksRaw, parsePaymentAckRow),
  };
}

export function isSettlementGuardError(error: { message?: string } | null | undefined): boolean {
  const message = error?.message ?? '';
  return message.includes('Not authenticated') || message.includes('Not authorized');
}

export function useChecklistSettlementContext(groupId: string | null) {
  const query = useQuery({
    queryKey: ['checklist-settlement-context', groupId],
    queryFn: async (): Promise<ChecklistSettlementContext> => {
      if (!groupId) return EMPTY_CHECKLIST_SETTLEMENT_CONTEXT;

      const { data, error } = await supabase.rpc('get_group_checklist_settlement_context', {
        p_group_id: groupId,
      });

      if (error) {
        if (isSettlementGuardError(error)) {
          return EMPTY_CHECKLIST_SETTLEMENT_CONTEXT;
        }
        throw error;
      }

      return parseChecklistSettlementContext(data);
    },
    enabled: !!groupId,
    staleTime: 15_000,
  });

  return {
    context: query.data ?? EMPTY_CHECKLIST_SETTLEMENT_CONTEXT,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
