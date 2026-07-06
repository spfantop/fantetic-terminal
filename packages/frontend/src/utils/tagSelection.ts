export const appendSelectedTagId = (selectedTagIds: number[], tagId: number): number[] => {
  return selectedTagIds.includes(tagId)
    ? selectedTagIds
    : [...selectedTagIds, tagId];
};
