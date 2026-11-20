import { Camera, Flag, MessageSquare, ShoppingBag, Star, User } from 'lucide-react';

/**
 * Shared types + display constants for the admin Reports Queue inbox
 * (ReportsPage + ReportsQueueList + ReportsQueueDetail).
 */

// TODO: consolidate with ReportableContentType in useContentReports.ts
export type ReportableContentType =
  | 'marketplace_listing'
  | 'building_chat_link'
  | 'user'
  | 'seller_rating'
  | 'student_setup'
  | 'group_message'
  | 'dm_message'
  | 'roommate_post';

export type UnifiedReport = {
  report_id: string;
  content_type: ReportableContentType;
  content_id: string;
  reporter_id: string;
  reporter_name: string | null;
  reason: string | null;
  /** Structured category (content_reports.category); null for legacy reports. */
  category: string | null;
  /** Set when escalated to DormCheck (superadmin triage); null for legacy reports. */
  escalated_at: string | null;
  reported_at: string;
  preview_title: string | null;
  preview_body: string | null;
  content_owner_id: string | null;
  content_context: string | null;
  /** Where this report came from - affects how Approve / Hide work */
  source: 'content_reports' | 'building_chat_link_reports';
};

export type FilterValue = 'all' | ReportableContentType;

export const FILTER_LABELS: Record<FilterValue, string> = {
  all: 'All',
  marketplace_listing: 'Listings',
  building_chat_link: 'Chat links',
  user: 'Users',
  seller_rating: 'Seller ratings',
  student_setup: 'Room setups',
  group_message: 'Group messages',
  dm_message: 'Direct messages',
  roommate_post: 'Roommate posts',
};

export const TYPE_ICONS: Record<ReportableContentType, typeof Flag> = {
  marketplace_listing: ShoppingBag,
  building_chat_link: MessageSquare,
  user: User,
  seller_rating: Star,
  student_setup: Camera,
  group_message: MessageSquare,
  dm_message: MessageSquare,
  roommate_post: User,
};

export const TYPE_LABELS: Record<ReportableContentType, string> = {
  marketplace_listing: 'Listing',
  building_chat_link: 'Chat link',
  user: 'User',
  seller_rating: 'Seller rating',
  student_setup: 'Room setup',
  group_message: 'Group message',
  dm_message: 'Direct message',
  roommate_post: 'Roommate post',
};

/** Stable identity for a report across both source tables. */
export function reportKey(report: Pick<UnifiedReport, 'source' | 'report_id'>): string {
  return `${report.source}-${report.report_id}`;
}
