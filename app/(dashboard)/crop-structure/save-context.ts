export type CropStructureUiContext = {
  companyId: string | null;
  seasonId: string;
  fieldId: string | null;
  profileId: string | null;
  role: string | null;
};

export const isSameCropStructureUiContext = (
  left: CropStructureUiContext,
  right: CropStructureUiContext,
) =>
  left.companyId === right.companyId &&
  left.seasonId === right.seasonId &&
  left.fieldId === right.fieldId &&
  left.profileId === right.profileId &&
  left.role === right.role;
