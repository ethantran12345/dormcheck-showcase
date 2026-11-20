
/** Display order: Pitt dorm + apartment extras */
const STANDARD_CATEGORIES = [
  "Sleep",
  "Climate",
  "Bathroom",
  "Bathroom Maintenance",
  "Tech",
  "Documents",
  "Kitchen",
  "Full Kitchen",
  "Living Room",
  "Laundry",
  "Wellness",
  "Decor",
  "Organization",
] as const;

type ChecklistGroup = {
  id: string;
  owner_id: string;
  collaborator_id: string;
  owner_name: string | null;
  collaborator_name: string | null;
  owner_avatar_url: string | null;
  collaborator_avatar_url: string | null;
  group_name: string | null;
  is_owner: boolean;
};

type GroupMember = {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  venmo_username?: string | null;
  zelle_info?: string | null;
  role: "owner" | "collaborator";
  status: string;
};

type GroupMemberLabelInput = {
  user_id: string;
  display_name?: string | null;
  full_name?: string | null;
};

type ChecklistDragPreview = {
  fromCategory: string;
  toCategory: string;
  activeId: string;
  overId: string | null;
};

export {
  STANDARD_CATEGORIES,
  type ChecklistGroup,
  type GroupMember,
  type GroupMemberLabelInput,
  type ChecklistDragPreview,
};
