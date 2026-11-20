/**
 * Compatibility barrel for the surviving read-only roommate-post surfaces.
 *
 * The interactive Find Roommates board was retired by product decision on
 * 2026-07-15. Saved posts, historical message previews, moderation, and the
 * My Home management widget still consume these shared types/read helpers.
 */
export type { ProfileEmbed, RoommateSearchPost, InterestRow } from './roommateSearchTypes';
export { useStartDm } from './useStartDm';
export {
  fetchInterestedRoommatePosts,
  patchInterestOptimistic,
  rollbackInterestOptimistic,
} from './roommateSearchApi';
export { RoommatePostDetail } from './RoommatePostDetailLazy';
export { PostCard } from './RoommatePostCard';
