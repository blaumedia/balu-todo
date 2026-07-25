// Local replica search across tasks, projects and labels.
//
// The implementation lives in `@balu/domain::searchReplica` so web and mobile
// rank identical queries identically (I6/D2). Mobile used to carry its own
// plain-substring version; this module now only keeps the mobile-facing names.
export {
  searchReplica,
  type ReplicaSearchInput as SearchInput,
  type ReplicaSearchResults as SearchResults,
} from '@balu/domain';
